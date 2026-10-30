'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');

// GET /api/funcionarios
router.get('/', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT id, nome, email, nivel_acesso, ativo, criado_em
       FROM funcionarios
       WHERE ($1::uuid IS NULL OR tenant_id = $1)
       ORDER BY nome`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/funcionarios
router.post('/', authMiddleware, requerNivel(['ADMIN']), async (req, res) => {
  const { nome, email, password, nivel_acesso } = req.body;
  const NIVEIS = ['ADMIN', 'GERENTE', 'OPERADOR', 'CAIXA'];
  if (!nome || !email || !password) {
    return res.status(400).json({ erro: 'nome, email e password são obrigatórios' });
  }
  if (!NIVEIS.includes(nivel_acesso)) {
    return res.status(400).json({ erro: `nivel_acesso inválido. Valores: ${NIVEIS.join(', ')}` });
  }
  const tenantId = req.tenantId;
  try {
    // M-02 fix: unicidade de email por tenant, não global
    const ex = await pool.query(
      `SELECT id FROM funcionarios WHERE LOWER(email) = LOWER($1) AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [email.trim(), tenantId || null]
    );
    if (ex.rows[0]) return res.status(409).json({ erro: 'Email já registado neste estabelecimento' });

    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO funcionarios (id, tenant_id, nome, email, password_hash, nivel_acesso, ativo, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
       RETURNING id, nome, email, nivel_acesso, ativo, criado_em`,
      [uuidv4(), tenantId || null, nome.trim(), email.trim().toLowerCase(), hash, nivel_acesso]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// PUT /api/funcionarios/:id
router.put('/:id', authMiddleware, requerNivel(['ADMIN']), async (req, res) => {
  const { id } = req.params;
  if (!isUUID(id)) return res.status(400).json({ erro: 'id inválido' });
  const { nome, nivel_acesso, ativo, password } = req.body;
  // M-03 fix: validar nivel_acesso também no PUT, não apenas no POST
  const NIVEIS = ['ADMIN', 'GERENTE', 'OPERADOR', 'CAIXA'];
  if (nivel_acesso !== undefined && !NIVEIS.includes(nivel_acesso)) {
    return res.status(400).json({ erro: `nivel_acesso inválido. Valores: ${NIVEIS.join(', ')}` });
  }
  const tenantId = req.tenantId;
  try {
    let hash = undefined;
    if (password) hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `UPDATE funcionarios SET
         nome = COALESCE($1, nome),
         nivel_acesso = COALESCE($2, nivel_acesso),
         ativo = COALESCE($3, ativo),
         password_hash = COALESCE($4, password_hash)
       WHERE id = $5 AND ($6::uuid IS NULL OR tenant_id = $6)
       RETURNING id, nome, email, nivel_acesso, ativo`,
      [nome || null, nivel_acesso || null, ativo !== undefined ? ativo : null,
       hash || null, id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Funcionário não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
