'use strict';
/**
 * /api/servicos — avarias, danos e prazos de manutenção (rotas finas; lógica em services/servicos.service.js).
 */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const svc = require('../services/servicos.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const base = req => ({ tenantId: req.tenantId, userId: req.user && req.user.id });
const comId = fn => h(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido' });
  return fn(req, res);
});

/**
 * @openapi
 * /api/servicos/resumo:
 *   get:
 *     summary: Contagens para o painel (ocorrências abertas/urgentes, manutenções atrasadas/próximas 7 dias)
 *     tags: [Serviços]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ abertas, urgentes, atrasadas, proximas }" } }
 */
router.get('/resumo', authMiddleware, h(async (req, res) => res.json(await svc.resumo(base(req)))));

/**
 * @openapi
 * /api/servicos/ativos:
 *   get: { summary: "Itens de infraestrutura física e móvel", tags: [Serviços], security: [{ bearerAuth: [] }], responses: { 200: { description: Lista } } }
 *   post:
 *     summary: Cadastra um item (tipo FISICA ou MOVEL)
 *     tags: [Serviços]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [nome, tipo], properties: { nome: { type: string }, tipo: { type: string, enum: [FISICA, MOVEL] }, localizacao: { type: string } } } } } }
 *     responses: { 201: { description: Criado } }
 * /api/servicos/ativos/{id}:
 *   patch: { summary: "Altera ou desactiva um item", tags: [Serviços], security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Actualizado } } }
 */
router.get('/ativos', authMiddleware, h(async (req, res) => res.json(await svc.listarAtivos(base(req)))));
router.post('/ativos', authMiddleware, h(async (req, res) => res.status(201).json(await svc.criarAtivo({ ...req.body, ...base(req) }))));
router.patch('/ativos/:id', authMiddleware, comId(async (req, res) => res.json(await svc.atualizarAtivo({ ...req.body, id: req.params.id, ...base(req) }))));

/**
 * @openapi
 * /api/servicos/ocorrencias:
 *   get: { summary: "Avarias e danos (filtro ?estado=ABERTAS|ABERTA|EM_CURSO|RESOLVIDA|CANCELADA)", tags: [Serviços], security: [{ bearerAuth: [] }], responses: { 200: { description: Lista } } }
 *   post:
 *     summary: Reporta uma avaria ou dano
 *     tags: [Serviços]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [tipo, titulo], properties: { tipo: { type: string, enum: [AVARIA, DANO] }, titulo: { type: string }, descricao: { type: string }, prioridade: { type: string, enum: [BAIXA, MEDIA, ALTA, URGENTE] }, ativo_id: { type: string } } } } } }
 *     responses: { 201: { description: Criada } }
 * /api/servicos/ocorrencias/{id}:
 *   patch: { summary: "Muda o estado (EM_CURSO, RESOLVIDA ou CANCELADA, estas com texto) ou a prioridade", tags: [Serviços], security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Actualizada }, 409: { description: Já fechada } } }
 */
router.get('/ocorrencias', authMiddleware, h(async (req, res) => res.json(await svc.listarOcorrencias({ estado: req.query.estado, ...base(req) }))));
router.post('/ocorrencias', authMiddleware, h(async (req, res) => res.status(201).json(await svc.criarOcorrencia({ ...req.body, ...base(req) }))));
router.patch('/ocorrencias/:id', authMiddleware, comId(async (req, res) => res.json(await svc.atualizarOcorrencia({ ...req.body, id: req.params.id, ...base(req) }))));

/**
 * @openapi
 * /api/servicos/manutencoes:
 *   get: { summary: "Prazos de manutenção por data (dias_restantes negativo = atrasada)", tags: [Serviços], security: [{ bearerAuth: [] }], responses: { 200: { description: Lista } } }
 *   post:
 *     summary: Cria um plano de manutenção periódica para um item
 *     tags: [Serviços]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [ativo_id, descricao, periodicidade_dias], properties: { ativo_id: { type: string }, descricao: { type: string }, periodicidade_dias: { type: integer }, primeira_em: { type: string, format: date } } } } } }
 *     responses: { 201: { description: Criado } }
 * /api/servicos/manutencoes/{id}:
 *   patch: { summary: "Altera ou desactiva um plano", tags: [Serviços], security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Actualizado } } }
 * /api/servicos/manutencoes/{id}/realizada:
 *   post: { summary: "Regista a manutenção feita e calcula o próximo prazo", tags: [Serviços], security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Novo prazo } } }
 * /api/servicos/manutencoes/{id}/historico:
 *   get: { summary: "Manutenções já realizadas", tags: [Serviços], security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Lista } } }
 */
router.get('/manutencoes', authMiddleware, h(async (req, res) => res.json(await svc.listarManutencoes(base(req)))));
router.post('/manutencoes', authMiddleware, h(async (req, res) => res.status(201).json(await svc.criarManutencao({ ...req.body, ...base(req) }))));
router.patch('/manutencoes/:id', authMiddleware, comId(async (req, res) => res.json(await svc.atualizarManutencao({ ...req.body, id: req.params.id, ...base(req) }))));
router.post('/manutencoes/:id/realizada', authMiddleware, comId(async (req, res) => res.json(await svc.registarRealizada({ ...req.body, id: req.params.id, ...base(req) }))));
router.get('/manutencoes/:id/historico', authMiddleware, comId(async (req, res) => res.json(await svc.historicoManutencao({ id: req.params.id, ...base(req) }))));

module.exports = router;
