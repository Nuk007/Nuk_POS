'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');

// GET /api/reservas
router.get('/', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT r.*, q.numero as quarto_numero, q.tipo as quarto_tipo
       FROM reservas r
       LEFT JOIN quartos q ON q.id = r.quarto_id
       WHERE ($1::uuid IS NULL OR q.tenant_id = $1)
       ORDER BY r.criado_em DESC LIMIT 100`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/reservas:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// PATCH /api/reservas/:id/status
router.patch('/:id/status', authMiddleware, validarUUID('id'), async (req, res) => {
  const STATUSES_VALIDOS = ['CONFIRMADA','CHECKIN','CHECKOUT','CANCELADA','NO_SHOW'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE reservas rv SET status=$1, atualizado_em=NOW()
       FROM quartos q
       WHERE rv.id=$2 AND rv.quarto_id = q.id
         AND ($3::uuid IS NULL OR q.tenant_id = $3)
       RETURNING rv.*`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Reserva não encontrada' });

    if (['CHECKOUT', 'CANCELADA'].includes(status)) {
      const outrasReservas = await pool.query(
        `SELECT id FROM reservas WHERE quarto_id=$1 AND status IN ('CONFIRMADA','CHECKIN') AND id != $2`,
        [r.rows[0].quarto_id, req.params.id]
      );
      if (!outrasReservas.rows.length) {
        await pool.query(`UPDATE quartos SET status='LIMPEZA', atualizado_em=NOW() WHERE id=$1`, [r.rows[0].quarto_id]);
      }
    }

    broadcast('quarto_atualizado', { quarto_id: r.rows[0].quarto_id, status }, tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
