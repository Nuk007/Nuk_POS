'use strict';
/**
 * /api/ponto — assiduidade (rotas finas; lógica em services/assiduidade.service.js).
 * Entrada/saída: qualquer funcionário, sempre para si próprio. Relatório e correcções: ADMIN/GERENTE.
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const svc = require('../services/assiduidade.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const base = req => ({ tenantId: req.tenantId, userId: req.user && req.user.id });
const chefia = requerNivel(['ADMIN', 'GERENTE']);
const comTenant = (req, res, next) => (req.tenantId ? next() : res.status(400).json({ erro: 'Só funcionários de um estabelecimento registam assiduidade' }));

/**
 * @openapi
 * /api/ponto:
 *   get:
 *     summary: Estado do próprio funcionário (em serviço ou não)
 *     tags: [Assiduidade]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ em_servico, registo }" } }
 * /api/ponto/entrada:
 *   post:
 *     summary: Regista a entrada do próprio funcionário
 *     tags: [Assiduidade]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Entrada registada }, 409: { description: Já em serviço } }
 * /api/ponto/saida:
 *   post:
 *     summary: Regista a saída do próprio funcionário
 *     tags: [Assiduidade]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "Saída registada, com as horas" }, 409: { description: Sem entrada } }
 * /api/ponto/relatorio:
 *   get:
 *     summary: Registos e horas por funcionário no período (ADMIN/GERENTE)
 *     tags: [Assiduidade]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: de, schema: { type: string, format: date } }
 *       - { in: query, name: ate, schema: { type: string, format: date } }
 *     responses: { 200: { description: Relatório } }
 * /api/ponto/{id}/saida:
 *   patch:
 *     summary: Corrige uma saída esquecida (ADMIN/GERENTE, observação obrigatória)
 *     tags: [Assiduidade]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [saida_em, observacoes], properties: { saida_em: { type: string, format: date-time }, observacoes: { type: string } } } } } }
 *     responses: { 200: { description: Corrigido }, 409: { description: Já tem saída } }
 */
router.get('/', authMiddleware, comTenant, h(async (req, res) => res.json(await svc.estado(base(req)))));
router.post('/entrada', authMiddleware, comTenant, h(async (req, res) => res.status(201).json(await svc.entrada(base(req)))));
router.post('/saida', authMiddleware, comTenant, h(async (req, res) => res.json(await svc.saida(base(req)))));
router.get('/relatorio', authMiddleware, chefia, comTenant, h(async (req, res) => res.json(await svc.relatorio({ ...base(req), de: req.query.de, ate: req.query.ate }))));
router.patch('/:id/saida', authMiddleware, chefia, comTenant, h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  res.json(await svc.corrigirSaida({ ...base(req), registoId: req.params.id, saida_em: req.body.saida_em, observacoes: req.body.observacoes }));
}));

module.exports = router;
