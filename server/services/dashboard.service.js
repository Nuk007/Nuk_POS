'use strict';
/**
 * DashboardService — itens a controlar (configuráveis pelo Administrador) e comparação com o dia anterior
 * e com o dia homólogo da semana (mesmo dia da semana, 7 dias antes). Dias medidos em Africa/Luanda (UTC+1, sem DST).
 *
 * Fontes: PRODUTO (um produto), CATEGORIA (uma categoria de produto), SERVICO (vendas de quartos por período ou
 * solicitações do portal), CONTADOR (manual +1/−1, ex.: pessoas na piscina), PENDENCIA (manual abrir/tratar,
 * ex.: reclamações).
 */
const { pool } = require('../db');
const { erro } = require('./shared');
const listas = require('./listas.service');

const SERVICOS = {
  QUARTOS: 'Quartos (todas as vendas)',
  QUARTO_HORA: 'Quartos — Hora',
  QUARTO_NOITE: 'Quartos — Noite',
  QUARTO_DIARIA: 'Quartos — Diária',
  SOLIC_HOSPEDAGEM: 'Solicitações de hospedagem (portal)',
  SOLIC_SERVICO: 'Solicitações de serviços (portal)',
  SOLIC_EVENTO: 'Solicitações de eventos (portal)',
};
const FRACAO = { QUARTO_HORA: 'DUAS_HORAS', QUARTO_NOITE: 'PERNOITE', QUARTO_DIARIA: 'DIARIA' };
const SOLIC = { SOLIC_HOSPEDAGEM: 'HOSPEDAGEM', SOLIC_SERVICO: 'SERVICO', SOLIC_EVENTO: 'EVENTO' };
const FONTES = ['PRODUTO', 'CATEGORIA', 'SERVICO', 'CONTADOR', 'PENDENCIA'];
const EVENTOS = { CONTADOR: ['MAIS', 'MENOS'], PENDENCIA: ['ABRIR', 'TRATAR'] };
const TZ = '+01:00';
const isUUID = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

// ── datas (sempre em dias de Luanda) ──────────────────────────────
function diaLuanda(d = new Date()) { return new Date(d.getTime() + 3600e3).toISOString().slice(0, 10); }
function somaDias(dia, n) { const d = new Date(`${dia}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function janela(hoje) { return { dias: { hoje, ontem: somaDias(hoje, -1), homologo: somaDias(hoje, -7) },
  lo: new Date(`${somaDias(hoje, -7)}T00:00:00${TZ}`), hi: new Date(`${somaDias(hoje, 1)}T00:00:00${TZ}`) }; }
function tres(map, dias, campo) {
  const v = d => Number((map.get(d) || {})[campo] || 0);
  return { hoje: v(dias.hoje), ontem: v(dias.ontem), homologo: v(dias.homologo) };
}
const mapa = rows => new Map(rows.map(r => [r.dia, r]));

// ── configuração dos itens ────────────────────────────────────────
async function listarItens({ tenantId, apenasActivos = false }) {
  const r = await pool.query(
    `SELECT id, nome, fonte, ref, ordem, ativo FROM dashboard_itens
     WHERE tenant_id = $1 ${apenasActivos ? 'AND ativo = true' : ''} ORDER BY ordem, criado_em`, [tenantId]);
  return r.rows;
}

async function criarItem({ tenantId, nome, fonte, ref }) {
  if (!tenantId) throw erro(400, 'Estabelecimento em falta');
  nome = String(nome || '').trim();
  if (!nome || nome.length > 80) throw erro(400, 'Indique o nome do item (máx. 80 caracteres)');
  if (!FONTES.includes(fonte)) throw erro(400, 'Tipo de item inválido');
  let refFinal = null;
  if (fonte === 'PRODUTO') {
    if (!isUUID(ref)) throw erro(400, 'Escolha o produto a monitorizar');
    const p = await pool.query(`SELECT 1 FROM produtos WHERE id = $1 AND tenant_id = $2`, [ref, tenantId]);
    if (!p.rows[0]) throw erro(400, 'Produto não encontrado neste estabelecimento');
    refFinal = ref;
  } else if (fonte === 'CATEGORIA') {
    await listas.exigirValor(tenantId, 'CATEGORIA_PRODUTO', ref || 'x', 'Categoria');
    refFinal = ref;
  } else if (fonte === 'SERVICO') {
    if (!SERVICOS[ref]) throw erro(400, 'Serviço inválido');
    refFinal = ref;
  }
  const ordem = (await pool.query(`SELECT COALESCE(MAX(ordem),0)+1 AS o FROM dashboard_itens WHERE tenant_id = $1`, [tenantId])).rows[0].o;
  const r = await pool.query(
    `INSERT INTO dashboard_itens (tenant_id, nome, fonte, ref, ordem) VALUES ($1,$2,$3,$4,$5) RETURNING id, nome, fonte, ref, ordem, ativo`,
    [tenantId, nome, fonte, refFinal, ordem]);
  return r.rows[0];
}

async function actualizarItem({ tenantId, id, nome, ativo }) {
  if (nome !== undefined) {
    nome = String(nome || '').trim();
    if (!nome || nome.length > 80) throw erro(400, 'Nome inválido (1 a 80 caracteres)');
  }
  const r = await pool.query(
    `UPDATE dashboard_itens SET nome = COALESCE($1, nome), ativo = COALESCE($2, ativo)
     WHERE id = $3 AND tenant_id = $4 RETURNING id, nome, fonte, ref, ordem, ativo`,
    [nome === undefined ? null : nome, ativo === undefined ? null : !!ativo, id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Item não encontrado');
  return r.rows[0];
}

async function removerItem({ tenantId, id }) {
  const r = await pool.query(`DELETE FROM dashboard_itens WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!r.rowCount) throw erro(404, 'Item não encontrado');
}

