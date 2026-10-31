'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/clientes
router.get('/', authMiddleware, async (req, res) => {
  const { q } = req.query;
  const tenantId = req.tenantId;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  try {
    let query = `SELECT id, nome, telefone, email, nivel_fidelizacao, saldo_carteira, nukcoin_saldo, estrelas, pontos, criado_em
                 FROM clientes WHERE ativo=true AND ($1::uuid IS NULL OR tenant_id = $1)`;
    const vals = [tenantId || null];
    if (q) { query += ` AND (nome ILIKE $2 OR telefone ILIKE $2 OR email ILIKE $2)`; vals.push(`%${q}%`); }
    // M-01 fix: contar total real antes de aplicar LIMIT/OFFSET
    let countQ = `SELECT COUNT(*) FROM clientes WHERE ativo=true AND ($1::uuid IS NULL OR tenant_id = $1)`;
    const countVals = [tenantId || null];
    if (q) { countQ += ` AND (nome ILIKE $2 OR telefone ILIKE $2 OR email ILIKE $2)`; countVals.push(`%${q}%`); }
    query += ` ORDER BY nome LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
    vals.push(limit, offset);
    const [r, countR] = await Promise.all([pool.query(query, vals), pool.query(countQ, countVals)]);
    res.json({ data: r.rows, page, limit, total: parseInt(countR.rows[0].count) });
  } catch (e) {
    console.error('GET /api/clientes:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/clientes
router.post('/', authMiddleware, async (req, res) => {
  const { nome, email, nif } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
  // telefone no formato do portal (9XXXXXXXX): aceita "+244 9xx xxx xxx" e guarda sem espaços nem indicativo
  let telefone = req.body.telefone ? String(req.body.telefone).replace(/[\s-]/g, '').replace(/^(\+?244)/, '') : null;
  if (telefone && !/^9[0-9]{8}$/.test(telefone)) return res.status(400).json({ erro: 'Telefone inválido (9XXXXXXXX)' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `INSERT INTO clientes (tenant_id, nome, telefone, email, nif) VALUES ($1,$2,$3,$4,$5) RETURNING id, nome, telefone, email`,
      [tenantId || null, nome, telefone || null, email || null, nif || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erro: 'Telefone ou email já registado' });
    console.error('❌ Erro POST /api/clientes:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
