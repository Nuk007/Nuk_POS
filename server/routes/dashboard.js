'use strict';
const express = require('express');
const { exigirModulo } = require('../middleware/modulos');
const router = express.Router();
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const svc = require('../services/dashboard.service');

const falha = (res, next) => e => e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e);

/**
 * @openapi
 * /api/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Resumo de hoje — receita (vendas pagas, como nas Finanças), mesas, quartos, stock no mínimo, pedidos em curso e mais vendidos
 *     responses: { 200: { description: "{ resumo_hoje, mesas, quartos, alertas_stock, pedidos_abertos, top_produtos }" } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.resumoHoje({ tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});

/**
 * @openapi
 * /api/dashboard/comparativo:
 *   get:
 *     tags: [Dashboard]
 *     summary: Facturação e itens configurados — hoje, ontem e dia homólogo da semana (Africa/Luanda)
 *     responses: { 200: { description: "{ dias, facturacao: {valor, restaurante, quartos}, itens: [...] }" } }
 * /api/dashboard/itens:
 *   get:
 *     tags: [Dashboard]
 *     summary: Itens configurados (ADMIN), incluindo ocultos
 *     responses: { 200: { description: Lista de itens } }
 *   post:
 *     tags: [Dashboard]
 *     summary: Acrescentar item a controlar (ADMIN) — fonte PRODUTO, CATEGORIA, SERVICO, CONTADOR ou PENDENCIA
 *     responses: { 201: { description: Item criado }, 400: { description: Dados inválidos } }
 * /api/dashboard/itens/{id}:
 *   put:
 *     tags: [Dashboard]
 *     summary: Renomear ou ocultar/mostrar um item (ADMIN)
 *     responses: { 200: { description: Item actualizado } }
 *   delete:
 *     tags: [Dashboard]
 *     summary: Remover item e os seus registos (ADMIN)
 *     responses: { 204: { description: Removido } }
 * /api/dashboard/itens/{id}/registos:
 *   post:
 *     tags: [Dashboard]
 *     summary: Registo manual (MAIS/MENOS num contador; ABRIR/TRATAR numa pendência) — qualquer funcionário
 *     responses: { 204: { description: Registado }, 409: { description: Já está a zero / nada em aberto } }
 */
router.get('/comparativo', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.comparativo({ tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});
router.get('/itens', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try { res.json({ itens: await svc.listarItens({ tenantId: req.tenantId }), servicos: svc.SERVICOS }); } catch (e) { falha(res, next)(e); }
});
router.post('/itens', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try { res.status(201).json(await svc.criarItem({ ...req.body, tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});
router.put('/itens/:id', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), validarUUID('id'), async (req, res, next) => {
  try { res.json(await svc.actualizarItem({ ...req.body, tenantId: req.tenantId, id: req.params.id })); } catch (e) { falha(res, next)(e); }
});
router.delete('/itens/:id', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), validarUUID('id'), async (req, res, next) => {
  try { await svc.removerItem({ tenantId: req.tenantId, id: req.params.id }); res.status(204).end(); } catch (e) { falha(res, next)(e); }
});
router.post('/itens/:id/registos', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try { await svc.registar({ tenantId: req.tenantId, userId: req.user.id, itemId: req.params.id, evento: (req.body || {}).evento }); res.status(204).end(); } catch (e) { falha(res, next)(e); }
});

module.exports = router;
