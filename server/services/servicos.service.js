'use strict';
/**
 * ServicosService — avarias e danos (ocorrências) e prazos de manutenção da infraestrutura física e móvel.
 * Nada se apaga: ativos e planos desactivam-se; ocorrências fecham-se (resolvida ou cancelada).
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { withTx, erro } = require('./shared');

const TIPOS_ATIVO = ['FISICA', 'MOVEL'];
const TIPOS_OCORRENCIA = ['AVARIA', 'DANO'];
const PRIORIDADES = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'];
const HOJE = `(NOW() AT TIME ZONE 'Africa/Luanda')::date`;
const DATA = c => `to_char(${c}, 'YYYY-MM-DD')`;
const texto = (v, max, obrig, nome) => {
  const t = v === undefined || v === null ? '' : String(v).trim();
  if (obrig && !t) throw erro(400, `${nome} é obrigatório`);
  return t ? t.slice(0, max) : null;
};
const ehData = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));

// ── Ativos ──────────────────────────────────────────────────
async function listarAtivos({ tenantId }) {
  const r = await pool.query(`SELECT id, nome, tipo, localizacao, ativo FROM ativos_servico WHERE tenant_id = $1 ORDER BY ativo DESC, tipo, nome`, [tenantId]);
  return r.rows;
}
async function criarAtivo({ tenantId, nome, tipo, localizacao }) {
  const n = texto(nome, 120, true, 'Nome');
  if (!TIPOS_ATIVO.includes(tipo)) throw erro(400, 'Tipo inválido (FISICA ou MOVEL)');
  const r = await pool.query(`INSERT INTO ativos_servico (tenant_id, nome, tipo, localizacao) VALUES ($1,$2,$3,$4) RETURNING id, nome, tipo, localizacao, ativo`, [tenantId, n, tipo, texto(localizacao, 120)]);
  return r.rows[0];
}
async function atualizarAtivo({ tenantId, id, nome, tipo, localizacao, ativo }) {
  const campos = [], vals = [];
  const add = (col, v) => { vals.push(v); campos.push(`${col} = $${vals.length}`); };
  if (nome !== undefined) add('nome', texto(nome, 120, true, 'Nome'));
  if (tipo !== undefined) { if (!TIPOS_ATIVO.includes(tipo)) throw erro(400, 'Tipo inválido'); add('tipo', tipo); }
  if (localizacao !== undefined) add('localizacao', texto(localizacao, 120));
  if (ativo !== undefined) add('ativo', !!ativo);
  if (!campos.length) throw erro(400, 'Nada para alterar');
  vals.push(id, tenantId);
  const r = await pool.query(`UPDATE ativos_servico SET ${campos.join(', ')} WHERE id = $${vals.length - 1}::uuid AND tenant_id = $${vals.length} RETURNING id, nome, tipo, localizacao, ativo`, vals);
  if (!r.rows[0]) throw erro(404, 'Item não encontrado');
  return r.rows[0];
}
async function ativoDoTenant(db, tenantId, id, exigirAtivo = true) {
  if (!id) return null;
  const r = await db.query(`SELECT id, ativo FROM ativos_servico WHERE id = $1::uuid AND tenant_id = $2`, [id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Item não encontrado');
  if (exigirAtivo && !r.rows[0].ativo) throw erro(409, 'Este item está desactivado');
  return r.rows[0];
}

// ── Ocorrências (avarias e danos) ───────────────────────────
async function listarOcorrencias({ tenantId, estado }) {
  const vals = [tenantId];
  let filtro = '';
  if (estado === 'ABERTAS') filtro = `AND o.estado IN ('ABERTA','EM_CURSO')`;
  else if (estado) { vals.push(estado); filtro = `AND o.estado = $2::text`; }
  const r = await pool.query(`
    SELECT o.id, o.tipo, o.titulo, o.descricao, o.prioridade, o.estado, o.criado_em, o.resolvido_em, o.resolucao,
           a.nome AS ativo_nome, a.tipo AS ativo_tipo, f.nome AS reportado_por_nome
    FROM ocorrencias_servico o LEFT JOIN ativos_servico a ON a.id = o.ativo_id LEFT JOIN funcionarios f ON f.id = o.reportado_por
    WHERE o.tenant_id = $1 ${filtro}
    ORDER BY (o.estado IN ('RESOLVIDA','CANCELADA')), array_position(ARRAY['URGENTE','ALTA','MEDIA','BAIXA'], o.prioridade), o.criado_em DESC LIMIT 200`, vals);
  return r.rows;
}
async function criarOcorrencia({ tenantId, userId, tipo, titulo, descricao, prioridade, ativo_id }) {
  if (!TIPOS_OCORRENCIA.includes(tipo)) throw erro(400, 'Indique se é uma avaria ou um dano');
  const t = texto(titulo, 160, true, 'Título');
  const p = prioridade || 'MEDIA';
  if (!PRIORIDADES.includes(p)) throw erro(400, 'Prioridade inválida');
  const out = await withTx(async db => {
    await ativoDoTenant(db, tenantId, ativo_id);
    const r = await db.query(
      `INSERT INTO ocorrencias_servico (tenant_id, ativo_id, tipo, titulo, descricao, prioridade, reportado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tenantId, ativo_id || null, tipo, t, texto(descricao, 2000), p, userId || null]);
    return r.rows[0];
  });
  broadcast('servicos_atualizados', { ocorrencia: out.id, prioridade: out.prioridade }, tenantId);
  return out;
}
const TRANSICOES = { ABERTA: ['EM_CURSO', 'RESOLVIDA', 'CANCELADA'], EM_CURSO: ['RESOLVIDA', 'CANCELADA'], RESOLVIDA: [], CANCELADA: [] };
async function atualizarOcorrencia({ tenantId, id, estado, resolucao, prioridade }) {
  if (estado === undefined && prioridade === undefined) throw erro(400, 'Nada para alterar');
  if (prioridade !== undefined && !PRIORIDADES.includes(prioridade)) throw erro(400, 'Prioridade inválida');
  const out = await withTx(async db => {
    const r = await db.query(`SELECT * FROM ocorrencias_servico WHERE id = $1::uuid AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
    const o = r.rows[0];
    if (!o) throw erro(404, 'Ocorrência não encontrada');
    if (['RESOLVIDA', 'CANCELADA'].includes(o.estado)) throw erro(409, 'Esta ocorrência já está fechada');
    let novoEstado = o.estado, res = o.resolucao;
    if (estado !== undefined && estado !== o.estado) {
      if (!TRANSICOES[o.estado].includes(estado)) throw erro(400, 'Estado inválido');
      novoEstado = estado;
      if (estado === 'RESOLVIDA') res = texto(resolucao, 2000, true, 'O que foi feito para resolver');
      else if (estado === 'CANCELADA') res = texto(resolucao, 2000, true, 'O motivo do cancelamento');
    }
    const fecha = ['RESOLVIDA', 'CANCELADA'].includes(novoEstado);
    const u = await db.query(
      `UPDATE ocorrencias_servico SET estado = $1, prioridade = $2, resolucao = $3, resolvido_em = ${fecha ? 'NOW()' : 'NULL'}, atualizado_em = NOW() WHERE id = $4 RETURNING *`,
      [novoEstado, prioridade || o.prioridade, res, o.id]);
    return u.rows[0];
  });
  broadcast('servicos_atualizados', { ocorrencia: out.id }, tenantId);
  return out;
}

// ── Prazos de manutenção ────────────────────────────────────
async function listarManutencoes({ tenantId }) {
  const r = await pool.query(`
    SELECT m.id, m.descricao, m.periodicidade_dias, ${DATA('m.ultima_em')} AS ultima_em, ${DATA('m.proxima_em')} AS proxima_em, m.ativo_id,
           a.nome AS ativo_nome, a.tipo AS ativo_tipo, (m.proxima_em - ${HOJE})::int AS dias_restantes
    FROM manutencoes_plano m JOIN ativos_servico a ON a.id = m.ativo_id
    WHERE m.tenant_id = $1 AND m.ativo ORDER BY m.proxima_em ASC`, [tenantId]);
  return r.rows;
}
async function criarManutencao({ tenantId, ativo_id, descricao, periodicidade_dias, primeira_em }) {
  const d = texto(descricao, 200, true, 'Descrição');
  const p = Number(periodicidade_dias);
  if (!Number.isInteger(p) || p < 1 || p > 3650) throw erro(400, 'A periodicidade tem de ser entre 1 e 3650 dias');
  if (primeira_em && !ehData(primeira_em)) throw erro(400, 'Data inválida (AAAA-MM-DD)');
  if (!ativo_id) throw erro(400, 'Escolha o item a manter');
  const out = await withTx(async db => {
    await ativoDoTenant(db, tenantId, ativo_id);
    const r = await db.query(
      `INSERT INTO manutencoes_plano (tenant_id, ativo_id, descricao, periodicidade_dias, proxima_em)
       VALUES ($1,$2,$3,$4, COALESCE($5::date, ${HOJE} + $4::int)) RETURNING id, descricao, periodicidade_dias, ${DATA('proxima_em')} AS proxima_em`,
      [tenantId, ativo_id, d, p, primeira_em || null]);
    return r.rows[0];
  });
  return out;
}
async function atualizarManutencao({ tenantId, id, descricao, periodicidade_dias, ativo }) {
  const campos = [], vals = [];
  const add = (col, v) => { vals.push(v); campos.push(`${col} = $${vals.length}`); };
  if (descricao !== undefined) add('descricao', texto(descricao, 200, true, 'Descrição'));
  if (periodicidade_dias !== undefined) {
    const p = Number(periodicidade_dias);
    if (!Number.isInteger(p) || p < 1 || p > 3650) throw erro(400, 'A periodicidade tem de ser entre 1 e 3650 dias');
    add('periodicidade_dias', p);
  }
  if (ativo !== undefined) add('ativo', !!ativo);
  if (!campos.length) throw erro(400, 'Nada para alterar');
  vals.push(id, tenantId);
  const r = await pool.query(`UPDATE manutencoes_plano SET ${campos.join(', ')} WHERE id = $${vals.length - 1}::uuid AND tenant_id = $${vals.length} RETURNING id, descricao, periodicidade_dias, ativo`, vals);
  if (!r.rows[0]) throw erro(404, 'Manutenção não encontrada');
  return r.rows[0];
}
async function registarRealizada({ tenantId, userId, id, data, observacoes }) {
  if (data && !ehData(data)) throw erro(400, 'Data inválida (AAAA-MM-DD)');
  const out = await withTx(async db => {
    const r = await db.query(`SELECT * FROM manutencoes_plano WHERE id = $1::uuid AND tenant_id = $2 AND ativo FOR UPDATE`, [id, tenantId]);
    const m = r.rows[0];
    if (!m) throw erro(404, 'Manutenção não encontrada');
    const hoje = (await db.query(`SELECT ${DATA(HOJE)} AS d`)).rows[0].d;
    const dia = data || hoje;
    if (dia > hoje) throw erro(400, 'A data da manutenção não pode ser futura');
    await db.query(`INSERT INTO manutencoes_registo (plano_id, realizada_em, observacoes, realizada_por) VALUES ($1,$2::date,$3,$4)`, [m.id, dia, texto(observacoes, 1000), userId || null]);
    const u = await db.query(
      `UPDATE manutencoes_plano SET ultima_em = $1::date, proxima_em = $1::date + periodicidade_dias WHERE id = $2 RETURNING id, ${DATA('ultima_em')} AS ultima_em, ${DATA('proxima_em')} AS proxima_em`,
      [dia, m.id]);
    return u.rows[0];
  });
  broadcast('servicos_atualizados', { manutencao: out.id }, tenantId);
  return out;
}
async function historicoManutencao({ tenantId, id }) {
  const r = await pool.query(`
    SELECT ${DATA('g.realizada_em')} AS realizada_em, g.observacoes, f.nome AS realizada_por
    FROM manutencoes_registo g JOIN manutencoes_plano m ON m.id = g.plano_id LEFT JOIN funcionarios f ON f.id = g.realizada_por
    WHERE m.id = $1::uuid AND m.tenant_id = $2 ORDER BY g.realizada_em DESC, g.criado_em DESC LIMIT 50`, [id, tenantId]);
  return r.rows;
}

async function resumo({ tenantId }) {
  const [o, m] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS abertas, COUNT(*) FILTER (WHERE prioridade IN ('ALTA','URGENTE'))::int AS urgentes FROM ocorrencias_servico WHERE tenant_id = $1 AND estado IN ('ABERTA','EM_CURSO')`, [tenantId]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE proxima_em < ${HOJE})::int AS atrasadas, COUNT(*) FILTER (WHERE proxima_em >= ${HOJE} AND proxima_em <= ${HOJE} + 7)::int AS proximas FROM manutencoes_plano WHERE tenant_id = $1 AND ativo`, [tenantId]),
  ]);
  return { ...o.rows[0], ...m.rows[0] };
}

module.exports = { listarAtivos, criarAtivo, atualizarAtivo, listarOcorrencias, criarOcorrencia, atualizarOcorrencia, listarManutencoes, criarManutencao, atualizarManutencao, registarRealizada, historicoManutencao, resumo };
