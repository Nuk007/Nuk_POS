'use strict';
/** ClientesService — ficha de clientes do POS (lista paginada com pesquisa e cadastro ao balcão). */
const { pool } = require('../db');
const { erro } = require('./shared');

const T = t => t || null;
// pesquisa literal: %, _ e \ escritos pelo utilizador não são curingas
const termo = q => `%${String(q).slice(0, 100).replace(/[\\%_]/g, c => '\\' + c)}%`;

async function listar({ tenantId, q, page, limit }) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const vals = [T(tenantId)];
  let filtro = `ativo = true AND ($1::uuid IS NULL OR tenant_id = $1)`;
  if (q) { vals.push(termo(q)); filtro += ` AND (nome ILIKE $2 OR telefone ILIKE $2 OR email ILIKE $2)`; }
  const [r, c] = await Promise.all([
    pool.query(`SELECT id, nome, telefone, email, nivel_fidelizacao, saldo_carteira, nukcoin_saldo, estrelas, pontos, criado_em
                  FROM clientes WHERE ${filtro} ORDER BY nome LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
    [...vals, limit, (page - 1) * limit]),
    pool.query(`SELECT COUNT(*) FROM clientes WHERE ${filtro}`, vals),
  ]);
  return { data: r.rows, page, limit, total: parseInt(c.rows[0].count, 10) };
}

/** Telefone no formato do portal (9XXXXXXXX): aceita «+244 9xx xxx xxx» e guarda sem espaços nem indicativo. */
function normalizarTelefone(v) {
  if (!v) return null;
  const t = String(v).replace(/[\s-]/g, '').replace(/^(\+?244)/, '');
  if (!/^9[0-9]{8}$/.test(t)) throw erro(400, 'Telefone inválido (9XXXXXXXX)');
  return t;
}

async function criar({ tenantId, nome, telefone, email, nif }) {
  nome = nome == null ? '' : String(nome).trim();
  if (!nome) throw erro(400, 'Nome é obrigatório');
  if (nome.length > 200) throw erro(400, 'Nome demasiado longo (máximo 200)');
  const tel = normalizarTelefone(telefone);
  try {
    const r = await pool.query(
      `INSERT INTO clientes (tenant_id, nome, telefone, email, nif) VALUES ($1,$2,$3,$4,$5) RETURNING id, nome, telefone, email`,
      [T(tenantId), nome, tel, email || null, nif || null]);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw erro(409, 'Telefone ou email já registado');
    throw e;
  }
}

module.exports = { listar, criar, normalizarTelefone };