// ── registos manuais ──────────────────────────────────────────────
async function estadoManual(tenantId, item, dias) {
  const j = janela(diaLuanda());
  const r = await pool.query(
    `SELECT to_char((criado_em AT TIME ZONE 'Africa/Luanda')::date,'YYYY-MM-DD') AS dia, evento, COUNT(*)::int AS n
     FROM dashboard_registos WHERE tenant_id = $1 AND item_id = $2 AND criado_em >= $3 AND criado_em < $4 GROUP BY 1, 2`,
    [tenantId, item.id, j.lo, j.hi]);
  const por = (ev, dia) => (r.rows.find(x => x.evento === ev && x.dia === dia) || { n: 0 }).n;
  return { por, dias: dias || j.dias };
}

async function registar({ tenantId, userId, itemId, evento }) {
  const it = await pool.query(`SELECT id, fonte FROM dashboard_itens WHERE id = $1 AND tenant_id = $2 AND ativo = true`, [itemId, tenantId]);
  if (!it.rows[0]) throw erro(404, 'Item não encontrado');
  const ok = EVENTOS[it.rows[0].fonte];
  if (!ok || !ok.includes(evento)) throw erro(400, 'Registo não aplicável a este item');
  if (evento === 'MENOS') {
    const st = await estadoManual(tenantId, it.rows[0]);
    const hoje = diaLuanda();
    if (st.por('MAIS', hoje) - st.por('MENOS', hoje) <= 0) throw erro(409, 'Já está a zero');
  }
  if (evento === 'TRATAR') {
    const t = await pool.query(`SELECT COUNT(*) FILTER (WHERE evento='ABRIR')::int - COUNT(*) FILTER (WHERE evento='TRATAR')::int AS aberto FROM dashboard_registos WHERE tenant_id = $1 AND item_id = $2`, [tenantId, itemId]);
    if (t.rows[0].aberto <= 0) throw erro(409, 'Não há nenhuma em aberto');
  }
  await pool.query(`INSERT INTO dashboard_registos (tenant_id, item_id, evento, funcionario_id) VALUES ($1,$2,$3,$4)`, [tenantId, itemId, evento, userId || null]);
}

// ── comparativo ───────────────────────────────────────────────────
async function facturacao(tenantId, j) {
  const [ped, res] = await Promise.all([
    pool.query(
      `SELECT to_char((criado_em AT TIME ZONE 'Africa/Luanda')::date,'YYYY-MM-DD') AS dia, SUM(total) AS valor
       FROM pedidos WHERE tenant_id = $1 AND status = 'FECHADO' AND criado_em >= $2 AND criado_em < $3 GROUP BY 1`, [tenantId, j.lo, j.hi]),
    pool.query(
      `SELECT to_char((criado_em AT TIME ZONE 'Africa/Luanda')::date,'YYYY-MM-DD') AS dia, SUM(valor_total) AS valor
       FROM reservas WHERE tenant_id = $1 AND status NOT IN ('CANCELADA','NO_SHOW') AND criado_em >= $2 AND criado_em < $3 GROUP BY 1`, [tenantId, j.lo, j.hi]),
  ]);
  const a = tres(mapa(ped.rows), j.dias, 'valor'), b = tres(mapa(res.rows), j.dias, 'valor');
  const t = k => a[k] + b[k];
  return { valor: { hoje: t('hoje'), ontem: t('ontem'), homologo: t('homologo') }, restaurante: a, quartos: b };
}

