'use strict';
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');

// GET /api/quartos
router.get('/', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(`
      SELECT q.*,
        (SELECT json_agg(json_build_object('id',r.id,'checkin',r.checkin,'checkout',r.checkout,'status',r.status,'nome_hospede',r.nome_hospede,'fracao',r.fracao))
         FROM reservas r WHERE r.quarto_id = q.id AND r.status IN ('CONFIRMADA','CHECKIN')
         AND r.checkout > NOW()) as reservas_activas
      FROM quartos q
      WHERE ($1::uuid IS NULL OR q.tenant_id = $1)
      ORDER BY q.tipo, q.numero
    `, [tenantId || null]);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/quartos:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/quartos/reserva
router.post('/reserva', authMiddleware, async (req, res) => {
  const { quarto_id, nome_hospede, fracao, checkin, checkout, cliente_id, observacoes } = req.body;
  if (!quarto_id || !fracao || !checkin || !checkout) {
    return res.status(400).json({ erro: 'Quarto, fracção, check-in e check-out são obrigatórios' });
  }
  const tenantId = req.tenantId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const q = await client.query(
      `SELECT id, status, preco_2h, preco_pernoite, preco_diaria FROM quartos
       WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE NOWAIT`,
      [quarto_id, tenantId || null]
    );
    if (!q.rows[0]) throw new Error('Quarto não encontrado');

    const conflito = await client.query(`
      SELECT id FROM reservas
      WHERE quarto_id=$1 AND status IN ('CONFIRMADA','CHECKIN')
      AND NOT (checkout <= $2 OR checkin >= $3)
    `, [quarto_id, checkin, checkout]);
    if (conflito.rows.length) throw new Error('Quarto já reservado neste período');

    const precos = { DUAS_HORAS: q.rows[0].preco_2h, PERNOITE: q.rows[0].preco_pernoite, DIARIA: q.rows[0].preco_diaria };
    const valor_total = precos[fracao] || 0;

    const r = await client.query(`
      INSERT INTO reservas (tenant_id, quarto_id, cliente_id, nome_hospede, fracao, checkin, checkout, valor_total, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [tenantId || null, quarto_id, cliente_id || null, nome_hospede || null, fracao, checkin, checkout, valor_total, observacoes || null]);

    await client.query(`UPDATE quartos SET status='OCUPADO', atualizado_em=NOW() WHERE id=$1`, [quarto_id]);

    await client.query('COMMIT');
    broadcast('quarto_atualizado', { quarto_id, status: 'OCUPADO' }, tenantId || null);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ erro: e.message });
  } finally {
    client.release();
  }
});

// PATCH /api/quartos/:id/status
router.patch('/:id/status', authMiddleware, validarUUID('id'), requerNivel(['ADMIN','GERENTE']), async (req, res) => {
  const STATUSES_VALIDOS = ['DISPONIVEL','OCUPADO','LIMPEZA','MANUTENCAO','BLOQUEADO'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE quartos SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND ($3::uuid IS NULL OR tenant_id = $3) RETURNING *`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Quarto não encontrado' });
    broadcast('quarto_atualizado', { quarto_id: req.params.id, status }, tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
