'use strict';
const express = require('express');
const { exigirModulo } = require('../middleware/modulos');
const router = express.Router();
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const svc = require('../services/quartos.service');

const falha = (res, next) => e => e.statusCode ? res.status(e.statusCode).json({ erro: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) }) : next(e);
const vendas = require('../services/quartos-vendas.service');
const ctx = req => ({ tenantId: req.tenantId, userId: req.user.id });

/**
 * @openapi
 * /api/quartos:
 *   get:
 *     tags: [Quartos]
 *     summary: Lista os quartos com ocupação, hora em que ficam livres, estrela de reserva e arrumação pendente
 * /api/quartos/{id}/vender:
 *   post:
 *     tags: [Quartos]
 *     summary: Vende o quarto agora (Hora/Noite/Diária) — exige o perfil «Vender quartos»
 *     requestBody: { content: { application/json: { schema: { type: object, required: [fracao], properties: { fracao: { type: string, enum: [DUAS_HORAS, PERNOITE, DIARIA] }, nome_hospede: { type: string }, observacoes: { type: string } } } } } }
 *     responses: { 201: { description: Venda registada }, 403: { description: Sem perfil }, 409: { description: Quarto indisponível ou estrela vermelha } }
 * /api/quartos/{id}/reservar:
 *   post:
 *     tags: [Quartos]
 *     summary: Reserva um período futuro compatível — exige o perfil «Vender quartos»
 *     responses: { 201: { description: Reserva criada }, 409: { description: Período incompatível } }
 * /api/quartos/{id}/abrir:
 *   post:
 *     tags: [Quartos]
 *     summary: Abre o quarto (cliente saiu antes da hora) e manda arrumar
 *     responses: { 200: { description: Quarto aberto, arrumação com prazo de 30 min } }
 * /api/quartos/{id}/limpo:
 *   post:
 *     tags: [Quartos]
 *     summary: Dá o quarto como limpo e disponível (arrumadores no prazo; chefia depois do prazo)
 *     responses: { 200: { description: Quarto disponível, com o atraso em minutos } }
 * /api/quartos/reservas/{id}/entrada:
 *   post:
 *     tags: [Quartos]
 *     summary: Dá entrada a uma reserva (na última hora antes do início)
 *     responses: { 200: { description: Reserva em curso } }
 * /api/quartos/reservas/{id}/cancelar:
 *   post:
 *     tags: [Quartos]
 *     summary: Cancela uma reserva por iniciar
 *     responses: { 200: { description: Reserva cancelada } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await vendas.listar({ tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});
router.post('/:id/vender', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try { res.status(201).json(await vendas.vender({ ...ctx(req), quartoId: req.params.id, ...req.body })); } catch (e) { falha(res, next)(e); }
});
router.post('/:id/reservar', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try { res.status(201).json(await vendas.reservar({ ...ctx(req), quartoId: req.params.id, ...req.body })); } catch (e) { falha(res, next)(e); }
});
router.post('/:id/abrir', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try { res.json(await vendas.abrirQuarto({ ...ctx(req), quartoId: req.params.id })); } catch (e) { falha(res, next)(e); }
});
router.post('/:id/limpo', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try { res.json(await vendas.marcarLimpo({ ...ctx(req), quartoId: req.params.id })); } catch (e) { falha(res, next)(e); }
});
router.post('/reservas/:rid/entrada', authMiddleware, validarUUID('rid'), async (req, res, next) => {
  try { res.json(await vendas.darEntrada({ ...ctx(req), reservaId: req.params.rid })); } catch (e) { falha(res, next)(e); }
});
router.post('/reservas/:rid/cancelar', authMiddleware, validarUUID('rid'), async (req, res, next) => {
  try { res.json(await vendas.cancelarReserva({ ...ctx(req), reservaId: req.params.rid })); } catch (e) { falha(res, next)(e); }
});

// PATCH /api/quartos/:id/status — estado manual pela chefia (manutenção, bloqueio…)
router.patch('/:id/status', authMiddleware, validarUUID('id'), requerNivel(['ADMIN','GERENTE']), async (req, res, next) => {
  const STATUSES_VALIDOS = ['DISPONIVEL','OCUPADO','LIMPEZA','MANUTENCAO','BLOQUEADO'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  try { res.json(await vendas.mudarEstado({ ...ctx(req), quartoId: req.params.id, status })); } catch (e) { falha(res, next)(e); }
});

/**
 * @openapi
 * /api/quartos:
 *   post:
 *     tags: [Quartos]
 *     summary: Criar quarto (ADMIN)
 *     requestBody: { content: { application/json: { schema: { type: object, required: [numero, tipo, preco_2h, preco_pernoite, preco_diaria], properties: { numero: { type: string }, tipo: { type: string, enum: [STANDARD, SUPERIOR, SUITE, SUITE_PRESIDENCIAL, VIP_EXECUTIVO] }, andar: { type: integer }, preco_2h: { type: number }, preco_pernoite: { type: number }, preco_diaria: { type: number }, descricao: { type: string } } } } } }
 *     responses: { 201: { description: Quarto criado }, 400: { description: Dados inválidos }, 409: { description: Número já existe } }
 * /api/quartos/{id}:
 *   put:
 *     tags: [Quartos]
 *     summary: Editar quarto e preços (ADMIN)
 *     responses: { 200: { description: Quarto actualizado }, 404: { description: Não encontrado }, 409: { description: Número já existe } }
 *   delete:
 *     tags: [Quartos]
 *     summary: Apagar quarto sem histórico de reservas (ADMIN)
 *     responses: { 204: { description: Apagado }, 409: { description: Ocupado ou com reservas } }
 */
const gestor = [authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes')]; // configuração = só no painel de Configurações (ADMIN)

router.post('/', ...gestor, async (req, res, next) => {
  try { res.status(201).json(await svc.criarQuarto({ tenantId: req.tenantId, dados: req.body || {} })); }
  catch (e) { falha(res, next)(e); }
});
router.put('/:id', ...gestor, validarUUID('id'), async (req, res, next) => {
  try { res.json(await svc.actualizarQuarto({ tenantId: req.tenantId, id: req.params.id, dados: req.body || {} })); }
  catch (e) { falha(res, next)(e); }
});
router.delete('/:id', ...gestor, validarUUID('id'), async (req, res, next) => {
  try { await svc.removerQuarto({ tenantId: req.tenantId, id: req.params.id }); res.status(204).end(); }
  catch (e) { falha(res, next)(e); }
});

module.exports = router;
