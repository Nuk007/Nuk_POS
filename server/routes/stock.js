'use strict';
/**
 * /api/stock — route handlers (thin layer).
 * Lógica de negócio em server/services/stock.service.js
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const { stockMovLimiter } = require('../middleware/rateLimiters');
const svc = require('../services/stock.service');

// ── GET /api/stock ───────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/stock:
 *   get:
 *     summary: Lista itens de stock paginados
 *     tags: [Stock]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 200 }
 *     responses:
 *       200:
 *         description: Lista paginada de itens de stock
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/StockItem' } }
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 total: { type: integer }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const result = await svc.listarStock({
      tenantId: req.tenantId,
      page:     parseInt(req.query.page)  || 1,
      limit:    parseInt(req.query.limit) || 200,
    });
    res.json(result);
  } catch (e) { next(e); }
});

// ── POST /api/stock ──────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/stock:
 *   post:
 *     summary: Cria um novo item de stock
 *     tags: [Stock]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nome, categoria, unidade]
 *             properties:
 *               nome:          { type: string }
 *               categoria:     { type: string }
 *               stock_atual:   { type: number }
 *               stock_minimo:  { type: number }
 *               stock_ideal:   { type: number }
 *               unidade:       { type: string }
 *               custo_unitario: { type: number }
 *               fornecedor:    { type: string }
 *     responses:
 *       201:
 *         description: Item criado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/StockItem' }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res, next) => {
  try {
    const item = await svc.criarItemStock({ ...req.body, tenantId: req.tenantId });
    res.status(201).json(item);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    next(e);
  }
});

// ── POST /api/stock/:id/movimento ────────────────────────────────────────────
/**
 * @openapi
 * /api/stock/{id}/movimento:
 *   post:
 *     summary: Regista um movimento de stock (entrada, saída ou ajuste)
 *     tags: [Stock]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tipo, quantidade]
 *             properties:
 *               tipo:       { type: string, enum: [VENDA, COMPRA, AJUSTE, DESPERDICIO, INVENTARIO] }
 *               quantidade: { type: number }
 *               motivo:     { type: string }
 *     responses:
 *       201:
 *         description: Movimento registado
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       409:
 *         description: Stock insuficiente
 */
router.post('/:id/movimento', stockMovLimiter, authMiddleware, validarUUID('id'), async (req, res, next) => {
  try {
    const mov = await svc.registarMovimento({
      tenantId:  req.tenantId,
      userId:    req.user.id,
      itemId:    req.params.id,
      tipo:      req.body.tipo,
      quantidade: req.body.quantidade,
      motivo:    req.body.motivo,
    });
    res.status(201).json(mov);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message, disponivel: e.disponivel });
    next(e);
  }
});

module.exports = router;