async function calcularItem(tenantId, it, j) {
  const base = { id: it.id, nome: it.nome, fonte: it.fonte, ref: it.ref };
  if (it.fonte === 'PRODUTO' || it.fonte === 'CATEGORIA') {
    const filtro = it.fonte === 'PRODUTO' ? 'pr.id = $4::uuid' : 'pr.categoria = $4';
    const r = await pool.query(
      `SELECT to_char((p.criado_em AT TIME ZONE 'Africa/Luanda')::date,'YYYY-MM-DD') AS dia,
              SUM(ip.quantidade) AS q, SUM(ip.quantidade * ip.preco_unitario) AS v
       FROM itens_pedido ip JOIN pedidos p ON p.id = ip.pedido_id JOIN produtos pr ON pr.id = ip.produto_id
       WHERE p.tenant_id = $1 AND p.status = 'FECHADO' AND p.criado_em >= $2 AND p.criado_em < $3 AND ${filtro} GROUP BY 1`,
      [tenantId, j.lo, j.hi, it.ref]); // `filtro` é um de dois textos fixos
    const m = mapa(r.rows);
    return { ...base, unidade: 'un', quantidade: tres(m, j.dias, 'q'), valor: tres(m, j.dias, 'v') };
  }
  if (it.fonte === 'SERVICO') {
    if (SOLIC[it.ref]) {
      const r = await pool.query(
        `SELECT to_char((criado_em AT TIME ZONE 'Africa/Luanda')::date,'YYYY-MM-DD') AS dia, COUNT(*)::int AS q
         FROM solicitacoes_portal WHERE tenant_id = $1 AND tipo = $4 AND status <> 'CANCELADA' AND criado_em >= $2 AND criado_em < $3 GROUP BY 1`,
        [tenantId, j.lo, j.hi, SOLIC[it.ref]]);
      return { ...base, unidade: 'pedidos', quantidade: tres(mapa(r.rows), j.dias, 'q'), valor: null };
    }
    const r = await pool.query(
      `SELECT to_char((criado_em AT TIME ZONE 'Africa/Luanda')::date,'YYYY-MM-DD') AS dia, COUNT(*)::int AS q, SUM(valor_total) AS v
       FROM reservas WHERE tenant_id = $1 AND status NOT IN ('CANCELADA','NO_SHOW') AND criado_em >= $2 AND criado_em < $3
         AND ($4::text IS NULL OR fracao = $4) GROUP BY 1`,
      [tenantId, j.lo, j.hi, FRACAO[it.ref] || null]);
    const m = mapa(r.rows);
    return { ...base, unidade: 'vendas', quantidade: tres(m, j.dias, 'q'), valor: tres(m, j.dias, 'v') };
  }
  // manuais
  const r = await pool.query(
    `SELECT to_char((criado_em AT TIME ZONE 'Africa/Luanda')::date,'YYYY-MM-DD') AS dia, evento, COUNT(*)::int AS n
     FROM dashboard_registos WHERE tenant_id = $1 AND item_id = $2 AND criado_em >= $3 AND criado_em < $4 GROUP BY 1, 2`,
    [tenantId, it.id, j.lo, j.hi]);
  const serie = ev => mapa(r.rows.filter(x => x.evento === ev).map(x => ({ dia: x.dia, n: x.n })));
  if (it.fonte === 'CONTADOR') {
    const mais = tres(serie('MAIS'), j.dias, 'n'), menos = tres(serie('MENOS'), j.dias, 'n');
    return { ...base, unidade: 'registos', quantidade: mais, valor: null, agora: Math.max(0, mais.hoje - menos.hoje) };
  }
  const abertas = tres(serie('ABRIR'), j.dias, 'n'), tratadas = tres(serie('TRATAR'), j.dias, 'n');
  const t = await pool.query(`SELECT COUNT(*) FILTER (WHERE evento='ABRIR')::int AS a, COUNT(*) FILTER (WHERE evento='TRATAR')::int AS t FROM dashboard_registos WHERE tenant_id = $1 AND item_id = $2`, [tenantId, it.id]);
  return { ...base, unidade: 'registos', quantidade: abertas, valor: null, tratadas, em_aberto: Math.max(0, t.rows[0].a - t.rows[0].t) };
}

async function comparativo({ tenantId }) {
  const j = janela(diaLuanda());
  const itens = await listarItens({ tenantId, apenasActivos: true });
  const [fact, calc] = await Promise.all([facturacao(tenantId, j), Promise.all(itens.map(it => calcularItem(tenantId, it, j)))]);
  return { dias: j.dias, facturacao: fact, itens: calc };
}

module.exports = { listarItens, criarItem, actualizarItem, removerItem, registar, comparativo, SERVICOS, FONTES, diaLuanda, somaDias };
