'use strict';
/**
 * /api/agente-impressao — usado só pelo programa local `agente-impressao/agente.js` (cabeçalho X-Agente-Token).
 * Rotas finas: a lógica está em services/agente-impressao.service.js.
 */
const express = require('express');
const router = express.Router();
const { isUUID } = require('../middleware/auth');
const { agenteLimiter } = require('../middleware/rateLimiters');
const svc = require('../services/agente-impressao.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const autenticar = async (req, res, next) => {
  try { req.agente = await svc.autenticarAgente(req.get('X-Agente-Token')); next(); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};

/**
 * @openapi
 * /api/agente-impressao/trabalhos:
 *   get:
 *     summary: (Agente local) Reclama até 10 trabalhos da fila do seu estabelecimento
 *     tags: [Impressão]
 *     security: []
 *     parameters: [{ in: header, name: X-Agente-Token, required: true, schema: { type: string } }]
 *     responses: { 200: { description: "{ agente, trabalhos: [{ id, impressora, dados }] }" }, 401: { description: Token inválido ou revogado } }
 * /api/agente-impressao/trabalhos/{id}:
 *   post:
 *     summary: (Agente local) Resultado do envio de um trabalho
 *     tags: [Impressão]
 *     security: []
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { ok: { type: boolean }, erro: { type: string } } } } } }
 *     responses: { 200: { description: Estado final }, 404: { description: Trabalho não é deste agente ou já concluído } }
 */
router.get('/trabalhos', agenteLimiter, autenticar, h(async (req, res) => {
  res.json({ agente: req.agente.nome, trabalhos: await svc.reclamar({ agente: req.agente }) });
}));
router.post('/trabalhos/:id', agenteLimiter, autenticar, h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  res.json(await svc.concluir({ agente: req.agente, id: req.params.id, ok: req.body.ok === true, motivo: req.body.erro }));
}));

module.exports = router;
