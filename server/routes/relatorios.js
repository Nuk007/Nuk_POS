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

const resumo = require('../services/resumo-diario.service');
const { exigirModulo } = require('../middleware/modulos');
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @openapi
 * /api/relatorios/resumo-diario:
 *   get:
 *     summary: Resumo do dia para o dono (por omissão ontem) com texto pronto e ligação wa.me
 *     tags: [Relatórios]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: dia, schema: { type: string, format: date } }]
 *     responses: { 200: { description: "{ resumo, texto, link_whatsapp, envio, whatsapp_oficial, config }" } }
 * /api/relatorios/resumo-diario/enviar:
 *   post:
 *     summary: Envia já o resumo pela API oficial do WhatsApp (409 com link_whatsapp se não estiver configurada)
 *     tags: [Relatórios]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Enviado }, 409: { description: API por configurar }, 502: { description: WhatsApp recusou } }
 * /api/relatorios/resumo-diario/config:
 *   put:
 *     summary: Liga o resumo diário, número de WhatsApp e hora (só ADMIN, Configurações)
 *     tags: [Relatórios]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { ativo: { type: boolean }, telefone: { type: string }, hora: { type: string, example: "07:30" } } } } } }
 *     responses: { 200: { description: Configuração gravada }, 400: { description: Número ou hora inválidos } }
 */
router.get('/resumo-diario', authMiddleware, chefia, h(async (req, res) => {
  const dia = req.query.dia;
  if (dia && !DIA_RE.test(dia)) return res.status(400).json({ erro: 'Data inválida (AAAA-MM-DD)' });
  res.json(await resumo.obter({ tenantId: req.tenantId, dia }));
}));
router.post('/resumo-diario/enviar', authMiddleware, chefia, async (req, res, next) => {
  const dia = req.body.dia;
  if (dia && !DIA_RE.test(dia)) return res.status(400).json({ erro: 'Data inválida (AAAA-MM-DD)' });
  try { res.json(await resumo.enviarAgora({ tenantId: req.tenantId, dia })); } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message, ...(e.link_whatsapp ? { link_whatsapp: e.link_whatsapp } : {}), ...(e.codigo ? { codigo: e.codigo } : {}) });
    next(e);
  }
});
router.put('/resumo-diario/config', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), h(async (req, res) => {
  const { ativo, telefone, hora } = req.body;
  res.json(await resumo.gravarConfig({ tenantId: req.tenantId, ativo, telefone, hora }));
}));

module.exports = router;
