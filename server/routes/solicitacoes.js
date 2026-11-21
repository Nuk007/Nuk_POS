'use strict';
/** Pedidos de hospedagem antigos (`/api/solicitacoes-hospedagem`, por compatibilidade; o portal usa `solicitacoes_portal`). */
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const svc = require('../services/solicitacoes.service');

const falha = (res, next) => e => (e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e));

/**
 * @openapi
 * /api/solicitacoes-hospedagem:
 *   get:
 *     summary: Pedidos de hospedagem antigos (só com cliente; usar /api/solicitacoes-portal)
 *     tags: [Solicitações]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista (até 100) } }
 * /api/solicitacoes-hospedagem/{id}/status:
 *   patch:
 *     summary: Muda o estado de um pedido antigo (PENDENTE, CONFIRMADA, CANCELADA; ADMIN/GERENTE)
 *     tags: [Solicitações]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Pedido actualizado }, 400: { description: Estado inválido }, 404: { description: Não encontrado } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.listarAntigas({ tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});

router.patch('/:id/status', authMiddleware, validarUUID('id'), requerNivel(['ADMIN', 'GERENTE']), async (req, res, next) => {
  try { res.json(await svc.actualizarStatusAntiga({ tenantId: req.tenantId, id: req.params.id, status: req.body && req.body.status })); }
  catch (e) { falha(res, next)(e); }
});

module.exports = router;
