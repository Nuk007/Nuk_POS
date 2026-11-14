'use strict';
/**
 * Assiduidade: cada funcionário regista a SUA entrada e saída (o id vem do token, nunca do corpo).
 * A chefia (ADMIN/GERENTE) vê o relatório do período e corrige uma saída esquecida, com observação obrigatória.
 */
const { pool } = require('../db');
const { erro } = require('./shared');
const { periodo } = require('./relatorios.service');

const MAX_TURNO_H = 24; // entrada aberta há mais de 24 h é assinalada como esquecida

async function estado({ tenantId, userId }) {
  const r = await pool.query(`SELECT id, entrada_em FROM registos_ponto WHERE tenant_id = $1 AND funcionario_id = $2 AND saida_em IS NULL`, [tenantId, userId]);
  return { em_servico: !!r.rows[0], registo: r.rows[0] || null };
}

async function entrada({ tenantId, userId }) {
  try {
    const r = await pool.query(`INSERT INTO registos_ponto (tenant_id, funcionario_id) VALUES ($1,$2) RETURNING id, entrada_em`, [tenantId, userId]);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw erro(409, 'Já tem a entrada registada. Registe a saída primeiro.');
    throw e;
  }
}

async function saida({ tenantId, userId }) {
  const r = await pool.query(
    `UPDATE registos_ponto SET saida_em = GREATEST(NOW(), entrada_em + INTERVAL '1 second')
      WHERE tenant_id = $1 AND funcionario_id = $2 AND saida_em IS NULL
      RETURNING id, entrada_em, saida_em`, [tenantId, userId]);
  if (!r.rows[0]) throw erro(409, 'Não tem entrada registada.');
  const x = r.rows[0];
  return { ...x, horas: Math.round((new Date(x.saida_em) - new Date(x.entrada_em)) / 36e3) / 100 };
}

/** Chefia: fechar uma entrada esquecida com a hora real de saída e o motivo. */
async function corrigirSaida({ tenantId, userId, registoId, saida_em, observacoes }) {
  const obs = observacoes == null ? '' : String(observacoes).trim();
  if (obs.length < 3 || obs.length > 200) throw erro(400, 'Indique a observação (3 a 200 caracteres)');
  const d = new Date(saida_em);
  if (!saida_em || isNaN(d)) throw erro(400, 'Hora de saída inválida');
  if (d > new Date()) throw erro(400, 'A hora de saída não pode ser no futuro');
  const r = await pool.query(`SELECT entrada_em, saida_em FROM registos_ponto WHERE id = $1 AND tenant_id = $2`, [registoId, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Registo não encontrado');
  if (r.rows[0].saida_em) throw erro(409, 'Este registo já tem saída');
  if (d <= new Date(r.rows[0].entrada_em)) throw erro(400, 'A saída tem de ser depois da entrada');
  const u = await pool.query(
    `UPDATE registos_ponto SET saida_em = $3, saida_corrigida_por = $4, observacoes = $5 WHERE id = $1 AND tenant_id = $2 AND saida_em IS NULL RETURNING *`,
    [registoId, tenantId, d, userId || null, obs]);
  if (!u.rows[0]) throw erro(409, 'Este registo já tem saída');
  return u.rows[0];
}

/** Relatório do período: registos e horas por funcionário (dias de Luanda, pela entrada). */
async function relatorio({ tenantId, de, ate }) {
  const p = periodo(de, ate);
  const r = await pool.query(`
    SELECT r.id, r.funcionario_id, f.nome, f.cargo, r.entrada_em, r.saida_em, r.observacoes, fc.nome AS corrigido_por,
           EXTRACT(EPOCH FROM (r.saida_em - r.entrada_em)) / 3600 AS horas,
           (r.saida_em IS NULL AND r.entrada_em < NOW() - INTERVAL '${MAX_TURNO_H} hours') AS esquecido
      FROM registos_ponto r JOIN funcionarios f ON f.id = r.funcionario_id LEFT JOIN funcionarios fc ON fc.id = r.saida_corrigida_por
     WHERE r.tenant_id = $1 AND (r.entrada_em AT TIME ZONE 'Africa/Luanda')::date BETWEEN $2::date AND $3::date
     ORDER BY r.entrada_em DESC LIMIT 1000`, [tenantId, p.de, p.ate]);
  const porFunc = new Map();
  for (const x of r.rows) {
    const f = porFunc.get(x.funcionario_id) || { funcionario_id: x.funcionario_id, nome: x.nome, cargo: x.cargo, dias: new Set(), horas: 0, em_aberto: 0 };
    f.dias.add(new Date(x.entrada_em).toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' }));
    if (x.horas !== null) f.horas += Number(x.horas); else f.em_aberto++;
    porFunc.set(x.funcionario_id, f);
  }
  return {
    periodo: p,
    por_funcionario: [...porFunc.values()].map(f => ({ ...f, dias: f.dias.size, horas: Math.round(f.horas * 100) / 100 })).sort((a, b) => b.horas - a.horas),
    registos: r.rows.map(x => ({ ...x, horas: x.horas === null ? null : Math.round(Number(x.horas) * 100) / 100 })),
  };
}

module.exports = { estado, entrada, saida, corrigirSaida, relatorio };
