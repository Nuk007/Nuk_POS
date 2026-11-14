'use strict';
/** Rotas finas dos clientes do POS (lógica em services/clientes.service.js). */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const svc = require('../services/clientes.service');

const falha = (res, next, e) => (e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e));

/**
 * @openapi
 * /api/clientes:
 *   get:
 *     summary: Clientes activos (paginado, pesquisa por nome, telefone ou email)
 *     tags: [Clientes]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses: { 200: { description: "{ data, page, limit, total }" } }
 *   post:
 *     summary: Cadastra um cliente ao balcão
 *     tags: [Clientes]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [nome], properties: { nome: { type: string }, telefone: { type: string }, email: { type: string }, nif: { type: string } } } } } }
 *     responses: { 201: { description: Criado }, 400: { description: Dados inválidos }, 409: { description: Telefone ou email já registado } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.listar({ tenantId: req.tenantId, q: req.query.q, page: req.query.page, limit: req.query.limit })); } catch (e) { falha(res, next, e); }
});
router.post('/', authMiddleware, async (req, res, next) => {
  const { nome, telefone, email, nif } = req.body;
  try { res.status(201).json(await svc.criar({ nome, telefone, email, nif, tenantId: req.tenantId })); } catch (e) { falha(res, next, e); }
});

module.exports = router;
