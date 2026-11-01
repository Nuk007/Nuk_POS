'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');

// GET /api/produtos
router.get('/', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT * FROM produtos WHERE ($1::uuid IS NULL OR tenant_id = $1) ORDER BY categoria, nome`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/produtos
router.post('/', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const { nome, descricao, preco, categoria, disponivel } = req.body;
  if (!nome || preco === undefined) {
    return res.status(400).json({ erro: 'nome e preco são obrigatórios' });
  }
  const precoNum = parseFloat(preco);
  if (isNaN(precoNum) || precoNum < 0) {
    return res.status(400).json({ erro: 'preco inválido' });
  }
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `INSERT INTO produtos (id, tenant_id, nome, descricao, preco, categoria, disponivel, ativo, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
       RETURNING *`,
      [uuidv4(), tenantId || null, nome.trim(), descricao || null,
       precoNum, categoria || null, disponivel !== false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// PUT /api/produtos/:id
router.put('/:id', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const { id } = req.params;
  if (!isUUID(id)) return res.status(400).json({ erro: 'id inválido' });
  const { nome, descricao, preco, categoria, disponivel, ativo } = req.body;
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE produtos SET
         nome = COALESCE($1, nome),
         descricao = COALESCE($2, descricao),
         preco = COALESCE($3, preco),
         categoria = COALESCE($4, categoria),
         disponivel = COALESCE($5, disponivel),
         ativo = COALESCE($6, ativo),
         atualizado_em = NOW()
       WHERE id = $7 AND ($8::uuid IS NULL OR tenant_id = $8)
       RETURNING *`,
      [nome || null, descricao || null,
       preco !== undefined ? parseFloat(preco) : null,
       categoria || null,
       disponivel !== undefined ? disponivel : null,
       ativo !== undefined ? ativo : null,
       id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Produto não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

/**
 * @openapi
 * /api/produtos/{id}/ingredientes:
 *   get:
 *     summary: Receita do produto — o que cada venda consome do stock
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: "Lista de ingredientes (stock_item_id, nome, unidade, quantidade)" }, 404: { description: Produto não encontrado } }
 *   put:
 *     summary: Define a receita do produto (lista vazia = não abate stock). ADMIN/GERENTE
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [ingredientes], properties: { ingredientes: { type: array, items: { type: object, properties: { stock_item_id: { type: string, format: uuid }, quantidade: { type: number } } } } } } } } }
 *     responses: { 200: { description: Receita actualizada }, 400: { description: Dados inválidos }, 404: { description: Produto ou item não encontrado } }
 */
const stockSvc = require('../services/stock.service');
const comErros = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
router.get('/:id/ingredientes', authMiddleware, (req, res, next) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  comErros(r => stockSvc.obterIngredientes({ tenantId: r.tenantId, produtoId: r.params.id }))(req, res, next);
});
router.put('/:id/ingredientes', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), (req, res, next) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  comErros(r => stockSvc.definirIngredientes({ tenantId: r.tenantId, produtoId: r.params.id, ingredientes: r.body.ingredientes }))(req, res, next);
});

module.exports = router;
