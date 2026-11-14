'use strict';
/**
 * /api/impressao — documentos para impressão directa em térmicas (rotas finas; lógica em services/impressao.service.js).
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, isUUID } = require('../middleware/auth');
const svc = require('../services/impressao.service');
const rede = require('../services/agente-impressao.service');
const { requerNivel } = require('../middleware/auth');
const { exigirModulo } = require('../middleware/modulos');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const comTenant = (req, res, next) => (req.tenantId ? next() : res.status(400).json({ erro: 'Sem estabelecimento' }));

/**
 * @openapi
 * /api/impressao/preparacao/reclamar:
 *   post:
 *     summary: Talões novos de cozinha/bar para este dispositivo (cada talão sai uma só vez, mesmo com vários dispositivos)
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { posto: { type: string, enum: [COZINHA, BAR] }, colunas: { type: integer, enum: [32, 42, 48] } } } } } }
 *     responses: { 200: { description: "Lista de documentos { linhas, cortar, gaveta }" } }
 * /api/impressao/preparacao/{pedidoId}:
 *   get:
 *     summary: Reimpressão do talão de cozinha/bar de um pedido
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Documento }, 404: { description: Nada deste posto no pedido } }
 * /api/impressao/recibo:
 *   post:
 *     summary: Recibo do cliente de um ou mais pedidos (gaveta = true se houve pagamento em dinheiro)
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [pedido_ids], properties: { pedido_ids: { type: array, items: { type: string, format: uuid } }, colunas: { type: integer } } } } } }
 *     responses: { 200: { description: Documento } }
 */
router.post('/preparacao/reclamar', authMiddleware, comTenant, h(async (req, res) => {
  const b = req.body || {};
  res.json(await svc.reclamar({ tenantId: req.tenantId, userId: req.user && req.user.id, posto: String(b.posto || '').toUpperCase(), colunas: b.colunas, limite: b.limite }));
}));
router.get('/preparacao/:pedidoId', authMiddleware, comTenant, h(async (req, res) => {
  if (!isUUID(req.params.pedidoId)) return res.status(400).json({ erro: 'pedidoId inválido' });
  res.json(await svc.talaoPreparacao({ tenantId: req.tenantId, pedidoId: req.params.pedidoId, posto: String(req.query.posto || '').toUpperCase(), colunas: req.query.colunas }));
}));
router.post('/recibo', authMiddleware, comTenant, h(async (req, res) => {
  const ids = (req.body || {}).pedido_ids;
  if (!Array.isArray(ids) || ids.some(i => !isUUID(i))) return res.status(400).json({ erro: 'pedido_ids inválidos' });
  res.json(await svc.recibo({ tenantId: req.tenantId, pedidoIds: [...new Set(ids)], colunas: (req.body || {}).colunas }));
}));

/**
 * @openapi
 * /api/impressao/rede:
 *   post:
 *     summary: Põe na fila um documento ESC/POS (base64) para uma impressora de rede, entregue pelo agente local
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [impressora, dados], properties: { impressora: { type: string, example: "192.168.1.50:9100" }, dados: { type: string, format: byte } } } } } }
 *     responses: { 201: { description: Trabalho na fila }, 400: { description: IP não privado ou porta fora de 9100–9109 }, 409: { description: Sem agente configurado } }
 * /api/impressao/rede/{id}:
 *   get:
 *     summary: Estado de um trabalho de impressão em rede
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ estado, erro }" } }
 * /api/impressao/agentes:
 *   get:
 *     summary: Agentes de impressão em rede do estabelecimento (só ADMIN)
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista com online e fila } }
 *   post:
 *     summary: Cria um agente; o token é mostrado uma só vez (só ADMIN)
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [nome], properties: { nome: { type: string } } } } } }
 *     responses: { 201: { description: "{ id, nome, token }" } }
 * /api/impressao/agentes/{id}/revogar:
 *   post:
 *     summary: Revoga um agente (o token deixa de funcionar)
 *     tags: [Impressão]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Revogado } }
 */
router.post('/rede', authMiddleware, comTenant, h(async (req, res) => {
  res.status(201).json(await rede.enfileirar({ tenantId: req.tenantId, userId: req.user.id, impressora: req.body.impressora, dados: req.body.dados }));
}));
router.get('/rede/:id', authMiddleware, comTenant, h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  res.json(await rede.estadoTrabalho({ tenantId: req.tenantId, id: req.params.id }));
}));
const adminCfg = [authMiddleware, comTenant, requerNivel(['ADMIN']), exigirModulo('configuracoes')];
router.get('/agentes', ...adminCfg, h(async (req, res) => res.json(await rede.listarAgentes({ tenantId: req.tenantId }))));
router.post('/agentes', ...adminCfg, h(async (req, res) => res.status(201).json(await rede.criarAgente({ tenantId: req.tenantId, userId: req.user.id, nome: req.body.nome }))));
router.post('/agentes/:id/revogar', ...adminCfg, h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  res.json(await rede.revogarAgente({ tenantId: req.tenantId, id: req.params.id }));
}));

module.exports = router;
