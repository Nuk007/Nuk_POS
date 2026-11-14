'use strict';
/**
 * /api/solicitacoes-portal — caixa de entrada das solicitações feitas no portal do cliente (JWT).
 * Rotas finas: a lógica está em services/solicitacoes.service.js.
 */
const express = require('express');
const router = express.Router();
const svc = require('../services/solicitacoes.service');
const { authMiddleware, validarUUID, isUUID } = require('../middleware/auth');

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

/**
 * @openapi
 * /api/solicitacoes-portal/{id}/quartos-livres:
 *   get:
 *     tags: [Solicitações do portal]
 *     summary: Quartos do tipo pedido livres no período do pedido de reserva (com o preço)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: "{ solicitacao, quartos }" }, 409: { description: Não é um pedido de reserva com data } }
 * /api/solicitacoes-portal/{id}/reservar:
 *   post:
 *     tags: [Solicitações do portal]
 *     summary: Confirma o pedido criando a reserva no quarto escolhido (perfil «vender quartos»); devolve link_whatsapp para avisar o cliente
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [quarto_id], properties: { quarto_id: { type: string, format: uuid } } } } } }
 *     responses: { 200: { description: Reserva criada }, 403: { description: Sem o perfil de vender quartos }, 409: { description: Já tratado, tipo diferente ou período ocupado } }
 */
router.get('/:id/quartos-livres', authMiddleware, validarUUID('id'), h(async (req, res) => {
  res.json(await svc.quartosParaSolicitacao({ tenantId: req.tenantId, id: req.params.id }));
}));
router.post('/:id/reservar', authMiddleware, validarUUID('id'), h(async (req, res) => {
  if (!isUUID(req.body.quarto_id)) return res.status(400).json({ erro: 'quarto_id inválido' });
  res.json(await svc.confirmarComReserva({ tenantId: req.tenantId, userId: req.user.id, id: req.params.id, quarto_id: req.body.quarto_id }));
}));

module.exports = router;
