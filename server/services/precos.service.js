'use strict';
/**
 * Níveis de preço (até 5 tabelas por estabelecimento) e prato do dia.
 * A tabela que se aplica a um pedido decide-se no SERVIDOR, na hora de Luanda e pelo fluxo de venda:
 *   activa, dia da semana incluído (ou todos), dentro do horário (ou sem horário; pode passar a meia-noite),
 *   fluxo incluído (ou todos). Se várias servirem, ganha a de maior prioridade (depois a mais antiga).
 * Produto sem preço na tabela = preço base. Só o ADMIN configura (cartão em Configurações).
 */
const { pool } = require('../db');
const { withTx, erro } = require('./shared');

const MAX_TABELAS = 5;
const ORIGENS = ['MESA', 'BALCAO', 'REMOTA', 'TAKEAWAY', 'LAZER', 'LOJA', 'QUARTO'];
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Dia da semana (0 = domingo) e hora HH:MM em Luanda. */
function agoraLuanda(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Luanda', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dia, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, data: d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' }) };
}

const diaISO = v => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
function serve(t, origem, agora) {
  if (!t.ativa) return false;
  // Campanha com datas (inclusivas, dias de Luanda)
  if (agora.data && t.data_inicio && agora.data < diaISO(t.data_inicio)) return false;
  if (agora.data && t.data_fim && agora.data > diaISO(t.data_fim)) return false;
  if (Array.isArray(t.origens) && t.origens.length && !t.origens.includes(origem)) return false;
  if (t.hora_inicio && t.hora_fim) {
    const ini = String(t.hora_inicio).slice(0, 5), fim = String(t.hora_fim).slice(0, 5);
    // horário que passa a meia-noite (ex.: 22:00–02:00): o dia é o do início
    const dentro = ini <= fim ? (agora.hora >= ini && agora.hora < fim) : (agora.hora >= ini || agora.hora < fim);
    if (!dentro) return false;
    const diaRef = ini > fim && agora.hora < fim ? (agora.dia + 6) % 7 : agora.dia;
    if (Array.isArray(t.dias) && t.dias.length && !t.dias.includes(diaRef)) return false;
    return true;
  }
  if (Array.isArray(t.dias) && t.dias.length && !t.dias.includes(agora.dia)) return false;
  return true;
}

/** Tabela aplicável (ou null) e mapa produto_id → preço dessa tabela. */
async function precosAplicaveis(db, { tenantId, origem, agora = agoraLuanda() }) {
  if (!tenantId) return { tabela: null, precos: {} };
  const r = await db.query(`SELECT * FROM tabelas_preco WHERE tenant_id = $1 AND ativa ORDER BY prioridade DESC, criado_em`, [tenantId]);
  const tabela = r.rows.find(t => serve(t, origem, agora)) || null;
  if (!tabela) return { tabela: null, precos: {} };
  const p = await db.query(`SELECT produto_id, preco FROM precos_tabela WHERE tabela_id = $1`, [tabela.id]);
  return {
    tabela: { id: tabela.id, nome: tabela.nome },
    precos: Object.fromEntries(p.rows.map(x => [x.produto_id, Number(x.preco)])),
    desconto_pct: tabela.desconto_pct !== null && tabela.desconto_pct !== undefined ? Number(tabela.desconto_pct) : null,
  };
}

/** Preço final de um produto: preço próprio na tabela, ou base com o desconto geral da tabela, ou base. */
function precoFinal(nivel, produtoId, base) {
  if (nivel && nivel.precos && nivel.precos[produtoId] !== undefined) return nivel.precos[produtoId];
  if (nivel && nivel.desconto_pct) return Math.round(Number(base) * (100 - nivel.desconto_pct)) / 100;
  return Number(base);
}

