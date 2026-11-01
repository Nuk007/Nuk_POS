'use strict';
/**
 * QuartosService — configuração dos quartos (criar, editar, remover). Isolado por estabelecimento.
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { erro } = require('./shared');

const TIPOS = ['STANDARD', 'SUPERIOR', 'SUITE', 'SUITE_PRESIDENCIAL', 'VIP_EXECUTIVO'];

function validar(d, parcial = false) {
  const out = {};
  if (!parcial || d.numero !== undefined) {
    const n = String(d.numero ?? '').trim();
    if (!n || n.length > 10) throw erro(400, 'Número do quarto obrigatório (máx. 10 caracteres)');
    out.numero = n;
  }
  if (!parcial || d.tipo !== undefined) {
    if (!TIPOS.includes(d.tipo)) throw erro(400, 'Tipo de quarto inválido');
    out.tipo = d.tipo;
  }
  for (const c of ['preco_2h', 'preco_pernoite', 'preco_diaria']) {
    if (!parcial || d[c] !== undefined) {
      const v = Number(d[c]);
      if (d[c] === '' || d[c] === null || !Number.isFinite(v) || v < 0 || v > 99999999) throw erro(400, `Preço inválido (${c})`);
      out[c] = v;
    }
  }
  if (d.andar !== undefined && d.andar !== '') {
    const a = Number(d.andar);
    if (!Number.isInteger(a) || a < -5 || a > 100) throw erro(400, 'Andar inválido');
    out.andar = a;
  }
  if (d.descricao !== undefined) out.descricao = String(d.descricao || '').trim().slice(0, 500) || null;
  return out;
}

async function criarQuarto({ tenantId, dados }) {
  if (!tenantId) throw erro(400, 'Estabelecimento em falta');
  const d = validar(dados);
  try {
    const r = await pool.query(
      `INSERT INTO quartos (tenant_id, numero, tipo, andar, preco_2h, preco_pernoite, preco_diaria, descricao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tenantId, d.numero, d.tipo, d.andar ?? 0, d.preco_2h, d.preco_pernoite, d.preco_diaria, d.descricao ?? null]);
    broadcast('quarto_atualizado', { quarto_id: r.rows[0].id }, tenantId);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw erro(409, `Já existe um quarto com o número ${d.numero}`);
    throw e;
  }
}

async function actualizarQuarto({ tenantId, id, dados }) {
  const d = validar(dados, true);
  const cols = Object.keys(d);
  if (!cols.length) throw erro(400, 'Nada para actualizar');
  // colunas vêm de validar() (lista fixa), nunca do cliente
  const sets = cols.map((c, i) => `${c}=$${i + 1}`).join(', ');
  try {
    const r = await pool.query(
      `UPDATE quartos SET ${sets}, atualizado_em=NOW()
       WHERE id=$${cols.length + 1} AND tenant_id=$${cols.length + 2} RETURNING *`,
      [...cols.map(c => d[c]), id, tenantId]);
    if (!r.rows[0]) throw erro(404, 'Quarto não encontrado');
    broadcast('quarto_atualizado', { quarto_id: id }, tenantId);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw erro(409, `Já existe um quarto com o número ${d.numero}`);
    throw e;
  }
}

async function removerQuarto({ tenantId, id }) {
  const q = await pool.query(`SELECT id, status FROM quartos WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  if (!q.rows[0]) throw erro(404, 'Quarto não encontrado');
  if (q.rows[0].status === 'OCUPADO') throw erro(409, 'Quarto ocupado — faça o checkout primeiro');
  const res = await pool.query(`SELECT 1 FROM reservas WHERE quarto_id=$1 LIMIT 1`, [id]);
  if (res.rows[0]) throw erro(409, 'Quarto com histórico de reservas — não pode ser apagado; marque-o como BLOQUEADO');
  await pool.query(`DELETE FROM quartos WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  broadcast('quarto_atualizado', { quarto_id: id, removido: true }, tenantId);
}

module.exports = { criarQuarto, actualizarQuarto, removerQuarto, TIPOS };
