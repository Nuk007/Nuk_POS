'use strict';
/**
 * Relatórios gerados automaticamente (21/11/2026, pedido do dono: «os relatórios são gerados automaticamente pelo
 * sistema»). O agendador (`jobs/agendador-diario.js`, 5 em 5 min) chama `processarTick`: depois da hora configurada,
 * gera para cada estabelecimento os relatórios diários (ontem, e os 3 dias anteriores se faltarem, porque o servidor
 * pode ter estado parado), semanais (semana anterior, segunda a domingo) e mensais (mês anterior), guarda-os em
 * `relatorios_gerados` e avisa o ecrã (`relatorios_gerados`). Sem movimento no período fica VAZIO (não aparece).
 * Configuração na chave `relatorios_auto` (JSON) de `configuracoes`; sem chave vale `PADRAO` (ligado).
 */
const { pool } = require('../db');
const { erro } = require('./shared');
const { logger } = require('../monitoring');
const ger = require('./relatorios-geradores.service');

const CHAVE = 'relatorios_auto';
const PADRAO = {
  ativo: true, hora: '06:00',
  DIA: ['FOLHA_CAIXA', 'VENDAS', 'CAIXA_DIFERENCAS', 'QUEBRAS'],
  SEMANA: ['VENDAS', 'COMPRAS', 'STOCK', 'MARGEM', 'QUARTOS', 'DIVIDAS'],
  MES: ['VENDAS', 'COMPRAS', 'STOCK', 'MARGEM', 'QUARTOS', 'DIVIDAS', 'RESULTADO', 'CAIXA_DIFERENCAS'],
};
const FREQS = ['DIA', 'SEMANA', 'MES'];
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