async function listar({ tenantId }) {
  const t = await pool.query(`SELECT * FROM tabelas_preco WHERE tenant_id = $1 ORDER BY prioridade DESC, criado_em`, [tenantId]);
  const p = await pool.query(`SELECT pt.tabela_id, pt.produto_id, pt.preco FROM precos_tabela pt JOIN tabelas_preco t ON t.id = pt.tabela_id WHERE t.tenant_id = $1`, [tenantId]);
  return t.rows.map(x => ({ ...x, precos: Object.fromEntries(p.rows.filter(y => y.tabela_id === x.id).map(y => [y.produto_id, Number(y.preco)])) }));
}

function validarTabela({ nome, prioridade, ativa, origens, dias, hora_inicio, hora_fim, data_inicio, data_fim, desconto_pct }, parcial = false) {
  const out = {};
  if (!parcial || nome !== undefined) {
    const n = String(nome || '').trim();
    if (n.length < 2 || n.length > 60) throw erro(400, 'Nome da tabela: 2 a 60 caracteres');
    out.nome = n;
  }
  if (prioridade !== undefined) {
    const pr = Number(prioridade);
    if (!Number.isInteger(pr) || pr < 1 || pr > 99) throw erro(400, 'Prioridade: número inteiro de 1 a 99');
    out.prioridade = pr;
  }
  if (ativa !== undefined) { if (typeof ativa !== 'boolean') throw erro(400, 'ativa deve ser verdadeiro ou falso'); out.ativa = ativa; }
  if (origens !== undefined) {
    if (origens !== null && (!Array.isArray(origens) || origens.some(o => !ORIGENS.includes(o)))) throw erro(400, `Fluxos de venda aceites: ${ORIGENS.join(', ')}`);
    out.origens = origens && origens.length ? [...new Set(origens)] : null;
  }
  if (dias !== undefined) {
    if (dias !== null && (!Array.isArray(dias) || dias.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw erro(400, 'Dias da semana: 0 (domingo) a 6 (sábado)');
    out.dias = dias && dias.length ? [...new Set(dias)].sort() : null;
  }
  if (hora_inicio !== undefined || hora_fim !== undefined) {
    const semHorario = !hora_inicio && !hora_fim;
    if (!semHorario && (!HORA_RE.test(hora_inicio || '') || !HORA_RE.test(hora_fim || ''))) throw erro(400, 'Horário: início e fim no formato HH:MM (ou nenhum)');
    if (!semHorario && hora_inicio === hora_fim) throw erro(400, 'O início e o fim do horário não podem ser iguais');
    out.hora_inicio = semHorario ? null : hora_inicio; out.hora_fim = semHorario ? null : hora_fim;
  }
  for (const [k, v] of [['data_inicio', data_inicio], ['data_fim', data_fim]]) {
    if (v === undefined) continue;
    if (v === null || v === '') { out[k] = null; continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v + 'T00:00:00Z'))) throw erro(400, 'Datas da campanha no formato AAAA-MM-DD');
    out[k] = v;
  }
  if (out.data_inicio && out.data_fim && out.data_fim < out.data_inicio) throw erro(400, 'A data de fim da campanha é anterior à de início');
  if (desconto_pct !== undefined) {
    if (desconto_pct === null || desconto_pct === '') out.desconto_pct = null;
    else {
      const d = Number(desconto_pct);
      if (!Number.isFinite(d) || d <= 0 || d >= 100) throw erro(400, 'Desconto geral: mais de 0 e menos de 100 %');
      out.desconto_pct = Math.round(d * 100) / 100;
    }
  }
  return out;
}

