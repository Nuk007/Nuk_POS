'use strict';
/**
 * /api/precos — níveis de preço e prato do dia (rotas finas; lógica em services/precos.service.js).
 * Leitura dos preços em vigor: qualquer funcionário (painel de venda). Configuração: só ADMIN.
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const svc = require('../services/precos.service');
const { pool } = require('../db');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const admin = requerNivel(['ADMIN']);
const uuid = nome => (req, res, next) => (isUUID(req.params[nome]) ? next() : res.status(400).json({ erro: `${nome} inválido` }));
const campos = b => ({ nome: b.nome, prioridade: b.prioridade, ativa: b.ativa, origens: b.origens, dias: b.dias, hora_inicio: b.hora_inicio, hora_fim: b.hora_fim, data_inicio: b.data_inicio, data_fim: b.data_fim, desconto_pct: b.desconto_pct });

/**
 * @openapi
 * /api/precos/actuais:
 *   get:
 *     summary: Tabela de preços em vigor agora (hora de Luanda) para um fluxo de venda, e os preços dela
 *     tags: [Preços]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: origem, schema: { type: string, enum: [MESA, BALCAO, REMOTA, TAKEAWAY, LAZER, LOJA, QUARTO] } }]
 *     responses: { 200: { description: "{ tabela, precos }" } }
 * /api/precos/tabelas:
 *   get:
 *     summary: Tabelas de preço do estabelecimento (até 5) com os preços (só ADMIN)
 *     tags: [Preços]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista } }
 *   post:
 *     summary: Cria uma tabela (nome, prioridade, ativa, origens, dias 0-6, hora_inicio/hora_fim HH:MM) — só ADMIN
 *     tags: [Preços]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Criada }, 409: { description: Já há 5 ou nome repetido } }
 * /api/precos/tabelas/{id}:
 *   put: { summary: Altera a tabela (só ADMIN), tags: [Preços], security: [{ bearerAuth: [] }], responses: { 200: { description: Alterada } } }
 *   delete: { summary: Apaga a tabela e os seus preços (só ADMIN), tags: [Preços], security: [{ bearerAuth: [] }], responses: { 200: { description: Apagada } } }
 * /api/precos/tabelas/{id}/precos:
 *   put:
 *     summary: Define (preco) ou retira (preco null) preços de produtos na tabela — só ADMIN
 *     tags: [Preços]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Preços da tabela } }
 * /api/precos/prato-do-dia/{produtoId}:
 *   put:
 *     summary: Marca/desmarca um produto como prato do dia (só ADMIN)
 *     tags: [Preços]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Produto } }
 */
router.get('/actuais', authMiddleware, h(async (req, res) => {
  const origem = String(req.query.origem || 'BALCAO').toUpperCase();
  if (!svc.ORIGENS.includes(origem)) return res.status(400).json({ erro: 'origem inválida' });
  res.json(await svc.precosAplicaveis(pool, { tenantId: req.tenantId, origem }));
}));
router.get('/tabelas', authMiddleware, admin, h(async (req, res) => res.json(await svc.listar({ tenantId: req.tenantId }))));
router.post('/tabelas', authMiddleware, admin, h(async (req, res) => res.status(201).json(await svc.criar({ ...campos(req.body || {}), tenantId: req.tenantId }))));
router.put('/tabelas/:id', authMiddleware, admin, uuid('id'), h(async (req, res) => res.json(await svc.actualizar({ ...campos(req.body || {}), id: req.params.id, tenantId: req.tenantId }))));
router.delete('/tabelas/:id', authMiddleware, admin, uuid('id'), h(async (req, res) => res.json(await svc.apagar({ id: req.params.id, tenantId: req.tenantId }))));
router.put('/tabelas/:id/precos', authMiddleware, admin, uuid('id'), h(async (req, res) => {
  const precos = (req.body || {}).precos;
  if (Array.isArray(precos) && precos.some(p => !p || !isUUID(p.produto_id))) return res.status(400).json({ erro: 'produto_id inválido' });
  res.json(await svc.definirPrecos({ id: req.params.id, precos, tenantId: req.tenantId }));
}));
router.put('/prato-do-dia/:produtoId', authMiddleware, admin, uuid('produtoId'), h(async (req, res) => {
  res.json(await svc.pratoDoDia({ produtoId: req.params.produtoId, ativo: (req.body || {}).ativo, tenantId: req.tenantId }));
}));

module.exports = router;
