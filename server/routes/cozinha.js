'use strict';
/**
 * /api/cozinha — ecrã de cozinha e bar (rotas finas; lógica em services/cozinha.service.js).
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const svc = require('../services/cozinha.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const comTenant = (req, res, next) => (req.tenantId ? next() : res.status(400).json({ erro: 'Sem estabelecimento' }));
const uuid = (...nomes) => (req, res, next) => (nomes.every(n => isUUID(req.params[n])) ? next() : res.status(400).json({ erro: 'id inválido' }));

/**
 * @openapi
 * /api/cozinha:
 *   get:
 *     summary: Pedidos com itens por preparar/entregar num posto (COZINHA ou BAR), os mais antigos primeiro
 *     tags: [Cozinha]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: posto, schema: { type: string, enum: [COZINHA, BAR] } }]
 *     responses: { 200: { description: Lista } }
 * /api/cozinha/postos:
 *   get: { summary: Posto de cada categoria (COZINHA, BAR, NENHUM), tags: [Cozinha], security: [{ bearerAuth: [] }], responses: { 200: { description: Mapa } } }
 *   put: { summary: Define o posto de cada categoria (só ADMIN), tags: [Cozinha], security: [{ bearerAuth: [] }], responses: { 200: { description: Mapa } } }
 * /api/cozinha/pedidos/{pedidoId}/avancar:
 *   post:
 *     summary: Avança todos os itens do posto no pedido (Aguardando → A preparar → Pronto → Entregue)
 *     tags: [Cozinha]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Novo estado }, 409: { description: Nada por preparar ou pedido cancelado } }
 * /api/cozinha/pedidos/{pedidoId}/itens/{itemId}/avancar:
 *   post:
 *     summary: Avança um item (ou põe-no no estado indicado)
 *     tags: [Cozinha]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Novo estado } }
 */
router.get('/', authMiddleware, comTenant, h(async (req, res) => res.json(await svc.listar({ tenantId: req.tenantId, posto: String(req.query.posto || 'COZINHA').toUpperCase() }))));
router.get('/postos', authMiddleware, comTenant, h(async (req, res) => res.json(await svc.obterPostos({ tenantId: req.tenantId }))));
router.put('/postos', authMiddleware, requerNivel(['ADMIN']), comTenant, h(async (req, res) => res.json(await svc.definirPostos({ tenantId: req.tenantId, mapa: (req.body || {}).postos }))));
router.post('/pedidos/:pedidoId/avancar', authMiddleware, comTenant, uuid('pedidoId'), h(async (req, res) => {
  res.json(await svc.avancarPedido({ tenantId: req.tenantId, pedidoId: req.params.pedidoId, posto: String((req.body || {}).posto || 'COZINHA').toUpperCase() }));
}));
router.post('/pedidos/:pedidoId/itens/:itemId/avancar', authMiddleware, comTenant, uuid('pedidoId', 'itemId'), h(async (req, res) => {
  res.json(await svc.avancarItem({ tenantId: req.tenantId, pedidoId: req.params.pedidoId, itemId: req.params.itemId, status: (req.body || {}).status }));
}));

module.exports = router;
