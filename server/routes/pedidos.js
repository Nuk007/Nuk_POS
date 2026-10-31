'use strict';
/**
 * /api/pedidos — route handlers (thin layer).
 * Lógica de negócio em server/services/pedidos.service.js
 */
const express = require('express');
const router  = express.Router();
const { authMiddleware, validarUUID } = require('../middleware/auth');
const svc = require('../services/pedidos.service');

// ── GET /api/pedidos ─────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/pedidos:
 *   get:
 *     summary: Lista pedidos paginados com filtros opcionais
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ABERTO, EM_PREPARO, PRONTO, FECHADO, CANCELADO] }
 *       - in: query
 *         name: mesa_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: data_inicio
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: data_fim
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100 }
 *     responses:
 *       200:
 *         description: Lista paginada de pedidos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/Pedido' } }
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 total: { type: integer }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const result = await svc.listarPedidos({
      tenantId:    req.tenantId,
      status:      req.query.status,
      mesa_id:     req.query.mesa_id,
      data_inicio: req.query.data_inicio,
      data_fim:    req.query.data_fim,
      page:        parseInt(req.query.page)  || 1,
      limit:       parseInt(req.query.limit) || 100,
    });
    res.json(result);
  } catch (e) { next(e); }
});

// ── GET /api/pedidos/hoje ────────────────────────────────────────────────────
/**
 * @openapi
 * /api/pedidos/hoje:
 *   get:
 *     summary: Lista pedidos criados hoje (fuso Africa/Luanda)
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Array de pedidos do dia
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/hoje', authMiddleware, async (req, res, next) => {
  try {
    const rows = await svc.listarPedidosHoje({ tenantId: req.tenantId });
    res.json(rows);
  } catch (e) { next(e); }
});

// ── POST /api/pedidos ────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/pedidos:
 *   post:
 *     summary: Cria um novo pedido
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itens]
 *             properties:
 *               mesa_id:    { type: string, format: uuid }
 *               cliente_id: { type: string, format: uuid }
 *               observacoes: { type: string }
 *               itens:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [produto_id, quantidade]
 *                   properties:
 *                     produto_id: { type: string, format: uuid }
 *                     quantidade: { type: number }
 *                     observacoes: { type: string }
 *     responses:
 *       201:
 *         description: Pedido criado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Pedido' }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const pedido = await svc.criarPedido({
      tenantId:    req.tenantId,
      userId:      req.user.id,
      mesa_id:     req.body.mesa_id,
      cliente_id:  req.body.cliente_id,
      itens:       req.body.itens,
      observacoes: req.body.observacoes,
    });
    res.status(201).json(pedido);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    next(e);
  }
});

// ── PATCH /api/pedidos/:id/status ────────────────────────────────────────────
/**
 * @openapi
 * /api/pedidos/{id}/status:
 *   patch:
 *     summary: Actualiza o status de um pedido
 *     tags: [Pedidos]
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ABERTO, EM_PREPARO, PRONTO, FECHADO, CANCELADO] }
 *     responses:
 *       200:
 *         description: Pedido actualizado
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch('/:id/status', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try {
    const pedido = await svc.actualizarStatusPedido({
      tenantId: req.tenantId,
      pedidoId: req.params.id,
      status:   req.body.status,
    });
    res.json(pedido);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    next(e);
  }
});

// ── PATCH /api/pedidos/:pedidoId/itens/:itemId/status ───────────────────────
/**
 * @openapi
 * /api/pedidos/{pedidoId}/itens/{itemId}/status:
 *   patch:
 *     summary: Actualiza o status de cozinha de um item do pedido
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: pedidoId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status_cozinha: { type: string, enum: [AGUARDANDO, PREPARANDO, PRONTO, ENTREGUE] }
 *     responses:
 *       200:
 *         description: Item actualizado
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  '/:pedidoId/itens/:itemId/status',
  authMiddleware, validarUUID('pedidoId'), validarUUID('itemId'),
  async (req, res, next) => {
    try {
      const item = await svc.actualizarStatusItem({
        tenantId:       req.tenantId,
        pedidoId:       req.params.pedidoId,
        itemId:         req.params.itemId,
        status_cozinha: req.body.status_cozinha,
      });
      res.json(item);
    } catch (e) {
      if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
      next(e);
    }
  }
);

module.exports = router;
