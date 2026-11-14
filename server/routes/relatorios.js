'use strict';
/**
 * /api/relatorios — relatórios de gestão (rotas finas; lógica em services/relatorios.service.js).
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const svc = require('../services/relatorios.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const chefia = requerNivel(['ADMIN', 'GERENTE']);

/**
 * @openapi
 * /api/relatorios/vendas:
 *   get:
 *     summary: Vendas, recebimentos por forma, funcionários, produtos, horas e cancelamentos num período (dias de Luanda; ADMIN/GERENTE)
 *     tags: [Relatórios]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: de, schema: { type: string, format: date } }
 *       - { in: query, name: ate, schema: { type: string, format: date } }
 *     responses: { 200: { description: Relatório }, 400: { description: Datas inválidas ou período acima de um ano }, 403: { description: Só chefia } }
 * /api/relatorios/caixa/{sessaoId}:
 *   get:
 *     summary: Relatório de fecho (Z) de uma sessão de caixa
 *     tags: [Relatórios]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Relatório }, 404: { description: Sessão não encontrada } }
 * /api/relatorios/caixa/{sessaoId}/talao.pdf:
 *   get:
 *     summary: Talão de fecho de caixa (80 mm)
 *     tags: [Relatórios]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: PDF } }
 */
router.get('/vendas', authMiddleware, chefia, h(async (req, res) => {
  res.json(await svc.vendas({ tenantId: req.tenantId, de: req.query.de, ate: req.query.ate }));
}));
router.get('/caixa/:sessaoId', authMiddleware, chefia, h(async (req, res) => {
  if (!isUUID(req.params.sessaoId)) return res.status(400).json({ erro: 'sessaoId inválido' });
  res.json(await svc.sessaoCaixa({ tenantId: req.tenantId, sessaoId: req.params.sessaoId }));
}));
router.get('/caixa/:sessaoId/talao.pdf', authMiddleware, chefia, h(async (req, res) => {
  if (!isUUID(req.params.sessaoId)) return res.status(400).json({ erro: 'sessaoId inválido' });
  const pdf = await require('../services/documentos.service').talaoFechoCaixa({ tenantId: req.tenantId, sessaoId: req.params.sessaoId });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="fecho-caixa-${req.params.sessaoId.slice(0, 8)}.pdf"`, 'Cache-Control': 'no-store' }).send(pdf);
}));

module.exports = router;
