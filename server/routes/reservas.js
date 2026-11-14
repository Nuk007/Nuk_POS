'use strict';
/** Rotas finas das reservas (lógica em services/reservas.service.js). */
const express = require('express');
const router = express.Router();
const { authMiddleware, validarUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');
const svc = require('../services/reservas.service');

const falha = (res, next, e) => (e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e));

/**
 * @openapi
 * /api/reservas:
 *   get:
 *     summary: Últimas 100 reservas do estabelecimento
 *     tags: [Quartos]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista de reservas } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.listar({ tenantId: req.tenantId })); } catch (e) { falha(res, next, e); }
});

/**
 * @openapi
 * /api/reservas/{id}/status:
 *   patch:
 *     summary: Muda o estado da reserva (CHECKOUT manda o quarto para arrumação)
 *     tags: [Quartos]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { status: { type: string, enum: [CONFIRMADA, CHECKIN, CHECKOUT, CANCELADA, NO_SHOW] } } } } } }
 *     responses: { 200: { description: Reserva actualizada }, 400: { description: Estado inválido }, 404: { description: Não encontrada } }
 */
router.patch('/:id/status', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try {
    const r = await svc.mudarEstado({ tenantId: req.tenantId, id: req.params.id, status: req.body.status });
    broadcast('quarto_atualizado', { quarto_id: r.quarto_id, status: r.status }, req.tenantId);
    res.json(r);
  } catch (e) { falha(res, next, e); }
});

module.exports = router;
