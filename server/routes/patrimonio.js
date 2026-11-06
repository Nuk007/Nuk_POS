'use strict';
/**
 * /api/patrimonio — bens do estabelecimento (rotas finas; lógica em services/patrimonio.service.js).
 */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const svc = require('../services/patrimonio.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
const base = req => ({ tenantId: req.tenantId, userId: req.user && req.user.id });
const comId = fn => h(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido' });
  return fn(req, res);
});

/**
 * @openapi
 * /api/patrimonio:
 *   get:
 *     summary: Bens do estabelecimento com o valor actual (depreciação linear). Filtros ?estado=ACTIVOS|BOM|REGULAR|MAU|ABATIDO e ?categoria=
 *     tags: [Património]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista de bens } }
 *   post:
 *     summary: Regista um bem (código PAT-0001… automático)
 *     tags: [Património]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [nome, categoria, data_aquisicao, valor_aquisicao, vida_util_anos], properties: { nome: { type: string }, categoria: { type: string }, localizacao: { type: string }, data_aquisicao: { type: string, format: date }, valor_aquisicao: { type: number }, vida_util_anos: { type: integer }, estado: { type: string, enum: [BOM, REGULAR, MAU] }, observacoes: { type: string } } } } } }
 *     responses: { 201: { description: Bem registado } }
 * /api/patrimonio/resumo:
 *   get: { summary: "Totais (bens activos, valor de aquisição e actual, por categoria)", tags: [Património], security: [{ bearerAuth: [] }], responses: { 200: { description: Resumo } } }
 * /api/patrimonio/{id}:
 *   patch: { summary: "Corrige os dados de um bem activo (o estado só pode ser Bom, Regular ou Mau)", tags: [Património], security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Actualizado } } }
 * /api/patrimonio/{id}/abater:
 *   post: { summary: "Dá baixa ao bem (obrigatório o motivo); fica no registo com valor 0", tags: [Património], security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Abatido } } }
 */
router.get('/resumo', authMiddleware, h(async (req, res) => res.json(await svc.resumo(base(req)))));
router.get('/', authMiddleware, h(async (req, res) => res.json(await svc.listar({ estado: req.query.estado, categoria: req.query.categoria, ...base(req) }))));
router.post('/', authMiddleware, h(async (req, res) => res.status(201).json(await svc.criar({ ...req.body, ...base(req) }))));
router.patch('/:id', authMiddleware, comId(async (req, res) => res.json(await svc.atualizar({ ...req.body, id: req.params.id, ...base(req) }))));
router.post('/:id/abater', authMiddleware, comId(async (req, res) => res.json(await svc.abater({ motivo: req.body.motivo, id: req.params.id, ...base(req) }))));

module.exports = router;
