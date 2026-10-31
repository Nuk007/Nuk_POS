'use strict';
/**
 * Utilitários partilhados entre services.
 */

/**
 * buildWhere — constrói cláusula WHERE parametrizada para filtros dinâmicos.
 * Extraído de routes/pedidos.js para reutilização nos services.
 */
function buildWhere(base, vals, filters = {}, alias = '') {
  const conditions = [...base];
  const values     = [...vals];
  const prefix     = alias ? `${alias}.` : '';

  for (const [col, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null && val !== '') {
      values.push(val);
      conditions.push(`${prefix}${col} = $${values.length}`);
    }
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    vals:  values,
  };
}

/**
 * withTx — corre `fn(client)` dentro de uma transacção (BEGIN/COMMIT, ROLLBACK em erro, release sempre).
 */
async function withTx(fn) {
  const { pool } = require('../db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignorar */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Erro de negócio com código HTTP (+ campos extra). */
function erro(statusCode, mensagem, extra = {}) {
  return Object.assign(new Error(mensagem), { statusCode }, extra);
}

module.exports = { buildWhere, withTx, erro };
