'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, validarUUID, isUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');

// POST /api/chamadas
router.post('/', authMiddleware, async (req, res) => {
  const { mesa_id, motivo } = req.body;
  if (!mesa_id || !isUUID(mesa_id)) return res.status(400).json({ erro: 'mesa_id inválido' });
  const tenantId = req.tenantId;
  try {
    const mesa = await pool.query(
      `SELECT id FROM mesas WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`,
      [mesa_id, tenantId || null]
    );
    if (!mesa.rows[0]) return res.status(404).json({ erro: 'Mesa não encontrada' });
    const r = await pool.query(
      `INSERT INTO chamadas_staff (mesa_id, motivo) VALUES ($1,$2) RETURNING *`,
      [mesa_id, motivo || null]
    );
    broadcast('chamada_staff', { mesa_id, motivo, id: r.rows[0].id }, tenantId);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// PATCH /api/chamadas/:id/atender
router.patch('/:id/atender', authMiddleware, validarUUID('id'), async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(`
      UPDATE chamadas_staff cs SET funcionario_id=$1, atendido_em=NOW(),
      tempo_resposta_seg=EXTRACT(EPOCH FROM (NOW()-cs.solicitado_em))::INTEGER
      FROM mesas m
      WHERE cs.id=$2 AND cs.mesa_id = m.id
        AND ($3::uuid IS NULL OR m.tenant_id=$3)
      RETURNING cs.*
    `, [req.user.id, req.params.id, tenantId || null]);
    if (!r.rows[0]) return res.status(404).json({ erro: 'Chamada não encontrada' });
    broadcast('chamada_atendida', r.rows[0], tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
