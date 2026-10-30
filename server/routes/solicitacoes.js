'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');

// GET /api/solicitacoes-hospedagem
router.get('/', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT s.*, c.nome as cliente_nome, c.telefone as cliente_telefone
       FROM solicitacoes_hospedagem s
       LEFT JOIN clientes c ON c.id = s.cliente_id
       WHERE ($1::uuid IS NULL OR c.tenant_id = $1 OR (s.cliente_id IS NULL AND $1 IS NULL))
       ORDER BY s.criado_em DESC LIMIT 100`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/solicitacoes-hospedagem:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// PATCH /api/solicitacoes-hospedagem/:id/status
router.patch('/:id/status', authMiddleware, validarUUID('id'), requerNivel(['ADMIN','GERENTE']), async (req, res) => {
  const STATUSES_VALIDOS = ['PENDENTE','CONFIRMADA','CANCELADA'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE solicitacoes_hospedagem s SET status=$1, atualizado_em=NOW()
       FROM (
         SELECT sh.id FROM solicitacoes_hospedagem sh
         LEFT JOIN clientes c ON c.id = sh.cliente_id
         WHERE sh.id = $2
           AND ($3::uuid IS NULL OR c.tenant_id = $3 OR sh.cliente_id IS NULL)
       ) sub
       WHERE s.id = sub.id
       RETURNING s.*`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Solicitação não encontrada' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PATCH /api/solicitacoes-hospedagem/:id/status:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
