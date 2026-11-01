'use strict';
/**
 * /api/solicitacoes-portal — caixa de entrada das solicitações feitas no portal do cliente (JWT).
 * Rotas finas: a lógica está em services/solicitacoes.service.js.
 */
const express = require('express');
const router = express.Router();
const svc = require('../services/solicitacoes.service');
const { authMiddleware, validarUUID } = require('../middleware/auth');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    next(e);
  }
};

/**
 * @openapi
 * /api/solicitacoes-portal:
 *   get:
 *     tags: [Solicitações do portal]
 *     summary: Lista paginada das solicitações do portal (hospedagem, serviços e eventos)
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDENTE, CONFIRMADA, CANCELADA] } }
 *       - { in: query, name: tipo, schema: { type: string, enum: [HOSPEDAGEM, SERVICO, EVENTO] } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses: { 200: { description: "Resposta paginada (data, page, limit, total)" }, 400: { description: Filtro inválido } }
 */
router.get('/', authMiddleware, h(async (req, res) => {
  res.json(await svc.listar({ tenantId: req.tenantId, status: req.query.status, tipo: req.query.tipo, page: req.query.page, limit: req.query.limit }));
}));

/**
 * @openapi
 * /api/solicitacoes-portal/pendentes:
 *   get:
 *     tags: [Solicitações do portal]
 *     summary: Número de solicitações por tratar (para o indicador do menu)
 *     responses: { 200: { description: "Objecto com o campo pendentes" } }
 */
router.get('/pendentes', authMiddleware, h(async (req, res) => {
  res.json(await svc.contarPendentes({ tenantId: req.tenantId }));
}));

/**
 * @openapi
 * /api/solicitacoes-portal/{id}/status:
 *   patch:
 *     tags: [Solicitações do portal]
 *     summary: Confirma ou cancela uma solicitação
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [status], properties: { status: { type: string, enum: [PENDENTE, CONFIRMADA, CANCELADA] } } } } } }
 *     responses: { 200: { description: Solicitação actualizada }, 400: { description: Estado inválido }, 404: { description: Solicitação não encontrada } }
 */
router.patch('/:id/status', authMiddleware, validarUUID('id'), h(async (req, res) => {
  res.json(await svc.actualizarStatus({ tenantId: req.tenantId, id: req.params.id, status: req.body.status }));
}));

module.exports = router;
