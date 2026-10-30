'use strict';
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');

// GET /api/stock
router.get('/', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
  const offset = (page - 1) * limit;
  try {
    const r = await pool.query(`
      SELECT s.*,
        CASE WHEN s.stock_atual <= s.stock_minimo THEN true ELSE false END as alerta_stock
      FROM stock_items s
      WHERE s.ativo = true AND ($1::uuid IS NULL OR s.tenant_id = $1)
      ORDER BY s.categoria, s.nome
      LIMIT $2 OFFSET $3
    `, [tenantId || null, limit, offset]);
    res.json({ data: r.rows, page, limit, total: r.rows.length });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/stock
router.post('/', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const { nome, categoria, stock_atual, stock_minimo, stock_ideal, unidade, custo_unitario, fornecedor } = req.body;
  if (!nome || !categoria || !unidade) return res.status(400).json({ erro: 'Nome, categoria e unidade são obrigatórios' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, stock_minimo, stock_ideal, unidade, custo_unitario, fornecedor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tenantId || null, nome, categoria, stock_atual || 0, stock_minimo || 0, stock_ideal || 0, unidade, custo_unitario || null, fornecedor || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('❌ Erro POST /api/stock:', e.message, e.detail || '');
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/stock/:id/movimento
router.post('/:id/movimento', authMiddleware, validarUUID('id'), async (req, res) => {
  const { tipo, quantidade, motivo } = req.body;
  const TIPOS_VALIDOS = ['VENDA','COMPRA','AJUSTE','DESPERDICIO','INVENTARIO'];
  if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo de movimento inválido' });
  if (!quantidade || isNaN(quantidade) || parseFloat(quantidade) === 0) return res.status(400).json({ erro: 'Quantidade inválida' });

  const tenantId = req.tenantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query(
      `SELECT stock_atual FROM stock_items WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2) FOR UPDATE`,
      [req.params.id, tenantId || null]
    );
    if (!s.rows[0]) throw new Error('Item não encontrado');

    const antes = parseFloat(s.rows[0].stock_atual);
    let delta;
    if (tipo === 'COMPRA' || tipo === 'INVENTARIO') delta = Math.abs(quantidade);
    else if (tipo === 'VENDA' || tipo === 'DESPERDICIO') delta = -Math.abs(quantidade);
    else delta = parseFloat(quantidade);
    const depois = antes + delta;
    if (depois < 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({ erro: 'Stock insuficiente', disponivel: antes });
    }

    await client.query(`UPDATE stock_items SET stock_atual=$1, atualizado_em=NOW() WHERE id=$2`, [depois, req.params.id]);
    const r = await client.query(
      `INSERT INTO movimentos_stock (stock_item_id, tipo, quantidade, quantidade_antes, motivo, operador_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, tipo, quantidade, antes, motivo || null, req.user.id]
    );

    await client.query('COMMIT');

    const item = await pool.query(`SELECT * FROM stock_items WHERE id=$1`, [req.params.id]);
    if (parseFloat(item.rows[0].stock_atual) <= parseFloat(item.rows[0].stock_minimo)) {
      broadcast('alerta_stock', { item: item.rows[0], mensagem: `Stock baixo: ${item.rows[0].nome}` }, item.rows[0].tenant_id || null);
    }

    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ erro: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
