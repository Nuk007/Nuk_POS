'use strict';
/** ChamadasService — o cliente chama o empregado à mesa; o funcionário dá a chamada como atendida (com o tempo de resposta). */
const { pool } = require('../db');
const { erro } = require('./shared');

const T = t => t || null;

async function chamar({ tenantId, mesa_id, motivo }) {
  const m = await pool.query(`SELECT id FROM mesas WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [mesa_id, T(tenantId)]);
  if (!m.rows[0]) throw erro(404, 'Mesa não encontrada');
  const r = await pool.query(`INSERT INTO chamadas_staff (tenant_id, mesa_id, motivo) VALUES ($1,$2,$3) RETURNING *`,
    [T(tenantId), mesa_id, motivo ? String(motivo).slice(0, 200) : null]);
  return r.rows[0];
}

async function atender({ tenantId, userId, id }) {
  const r = await pool.query(`
    UPDATE chamadas_staff cs SET funcionario_id = $1, atendido_em = NOW(),
           tempo_resposta_seg = EXTRACT(EPOCH FROM (NOW() - cs.solicitado_em))::INTEGER
      FROM mesas m
     WHERE cs.id = $2 AND cs.mesa_id = m.id AND ($3::uuid IS NULL OR m.tenant_id = $3)
    RETURNING cs.*`, [userId, id, T(tenantId)]);
  if (!r.rows[0]) throw erro(404, 'Chamada não encontrada');
  return r.rows[0];
}

module.exports = { chamar, atender };
