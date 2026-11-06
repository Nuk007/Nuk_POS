'use strict';
/**
 * PatrimonioService — registo dos bens do estabelecimento com depreciação linear (sem valor residual).
 * Valor actual = valor de aquisição × (1 − anos decorridos / vida útil), nunca abaixo de zero; bem abatido vale 0.
 * Nada se apaga: um bem abate-se (com motivo).
 */
const { pool } = require('../db');
const { withTx, erro } = require('./shared');
const listas = require('./listas.service');

const ESTADOS_EDITAVEIS = ['BOM', 'REGULAR', 'MAU'];
const arred = n => Math.round(n * 100) / 100;
const ehData = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const texto = (v, max, obrig, nome) => {
  const t = v === undefined || v === null ? '' : String(v).trim();
  if (obrig && !t) throw erro(400, `${nome} é obrigatório`);
  return t ? t.slice(0, max) : null;
};
const hojeLuanda = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);

/** Depreciação linear: anos completos em fracção (dias/365,25). */
function valorActual({ valor_aquisicao, data_aquisicao, vida_util_anos, estado }, hoje = hojeLuanda()) {
  if (estado === 'ABATIDO') return 0;
  const dias = Math.max(0, (Date.parse(hoje + 'T00:00:00Z') - Date.parse(data_aquisicao + 'T00:00:00Z')) / 86400000);
  const fraccao = Math.min(1, dias / 365.25 / vida_util_anos);
  return arred(parseFloat(valor_aquisicao) * (1 - fraccao));
}
const COLS = `id, codigo, nome, categoria, localizacao, to_char(data_aquisicao,'YYYY-MM-DD') AS data_aquisicao, valor_aquisicao, vida_util_anos, estado, observacoes, abatido_em, motivo_abate`;
const decorar = b => ({ ...b, valor_aquisicao: parseFloat(b.valor_aquisicao), valor_actual: valorActual(b) });

async function listar({ tenantId, estado, categoria }) {
  const vals = [tenantId];
  let filtro = '';
  if (estado === 'ACTIVOS') filtro += ` AND estado <> 'ABATIDO'`;
  else if (estado) { vals.push(estado); filtro += ` AND estado = $${vals.length}::text`; }
  if (categoria) { vals.push(categoria); filtro += ` AND categoria = $${vals.length}::text`; }
  const r = await pool.query(`SELECT ${COLS} FROM patrimonio_bens WHERE tenant_id = $1 ${filtro} ORDER BY codigo`, vals);
  return r.rows.map(decorar);
}

async function resumo({ tenantId }) {
  const r = await pool.query(`SELECT ${COLS} FROM patrimonio_bens WHERE tenant_id = $1 AND estado <> 'ABATIDO'`, [tenantId]);
  const bens = r.rows.map(decorar);
  const porCategoria = {};
  for (const b of bens) {
    const c = porCategoria[b.categoria] || (porCategoria[b.categoria] = { bens: 0, valor_aquisicao: 0, valor_actual: 0 });
    c.bens++; c.valor_aquisicao = arred(c.valor_aquisicao + b.valor_aquisicao); c.valor_actual = arred(c.valor_actual + b.valor_actual);
  }
  return {
    bens: bens.length,
    em_mau_estado: bens.filter(b => b.estado === 'MAU').length,
    valor_aquisicao: arred(bens.reduce((a, b) => a + b.valor_aquisicao, 0)),
    valor_actual: arred(bens.reduce((a, b) => a + b.valor_actual, 0)),
    por_categoria: porCategoria,
  };
}

