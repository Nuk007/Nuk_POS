'use strict';
/**
 * /api/impressao — documentos para impressão directa em térmicas (rotas finas; lógica em services/impressao.service.js).
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, isUUID } = require('../middleware/auth');
const svc = require('../services/impressao.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const comTenant = (req, res, next) => (req.tenantId ? next() : res.status(400).json({ erro: 'Sem estabelecimento' }));

/**
 * @openapi
 * /api/impressao/preparacao/reclamar:
 *   post:
 *     summary: Talões novos de cozinha/bar para este dispositivo (cada talão sai uma só vez, mesmo com vários dispositivos)
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { posto: { type: string, enum: [COZINHA, BAR] }, colunas: { type: integer, enum: [32, 42, 48] } } } } } }
 *     responses: { 200: { description: "Lista de documentos { linhas, cortar, gaveta }" } }
 * /api/impressao/preparacao/{pedidoId}:
 *   get:
 *     summary: Reimpressão do talão de cozinha/bar de um pedido
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Documento }, 404: { description: Nada deste posto no pedido } }
 * /api/impressao/recibo:
 *   post:
 *     summary: Recibo do cliente de um ou mais pedidos (gaveta = true se houve pagamento em dinheiro)
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [pedido_ids], properties: { pedido_ids: { type: array, items: { type: string, format: uuid } }, colunas: { type: integer } } } } } }
 *     responses: { 200: { description: Documento } }
 */
router.post('/preparacao/reclamar', authMiddleware, comTenant, h(async (req, res) => {
  const b = req.body || {};
  res.json(await svc.reclamar({ tenantId: req.tenantId, userId: req.user && req.user.id, posto: String(b.posto || '').toUpperCase(), colunas: b.colunas, limite: b.limite }));
}));
router.get('/preparacao/:pedidoId', authMiddleware, comTenant, h(async (req, res) => {
  if (!isUUID(req.params.pedidoId)) return res.status(400).json({ erro: 'pedidoId inválido' });
  res.json(await svc.talaoPreparacao({ tenantId: req.tenantId, pedidoId: req.params.pedidoId, posto: String(req.query.posto || '').toUpperCase(), colunas: req.query.colunas }));
}));
router.post('/recibo', authMiddleware, comTenant, h(async (req, res) => {
  const ids = (req.body || {}).pedido_ids;
  if (!Array.isArray(ids) || ids.some(i => !isUUID(i))) return res.status(400).json({ erro: 'pedido_ids inválidos' });
  res.json(await svc.recibo({ tenantId: req.tenantId, pedidoIds: [...new Set(ids)], colunas: (req.body || {}).colunas }));
}));

module.exports = router;
