'use strict';
/**
 * ReservasService — lista e mudança de estado das reservas (rota antiga /api/reservas).
 * A venda e a reserva pelos botões dos quartos vivem em quartos-vendas.service.js; aqui fica só o que o ecrã antigo usa.
 */
const { pool } = require('../db');
const { withTx, erro } = require('./shared');

const ESTADOS = ['CONFIRMADA', 'CHECKIN', 'CHECKOUT', 'CANCELADA', 'NO_SHOW'];
const T = t => t || null;

async function listar({ tenantId }) {
  const r = await pool.query(
    `SELECT r.*, q.numero AS quarto_numero, q.tipo AS quarto_tipo
       FROM reservas r JOIN quartos q ON q.id = r.quarto_id
      WHERE ($1::uuid IS NULL OR q.tenant_id = $1)
      ORDER BY r.criado_em DESC LIMIT 100`, [T(tenantId)]);
  return r.rows;
}

/**
 * Muda o estado. CHECKOUT, ou cancelar uma ocupação já iniciada, manda o quarto para arrumação
 * se não houver outra reserva activa nele. Tudo na mesma transacção.
 */
async function mudarEstado({ tenantId, id, status }) {
  if (!ESTADOS.includes(status)) throw erro(400, 'Status inválido');
  return withTx(async db => {
    const a = await db.query(
      `SELECT rv.id, rv.status, rv.quarto_id FROM reservas rv JOIN quartos q ON q.id = rv.quarto_id
        WHERE rv.id = $1 AND ($2::uuid IS NULL OR q.tenant_id = $2) FOR UPDATE OF rv`, [id, T(tenantId)]);
    const antes = a.rows[0];
    if (!antes) throw erro(404, 'Reserva não encontrada');
    const r = await db.query(`UPDATE reservas SET status = $1, atualizado_em = NOW() WHERE id = $2 RETURNING *`, [status, id]);
    const reserva = { ...r.rows[0], status_anterior: antes.status };
    if (status === 'CHECKOUT' || (status === 'CANCELADA' && antes.status === 'CHECKIN')) {
      const outras = await db.query(
        `SELECT 1 FROM reservas WHERE quarto_id = $1 AND status IN ('CONFIRMADA','CHECKIN') AND id <> $2 LIMIT 1`, [antes.quarto_id, id]);
      if (!outras.rows.length) await db.query(`UPDATE quartos SET status = 'LIMPEZA', atualizado_em = NOW() WHERE id = $1`, [antes.quarto_id]);
    }
    return reserva;
  });
}

module.exports = { listar, mudarEstado, ESTADOS };
