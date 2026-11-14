'use strict';
/** /api/cadeia — vários estabelecimentos do mesmo dono (rotas finas; lógica em services/cadeia.service.js). */
const express = require('express');
const router = express.Router();
const { authMiddleware, isUUID } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiters');
const svc = require('../services/cadeia.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) });
    next(e);
  }
};

/**
 * @openapi
 * /api/cadeia/estabelecimentos:
 *   get:
 *     summary: Estabelecimentos onde o mesmo email tem conta activa (para mudar de estabelecimento)
 *     tags: [Cadeia]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ actual, cadeia, estabelecimentos }" } }
 * /api/cadeia/trocar:
 *   post:
 *     summary: Muda a sessão para outro estabelecimento (palavra-passe da conta de destino)
 *     tags: [Cadeia]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [tenant_id, palavra_passe], properties: { tenant_id: { type: string, format: uuid }, palavra_passe: { type: string } } } } } }
 *     responses: { 200: { description: "{ token, funcionario }" }, 403: { description: Palavra-passe errada ou estabelecimento suspenso }, 404: { description: Sem conta nesse estabelecimento } }
 * /api/cadeia/consolidado:
 *   get:
 *     summary: Receita, despesas e resultado de cada estabelecimento da cadeia e o total (só ADMIN)
 *     tags: [Cadeia]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: de, schema: { type: string, format: date } }
 *       - { in: query, name: ate, schema: { type: string, format: date } }
 *     responses: { 200: { description: "{ periodo, cadeia, estabelecimentos, total }" }, 403: { description: Só administradores }, 409: { description: Sem cadeia } }
 */
router.get('/estabelecimentos', authMiddleware, h(async (req, res) => res.json(await svc.estabelecimentos({ userId: req.user.id }))));
router.post('/trocar', loginLimiter, authMiddleware, h(async (req, res) => {
  if (!isUUID(req.body.tenant_id)) return res.status(400).json({ erro: 'tenant_id inválido' });
  res.json(await svc.trocar({ userId: req.user.id, tenant_id: req.body.tenant_id, palavra_passe: req.body.palavra_passe }));
}));
router.get('/consolidado', authMiddleware, h(async (req, res) => res.json(await svc.consolidado({ userId: req.user.id, de: req.query.de, ate: req.query.ate }))));

module.exports = router;
