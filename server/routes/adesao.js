'use strict';
/**
 * /api/adesao — Contrato de Adesão à Plataforma Nuk_POS da GESTNUK AI (rotas finas; lógica em
 * services/adesao.service.js). Não passa pelo verificarLicencaTenant: é aqui que se desbloqueia a operação.
 */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const svc = require('../services/adesao.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const base = req => ({ tenantId: req.tenantId, userId: req.user && req.user.id });

/**
 * @openapi
 * /api/adesao:
 *   get:
 *     summary: Estado do Contrato de Adesão do estabelecimento (pendente, quem pode assinar e o texto)
 *     tags: [Adesão]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Estado e texto do contrato } }
 * /api/adesao/assinar:
 *   post:
 *     summary: O administrador titular assina o contrato escrevendo o nome completo
 *     tags: [Adesão]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [nome, aceito], properties: { nome: { type: string }, aceito: { type: boolean } } } } } }
 *     responses: { 200: { description: Assinado }, 403: { description: Não é o titular }, 409: { description: Já assinado } }
 * /api/adesao/documento.pdf:
 *   get:
 *     summary: PDF do contrato assinado
 *     tags: [Adesão]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: PDF }, 409: { description: Ainda não assinado } }
 */
router.get('/', authMiddleware, h(async (req, res) => res.json(await svc.estado(base(req)))));
router.post('/assinar', authMiddleware, h(async (req, res) => res.json(await svc.assinar({
  nome: req.body && req.body.nome, aceito: req.body && req.body.aceito, ...base(req),
  ip: req.ip, dispositivo: req.get('user-agent'),
}))));
router.get('/documento.pdf', authMiddleware, h(async (req, res) => {
  const b = await svc.pdf(base(req));
  res.set('Cache-Control', 'no-store').type('application/pdf').set('Content-Disposition', 'inline; filename="contrato-adesao-nukpos.pdf"').send(b);
}));

module.exports = router;
