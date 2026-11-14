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

/**
 * Palavra-passe dos funcionários: 6 a 8 dígitos (decisão do dono de 14/11/2026, para todas as aplicações dele).
 * Só se valida ao DEFINIR (criar, alterar, activar); no login compara-se o que vier, para as palavras-passe
 * antigas (letras e números) continuarem a funcionar até cada pessoa a mudar. O limitador de login e o bcrypt
 * protegem contra adivinhas.
 */
const PALAVRA_PASSE_RE = /^\d{6,8}$/;
function validarPalavraPasse(p) {
  if (!PALAVRA_PASSE_RE.test(String(p == null ? '' : p))) throw erro(400, 'A palavra-passe tem de ter entre 6 e 8 dígitos.');
  return String(p);
}

/**
 * Chave de idempotência enviada pelo aparelho (uma por envio): 8 a 64 letras, números, «-» ou «_».
 * Devolve null quando não vem (comportamento antigo).
 */
function validarChaveIdempotencia(chave) {
  if (chave === undefined || chave === null || chave === '') return null;
  const c = String(chave);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(c)) throw erro(400, 'Chave de idempotência inválida');
  return c;
}

module.exports = { PALAVRA_PASSE_RE, validarPalavraPasse, buildWhere, withTx, erro, validarChaveIdempotencia };