function validarDados({ nome, localizacao, data_aquisicao, valor_aquisicao, vida_util_anos, estado, observacoes }, parcial = false) {
  const out = {};
  if (!parcial || nome !== undefined) out.nome = texto(nome, 160, true, 'Nome');
  if (localizacao !== undefined) out.localizacao = texto(localizacao, 120);
  if (observacoes !== undefined) out.observacoes = texto(observacoes, 1000);
  if (!parcial || data_aquisicao !== undefined) {
    if (!ehData(String(data_aquisicao || ''))) throw erro(400, 'Data de aquisição inválida (AAAA-MM-DD)');
    if (data_aquisicao > hojeLuanda()) throw erro(400, 'A data de aquisição não pode ser futura');
    out.data_aquisicao = data_aquisicao;
  }
  if (!parcial || valor_aquisicao !== undefined) {
    const v = Number(valor_aquisicao);
    if (valor_aquisicao === '' || valor_aquisicao === null || !Number.isFinite(v) || v < 0 || v > 1e12) throw erro(400, 'Valor de aquisição inválido');
    out.valor_aquisicao = arred(v);
  }
  if (!parcial || vida_util_anos !== undefined) {
    const a = Number(vida_util_anos);
    if (!Number.isInteger(a) || a < 1 || a > 100) throw erro(400, 'A vida útil tem de ser entre 1 e 100 anos');
    out.vida_util_anos = a;
  }
  if (estado !== undefined) {
    if (!ESTADOS_EDITAVEIS.includes(estado)) throw erro(400, 'Estado inválido (Bom, Regular ou Mau); para dar baixa use «Abater»');
    out.estado = estado;
  }
  return out;
}

async function criar({ tenantId, userId, categoria, ...dados }) {
  const d = validarDados(dados);
  await listas.exigirValor(tenantId, 'CATEGORIA_PATRIMONIO', categoria, 'Categoria');
  return withTx(async db => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, ['patrimonio:' + tenantId]);
    const n = await db.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo, '\\D', '', 'g'), '')::int), 0) + 1 AS n FROM patrimonio_bens WHERE tenant_id = $1`, [tenantId]);
    const codigo = 'PAT-' + String(n.rows[0].n).padStart(4, '0');
    const r = await db.query(
      `INSERT INTO patrimonio_bens (tenant_id, codigo, nome, categoria, localizacao, data_aquisicao, valor_aquisicao, vida_util_anos, estado, observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11) RETURNING ${COLS}`,
      [tenantId, codigo, d.nome, categoria, d.localizacao || null, d.data_aquisicao, d.valor_aquisicao, d.vida_util_anos, d.estado || 'BOM', d.observacoes || null, userId || null]);
    return decorar(r.rows[0]);
  });
}

async function atualizar({ tenantId, id, categoria, ...dados }) {
  const d = validarDados(dados, true);
  if (categoria !== undefined) { await listas.exigirValor(tenantId, 'CATEGORIA_PATRIMONIO', categoria, 'Categoria'); d.categoria = categoria; }
  const cols = Object.keys(d);
  if (!cols.length) throw erro(400, 'Nada para alterar');
  const vals = cols.map(c => d[c]);
  const sets = cols.map((c, i) => `${c} = $${i + 1}${c === 'data_aquisicao' ? '::date' : ''}`).join(', '); // colunas fixas no código
  vals.push(id, tenantId);
  const r = await pool.query(`UPDATE patrimonio_bens SET ${sets} WHERE id = $${vals.length - 1}::uuid AND tenant_id = $${vals.length} AND estado <> 'ABATIDO' RETURNING ${COLS}`, vals);
  if (!r.rows[0]) throw erro(404, 'Bem não encontrado (ou já abatido)');
  return decorar(r.rows[0]);
}

async function abater({ tenantId, id, motivo }) {
  const m = texto(motivo, 1000, true, 'O motivo do abate');
  const r = await pool.query(
    `UPDATE patrimonio_bens SET estado = 'ABATIDO', abatido_em = NOW(), motivo_abate = $1 WHERE id = $2::uuid AND tenant_id = $3 AND estado <> 'ABATIDO' RETURNING ${COLS}`, [m, id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Bem não encontrado (ou já abatido)');
  return decorar(r.rows[0]);
}

module.exports = { listar, resumo, criar, atualizar, abater, valorActual };