const diaLuanda = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
const horaLuanda = (d = new Date()) => d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Luanda', hour: '2-digit', minute: '2-digit', hour12: false });
const somaDias = (dia, n) => { const x = new Date(dia + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function normalizarConfig(g) {
  const c = { ...PADRAO };
  if (g && typeof g === 'object') {
    if (typeof g.ativo === 'boolean') c.ativo = g.ativo;
    if (HORA_RE.test(g.hora || '')) c.hora = g.hora;
    for (const f of FREQS) if (Array.isArray(g[f])) c[f] = g[f].filter(t => ger.CATALOGO[t] && ger.CATALOGO[t].frequencias.includes(f));
  }
  return c;
}

async function lerConfig(tenantId) {
  const r = await pool.query(`SELECT valor FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
  let g = null;
  try { g = r.rows[0] ? JSON.parse(r.rows[0].valor) : null; } catch { g = null; }
  return { ...normalizarConfig(g), configurado: !!r.rows[0] };
}

async function gravarConfig({ tenantId, ativo, hora, DIA, SEMANA, MES, repor }) {
  if (repor === true) {
    await pool.query(`DELETE FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
    return lerConfig(tenantId);
  }
  if (ativo !== undefined && typeof ativo !== 'boolean') throw erro(400, 'Indique se a geração automática fica ligada');
  if (hora !== undefined && !HORA_RE.test(String(hora))) throw erro(400, 'Hora inválida (HH:MM)');
  const listas = { DIA, SEMANA, MES };
  for (const f of FREQS) {
    const l = listas[f];
    if (l === undefined) continue;
    if (!Array.isArray(l)) throw erro(400, 'Indique uma lista de relatórios');
    for (const t of l) {
      if (!ger.CATALOGO[t]) throw erro(400, `Relatório desconhecido: ${t}`);
      if (!ger.CATALOGO[t].frequencias.includes(f)) throw erro(400, `${ger.CATALOGO[t].nome} não se gera por ${f === 'DIA' ? 'dia' : f === 'SEMANA' ? 'semana' : 'mês'}`);
    }
  }
  const actual = await lerConfig(tenantId);
  const novo = normalizarConfig({ ...actual, ...(ativo !== undefined ? { ativo } : {}), ...(hora ? { hora } : {}), ...Object.fromEntries(FREQS.filter(f => listas[f]).map(f => [f, [...new Set(listas[f])]])) });
  await pool.query(
    `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = $3, atualizado_em = NOW()`, [tenantId, CHAVE, JSON.stringify({ ativo: novo.ativo, hora: novo.hora, DIA: novo.DIA, SEMANA: novo.SEMANA, MES: novo.MES })]);
  return { ...novo, configurado: true };
}

/** Períodos devidos num instante: dias (ontem + 3 anteriores), semana anterior (seg–dom) e mês anterior. */
function periodosDevidos(agora = new Date()) {
  const hoje = diaLuanda(agora);
  const diasP = [1, 2, 3, 4].map(n => { const d = somaDias(hoje, -n); return { de: d, ate: d }; });
  const dow = (new Date(hoje + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0 = segunda
  const segAnterior = somaDias(hoje, -dow - 7);
  const [a, m] = hoje.split('-').map(Number);
  const iniMes = new Date(Date.UTC(m === 1 ? a - 1 : a, m === 1 ? 11 : m - 2, 1)).toISOString().slice(0, 10);
  const fimMes = somaDias(`${a}-${String(m).padStart(2, '0')}-01`, -1);
  return { DIA: diasP, SEMANA: [{ de: segAnterior, ate: somaDias(segAnterior, 6) }], MES: [{ de: iniMes, ate: fimMes }] };
}

/** Licenças do estabelecimento (NULL = todas). */
async function licencas(tenantId) {
  const r = await pool.query(`SELECT modulos FROM tenants WHERE id = $1`, [tenantId]);
  const m = r.rows[0] && r.rows[0].modulos;
  return Array.isArray(m) ? new Set(m) : null;
}

/** Gera e guarda. Manual: substitui o que houver para o mesmo período. Automático: só se ainda não existir. */
async function gerarEGuardar({ tenantId, tipo, de, ate, frequencia = 'MANUAL', origem = 'MANUAL', userId = null }) {
  const c = ger.CATALOGO[tipo];
  if (!c) throw erro(400, 'Tipo de relatório desconhecido');
  for (const d of [de, ate]) if (!DIA_RE.test(String(d || '')) || isNaN(new Date(d + 'T00:00:00Z'))) throw erro(400, 'Datas inválidas (AAAA-MM-DD)');
  if (ate < de) throw erro(400, 'A data inicial é posterior à final');
  if (ger.dias(de, ate) > 366) throw erro(400, 'Período máximo: um ano');
  if (ate > diaLuanda()) throw erro(400, 'O período não pode acabar no futuro');
  if (tipo === 'FOLHA_CAIXA' && de !== ate) throw erro(400, 'A Folha de Caixa é de um só dia');
  if (origem === 'AUTO') {
    const claim = await pool.query(
      `INSERT INTO relatorios_gerados (tenant_id, tipo, frequencia, de, ate, estado, origem) VALUES ($1,$2,$3,$4,$5,'GERANDO','AUTO')
       ON CONFLICT (tenant_id, tipo, de, ate) DO NOTHING RETURNING id`, [tenantId, tipo, frequencia, de, ate]);
    if (!claim.rows[0]) return null; // já existe (ou outra instância está a gerar)
    try {
      const dados = await ger.gerar(tenantId, tipo, de, ate);
      const estado = dados.sem_dados ? 'VAZIO' : 'PRONTO';
      await pool.query(`UPDATE relatorios_gerados SET estado = $2, dados = $3, gerado_em = NOW() WHERE id = $1`, [claim.rows[0].id, estado, estado === 'PRONTO' ? dados : null]);
      return estado === 'PRONTO' ? { id: claim.rows[0].id, tipo, de, ate } : null;
    } catch (e) {
      await pool.query(`UPDATE relatorios_gerados SET estado = 'FALHOU', erro = $2 WHERE id = $1`, [claim.rows[0].id, String(e.message).slice(0, 300)]);
      throw e;
    }
  }
  const dados = await ger.gerar(tenantId, tipo, de, ate);
  const r = await pool.query(
    `INSERT INTO relatorios_gerados (tenant_id, tipo, frequencia, de, ate, estado, dados, origem, gerado_por) VALUES ($1,$2,$3,$4,$5,'PRONTO',$6,'MANUAL',$7)
     ON CONFLICT (tenant_id, tipo, de, ate) DO UPDATE SET estado = 'PRONTO', dados = EXCLUDED.dados, erro = NULL, origem = 'MANUAL', gerado_por = EXCLUDED.gerado_por, gerado_em = NOW()
     RETURNING id, tipo, frequencia, de, ate, origem, gerado_em`, [tenantId, tipo, frequencia, de, ate, dados, userId]);
  return { ...r.rows[0], de, ate, dados };
}

/** Uma volta do agendador: devolve quantos relatórios ficaram prontos. */
async function processarTick(agora = new Date()) {
  const t = await pool.query(`SELECT id FROM tenants WHERE estado = 'ACTIVA'`);
  const per = periodosDevidos(agora);
  const hora = horaLuanda(agora);
  let prontos = 0;
  for (const { id } of t.rows) {
    let cfg;
    try { cfg = await lerConfig(id); } catch (e) { logger.warn({ err: e, tenantId: id }, 'Relatórios automáticos: configuração ilegível'); continue; }
    if (!cfg.ativo || hora < cfg.hora) continue;
    const lic = await licencas(id);
    const novos = [];
    for (const f of FREQS) {
      for (const tipo of cfg[f]) {
        const exige = ger.CATALOGO[tipo].licenca;
        if (exige && lic && !lic.has(exige)) continue;
        for (const p of per[f]) {
          try { const r = await gerarEGuardar({ tenantId: id, tipo, de: p.de, ate: p.ate, frequencia: f, origem: 'AUTO' }); if (r) novos.push(r); }
          catch (e) { logger.warn({ err: e, tenantId: id, tipo, ...p }, 'Relatório automático falhou'); }
        }
      }
    }
    prontos += novos.length;
    if (novos.length) {
      try { require('../middleware/broadcast').broadcast('relatorios_gerados', { n: novos.length }, id); } catch { /* sem socket nos testes */ }
    }
  }
  return prontos;
}

async function listar({ tenantId, tipo, page = 1, limit = 30 }) {
  const p = Math.max(1, parseInt(page, 10) || 1), l = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
  const t = tipo && ger.CATALOGO[tipo] ? tipo : null;
  const [d, c] = await Promise.all([
    pool.query(`SELECT r.id, r.tipo, r.frequencia, to_char(r.de, 'YYYY-MM-DD') AS de, to_char(r.ate, 'YYYY-MM-DD') AS ate, r.origem, r.gerado_em, f.nome AS gerado_por_nome,
                       jsonb_array_length(COALESCE(r.dados->'alertas', '[]'::jsonb)) AS alertas
                  FROM relatorios_gerados r LEFT JOIN funcionarios f ON f.id = r.gerado_por
                 WHERE r.tenant_id = $1 AND r.estado = 'PRONTO' AND ($2::text IS NULL OR r.tipo = $2)
                 ORDER BY r.ate DESC, r.gerado_em DESC LIMIT $3 OFFSET $4`, [tenantId, t, l, (p - 1) * l]),
    pool.query(`SELECT COUNT(*)::int AS n FROM relatorios_gerados WHERE tenant_id = $1 AND estado = 'PRONTO' AND ($2::text IS NULL OR tipo = $2)`, [tenantId, t]),
  ]);
  return { data: d.rows.map(x => ({ ...x, nome: ger.CATALOGO[x.tipo] ? ger.CATALOGO[x.tipo].nome : x.tipo })), page: p, limit: l, total: c.rows[0].n };
}

async function obter({ tenantId, id }) {
  const r = await pool.query(`SELECT id, tipo, frequencia, to_char(de, 'YYYY-MM-DD') AS de, to_char(ate, 'YYYY-MM-DD') AS ate, origem, gerado_em, dados
                                FROM relatorios_gerados WHERE id = $1 AND tenant_id = $2 AND estado = 'PRONTO'`, [id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Relatório não encontrado');
  return r.rows[0];
}

const catalogo = () => Object.entries(ger.CATALOGO).map(([tipo, c]) => ({ tipo, nome: c.nome, frequencias: c.frequencias, licenca: c.licenca || null }));

module.exports = { lerConfig, gravarConfig, periodosDevidos, gerarEGuardar, processarTick, listar, obter, catalogo, PADRAO };
