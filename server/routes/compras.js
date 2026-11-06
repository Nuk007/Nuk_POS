'use strict';
/**
 * /api/compras — Compras pontuais pagas com o dinheiro do caixa (rotas finas; lógica em services/compras.service.js).
 */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const svc = require('../services/compras.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message, ...(e.codigo ? { codigo: e.codigo } : {}), ...(e.disponivel !== undefined ? { disponivel: e.disponivel } : {}) });
    next(e);
  }
};
const base = req => ({ tenantId: req.tenantId, userId: req.user && req.user.id });

/**
 * @openapi
 * /api/compras:
 *   get:
 *     summary: Últimas compras pontuais (com as anuladas assinaladas)
 *     tags: [Compras]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista de compras } }
 *   post:
 *     summary: Regista uma compra pontual paga com o dinheiro do caixa; só produtos cadastrados no stock
 *     tags: [Compras]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [stock_item_id, quantidade, valor_total], properties: { stock_item_id: { type: string }, quantidade: { type: number }, valor_total: { type: number }, fornecedor: { type: string }, observacoes: { type: string } } } } } }
 *     responses: { 201: { description: Compra registada }, 404: { description: Produto não cadastrado }, 409: { description: Caixa fechado ou dinheiro insuficiente } }
 */
router.get('/', authMiddleware, h(async (req, res) => res.json(await svc.listar(base(req)))));
router.post('/', authMiddleware, h(async (req, res) => res.status(201).json(await svc.registar({ ...req.body, ...base(req) }))));

/**
 * @openapi
 * /api/compras/{id}/anular:
 *   post:
 *     summary: Anula uma compra do caixa em curso (devolve o dinheiro ao caixa e retira do stock)
 *     tags: [Compras]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Compra anulada }, 409: { description: Já anulada, de outro caixa ou stock já consumido } }
 */
router.post('/:id/anular', authMiddleware, h(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido' });
  res.json(await svc.anular({ id: req.params.id, ...base(req) }));
}));

module.exports = router;