async function criar({ tenantId, ...dados }) {
  const v = validarTabela(dados);
  return withTx(async db => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`tabelas_preco:${tenantId}`]);
    const n = await db.query(`SELECT COUNT(*)::int AS n FROM tabelas_preco WHERE tenant_id = $1`, [tenantId]);
    if (n.rows[0].n >= MAX_TABELAS) throw erro(409, `Máximo de ${MAX_TABELAS} tabelas de preço por estabelecimento`);
    try {
      const r = await db.query(
        `INSERT INTO tabelas_preco (tenant_id, nome, prioridade, ativa, origens, dias, hora_inicio, hora_fim, data_inicio, data_fim, desconto_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [tenantId, v.nome, v.prioridade || 1, v.ativa !== undefined ? v.ativa : true, v.origens || null, v.dias || null, v.hora_inicio || null, v.hora_fim || null,
          v.data_inicio || null, v.data_fim || null, v.desconto_pct || null]);
      return r.rows[0];
    } catch (e) { if (e.code === '23505') throw erro(409, 'Já existe uma tabela com esse nome'); throw e; }
  });
}

async function actualizar({ tenantId, id, ...dados }) {
  const v = validarTabela(dados, true);
  const campos = Object.keys(v);
  if (!campos.length) throw erro(400, 'Nada para alterar');
  const sets = campos.map((c, i) => `${c} = $${i + 3}`).join(', ');
  try {
    const r = await pool.query(`UPDATE tabelas_preco SET ${sets} WHERE id = $1 AND tenant_id = $2 RETURNING *`, [id, tenantId, ...campos.map(c => v[c])]);
    if (!r.rows[0]) throw erro(404, 'Tabela não encontrada');
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw erro(409, 'Já existe uma tabela com esse nome');
    if (e.code === '23514') throw erro(400, 'Combinação inválida (datas da campanha ou horário)');
    throw e;
  }
}

async function apagar({ tenantId, id }) {
  const r = await pool.query(`DELETE FROM tabelas_preco WHERE id = $1 AND tenant_id = $2 RETURNING id`, [id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Tabela não encontrada');
  return { apagada: true };
}

/** Define (preco número) ou retira (preco null) os preços de produtos na tabela. */
async function definirPrecos({ tenantId, id, precos }) {
  if (!Array.isArray(precos) || !precos.length || precos.length > 1000) throw erro(400, 'Indique os preços (lista de { produto_id, preco })');
  return withTx(async db => {
    const t = await db.query(`SELECT id FROM tabelas_preco WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!t.rows[0]) throw erro(404, 'Tabela não encontrada');
    const ids = [...new Set(precos.map(p => p && p.produto_id))];
    const ok = await db.query(`SELECT id FROM produtos WHERE id = ANY($1::uuid[]) AND tenant_id = $2`, [ids, tenantId]);
    if (ok.rows.length !== ids.length) throw erro(404, 'Algum dos produtos não é deste estabelecimento');
    for (const { produto_id, preco } of precos) {
      if (preco === null || preco === '' || preco === undefined) {
        await db.query(`DELETE FROM precos_tabela WHERE tabela_id = $1 AND produto_id = $2`, [id, produto_id]);
        continue;
      }
      const v = Number(preco);
      if (!Number.isFinite(v) || v < 0 || v > 1e9) throw erro(400, 'Preço inválido');
      await db.query(
        `INSERT INTO precos_tabela (tabela_id, produto_id, preco) VALUES ($1,$2,$3)
         ON CONFLICT (tabela_id, produto_id) DO UPDATE SET preco = EXCLUDED.preco`, [id, produto_id, Math.round(v * 100) / 100]);
    }
    const r = await db.query(`SELECT produto_id, preco FROM precos_tabela WHERE tabela_id = $1`, [id]);
    return { tabela_id: id, precos: Object.fromEntries(r.rows.map(x => [x.produto_id, Number(x.preco)])) };
  });
}

async function pratoDoDia({ tenantId, produtoId, ativo }) {
  if (typeof ativo !== 'boolean') throw erro(400, 'ativo deve ser verdadeiro ou falso');
  const r = await pool.query(`UPDATE produtos SET prato_do_dia = $3, atualizado_em = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id, nome, prato_do_dia`, [produtoId, tenantId, ativo]);
  if (!r.rows[0]) throw erro(404, 'Produto não encontrado');
  return r.rows[0];
}

module.exports = { precosAplicaveis, precoFinal, listar, criar, actualizar, apagar, definirPrecos, pratoDoDia, agoraLuanda, ORIGENS, MAX_TABELAS, _interno: { serve } };
