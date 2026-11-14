'use strict';
/**
 * Resumo diário para o dono (14/11/2026): o que o estabelecimento fez ONTEM (dia de Luanda) — receita, pedidos,
 * despesas, resultado — e o que pede atenção (cancelamentos, diferenças de caixa, stock no mínimo, avarias urgentes,
 * manutenções em atraso, contas por receber).
 *
 * Configuração em Configurações (só ADMIN): ligar/desligar, número de WhatsApp e hora de envio (por omissão 07:30).
 * O agendador (jobs/agendador-diario.js) envia pela API oficial do WhatsApp se estiver configurada; sem ela o resumo
 * fica no ecrã de Relatórios com o botão «Enviar pelo WhatsApp» (wa.me). Um resumo por estabelecimento e dia
 * (`resumos_diarios`, chave única) — com várias instâncias do servidor sai uma só vez.
 */
const { pool } = require('../db');
const { erro } = require('./shared');
const fin = require('./financeiro.service');
const wa = require('./whatsapp.service');
const { periodo } = require('./relatorios.service');
const { diaLuanda, somaDias } = require('./dashboard.service');
const { logger } = require('../monitoring');

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PADRAO = { ativo: false, telefone: '', hora: '07:30' };
const CHAVES = { ativo: 'resumo_diario_ativo', telefone: 'resumo_diario_telefone', hora: 'resumo_diario_hora' };
const N = v => Number(v) || 0;
const kz = v => `${Math.round(N(v)).toLocaleString('pt-PT').replace(/\u202f|\u00a0/g, ' ')} Kz`;

async function lerConfig(tenantId) {
  const r = await pool.query(`SELECT chave, valor FROM configuracoes WHERE tenant_id = $1 AND chave = ANY($2::text[])`, [tenantId, Object.values(CHAVES)]);
  const m = Object.fromEntries(r.rows.map(x => [x.chave, x.valor]));
  return {
    ativo: m[CHAVES.ativo] === 'true',
    telefone: m[CHAVES.telefone] || PADRAO.telefone,
    hora: HORA_RE.test(m[CHAVES.hora] || '') ? m[CHAVES.hora] : PADRAO.hora,
  };
}

async function gravarConfig({ tenantId, ativo, telefone, hora }) {
  const tel = telefone == null ? '' : String(telefone).trim();
  if (tel && !wa.normalizar(tel)) throw erro(400, 'Número de WhatsApp inválido (9XXXXXXXX)');
  const h = hora == null || hora === '' ? PADRAO.hora : String(hora).trim();
  if (!HORA_RE.test(h)) throw erro(400, 'Hora inválida (HH:MM)');
  const liga = ativo === true || ativo === 'true';
  if (liga && !tel) throw erro(400, 'Indique o número de WhatsApp que recebe o resumo');
  const valores = { [CHAVES.ativo]: String(liga), [CHAVES.telefone]: tel, [CHAVES.hora]: h };
  for (const [chave, valor] of Object.entries(valores)) {
    await pool.query(
      `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = $3, atualizado_em = NOW()`, [tenantId, chave, valor]);
  }
  return lerConfig(tenantId);
}

/** Números do dia (dia de Luanda, AAAA-MM-DD). */
async function calcular({ tenantId, dia }) {
  const { de } = periodo(dia, dia);
  const amanha = somaDias(de, 1);
  const noDia = col => `(${col} AT TIME ZONE 'Africa/Luanda')::date = $2::date`;
  const v = [tenantId, de];
  const [res, ten, canc, caixa, stock, ocorr, manut] = await Promise.all([
    fin.resultado({ tenantId, de, ate: de }),
    pool.query(`SELECT nome FROM tenants WHERE id = $1`, [tenantId]),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS valor FROM pedidos WHERE tenant_id = $1 AND status = 'CANCELADO' AND ${noDia('COALESCE(cancelado_em, atualizado_em)')}`, v),
    pool.query(`SELECT COUNT(*)::int AS sessoes, COALESCE(SUM(diferenca),0) AS diferenca, COUNT(*) FILTER (WHERE diferenca <> 0)::int AS com_diferenca
                  FROM caixa_sessoes WHERE tenant_id = $1 AND fechada_em IS NOT NULL AND ${noDia('fechada_em')}`, v),
    pool.query(`SELECT nome FROM stock_items WHERE tenant_id = $1 AND ativo AND stock_minimo > 0 AND stock_atual <= stock_minimo ORDER BY nome`, [tenantId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM ocorrencias_servico WHERE tenant_id = $1 AND estado IN ('ABERTA','EM_CURSO') AND prioridade IN ('ALTA','URGENTE')`, [tenantId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM manutencoes_plano WHERE tenant_id = $1 AND ativo AND proxima_em < $2::date`, [tenantId, amanha]),
  ]);
  const pedidos = res.receita.pedidos;
  const r = {
    dia: de,
    estabelecimento: (ten.rows[0] && ten.rows[0].nome) || 'Estabelecimento',
    receita: res.receita.total,
    receita_vendas: res.receita.vendas,
    receita_alojamento: res.receita.alojamento,
    pedidos,
    reservas: res.receita.reservas,
    ticket_medio: pedidos ? Math.round(res.receita.vendas / pedidos) : 0,
    custo_vendas: res.custo_vendas,
    despesas: res.total_despesas,
    resultado: res.resultado,
    receita_sem_custo: res.receita_sem_custo,
    por_receber: res.por_receber,
    cancelamentos: { n: canc.rows[0].n, valor: N(canc.rows[0].valor) },
    caixa: { sessoes: caixa.rows[0].sessoes, com_diferenca: caixa.rows[0].com_diferenca, diferenca: N(caixa.rows[0].diferenca) },
    stock_minimo: stock.rows.map(x => x.nome),
    avarias_urgentes: ocorr.rows[0].n,
    manutencoes_atrasadas: manut.rows[0].n,
  };
  r.alertas = alertas(r);
  return r;
}

function alertas(r) {
  const a = [];
  if (r.cancelamentos.n) a.push(`${r.cancelamentos.n} cancelamento(s) (${kz(r.cancelamentos.valor)})`);
  if (r.caixa.com_diferenca) a.push(`diferença de caixa ${r.caixa.diferenca > 0 ? '+' : ''}${kz(r.caixa.diferenca)}`);
  if (r.por_receber.pedidos) a.push(`${r.por_receber.pedidos} conta(s) por receber (${kz(r.por_receber.valor)})`);
  if (r.stock_minimo.length) a.push(`stock no mínimo: ${r.stock_minimo.slice(0, 3).join(', ')}${r.stock_minimo.length > 3 ? ` e mais ${r.stock_minimo.length - 3}` : ''}`);
  if (r.avarias_urgentes) a.push(`${r.avarias_urgentes} avaria(s) urgente(s) por resolver`);
  if (r.manutencoes_atrasadas) a.push(`${r.manutencoes_atrasadas} manutenção(ões) em atraso`);
  if (r.receita_sem_custo > 0) a.push('há vendas de produtos sem custo na receita (o lucro real é menor)');
  return a;
}

const diaPt = d => d.split('-').reverse().join('/');

/** Texto para o ecrã e para o wa.me. */
function texto(r) {
  return [
    `📊 Resumo de ${r.estabelecimento} — ${diaPt(r.dia)}`,
    `Receita: ${kz(r.receita)}${r.receita_alojamento ? ` (alojamento ${kz(r.receita_alojamento)})` : ''}`,
    `Pedidos: ${r.pedidos} · ticket médio ${kz(r.ticket_medio)}`,
    `Custo das vendas: ${kz(r.custo_vendas)} · Despesas: ${kz(r.despesas)}`,
    `Resultado: ${kz(r.resultado)}`,
    r.alertas.length ? `Atenção:\n${r.alertas.map(x => `• ${x}`).join('\n')}` : 'Sem alertas ✅',
    'Nuk_POS · GESTNUK AI',
  ].join('\n');
}

/** Parâmetros do modelo aprovado (ordem de whatsapp.service TEMPLATES.resumo_diario). */
function parametros(r) {
  return [r.estabelecimento, diaPt(r.dia), kz(r.receita), String(r.pedidos), kz(r.ticket_medio), kz(r.despesas), kz(r.resultado),
    r.alertas.length ? r.alertas.join('; ') : 'sem alertas'];
}

const ontem = (agora = new Date()) => somaDias(diaLuanda(agora), -1);

/** Resumo para o ecrã: números, texto, ligação wa.me para o número configurado e o estado do envio desse dia. */
async function obter({ tenantId, dia }) {
  const d = dia || ontem();
  const [r, cfg, env] = await Promise.all([
    calcular({ tenantId, dia: d }),
    lerConfig(tenantId),
    pool.query(`SELECT canal, estado, erro, enviado_em FROM resumos_diarios WHERE tenant_id = $1 AND dia = $2`, [tenantId, d]),
  ]);
  const t = texto(r);
  return { resumo: r, texto: t, link_whatsapp: wa.linkWaMe(cfg.telefone, t), envio: env.rows[0] || null, whatsapp_oficial: wa.configurado(), config: cfg };
}

/** Envia já pela API oficial (botão «Enviar agora»); sem API devolve 409 com a ligação wa.me. */
async function enviarAgora({ tenantId, dia }) {
  const d = dia || ontem();
  const cfg = await lerConfig(tenantId);
  if (!cfg.telefone) throw erro(400, 'Configure primeiro o número que recebe o resumo (Configurações)');
  const r = await calcular({ tenantId, dia: d });
  if (!wa.configurado()) throw erro(409, 'O envio oficial do WhatsApp ainda não está configurado: use «Enviar pelo WhatsApp»', { link_whatsapp: wa.linkWaMe(cfg.telefone, texto(r)) });
  await wa.enviarTemplate({ tenantId, para: cfg.telefone, chave: 'resumo_diario', parametros: parametros(r), finalidade: 'RESUMO_DIARIO' });
  await pool.query(
    `INSERT INTO resumos_diarios (tenant_id, dia, conteudo, canal, estado, enviado_em) VALUES ($1,$2,$3,'WHATSAPP','ENVIADO',NOW())
     ON CONFLICT (tenant_id, dia) DO UPDATE SET conteudo = $3, canal = 'WHATSAPP', estado = 'ENVIADO', erro = NULL, enviado_em = NOW()`,
    [tenantId, d, r]);
  return { enviado: true, dia: d };
}

/** Já passou a hora de envio (relógio de Luanda)? */
function passouHora(hora, agora = new Date()) {
  const local = new Date(agora.getTime() + 3600e3).toISOString().slice(11, 16);
  return local >= hora;
}

/**
 * Volta do agendador: para cada estabelecimento activo com o resumo ligado e já passada a hora, reclama o dia
 * de ontem (INSERT … ON CONFLICT DO NOTHING) e envia. Devolve quantos tratou (para os testes).
 */
async function processarTick(agora = new Date()) {
  const dia = ontem(agora);
  const t = await pool.query(
    `SELECT t.id FROM tenants t
       JOIN configuracoes c ON c.tenant_id = t.id AND c.chave = $1 AND c.valor = 'true'
      WHERE t.estado = 'ACTIVA'
        AND NOT EXISTS (SELECT 1 FROM resumos_diarios r WHERE r.tenant_id = t.id AND r.dia = $2)`, [CHAVES.ativo, dia]);
  let tratados = 0;
  for (const { id } of t.rows) {
    const cfg = await lerConfig(id);
    if (!cfg.ativo || !passouHora(cfg.hora, agora)) continue;
    const claim = await pool.query(`INSERT INTO resumos_diarios (tenant_id, dia) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING dia`, [id, dia]);
    if (!claim.rows[0]) continue; // outra instância já o reclamou
    tratados++;
    try {
      const r = await calcular({ tenantId: id, dia });
      if (wa.configurado() && cfg.telefone) {
        await wa.enviarTemplate({ tenantId: id, para: cfg.telefone, chave: 'resumo_diario', parametros: parametros(r), finalidade: 'RESUMO_DIARIO' });
        await pool.query(`UPDATE resumos_diarios SET conteudo = $3, canal = 'WHATSAPP', estado = 'ENVIADO', enviado_em = NOW() WHERE tenant_id = $1 AND dia = $2`, [id, dia, r]);
      } else {
        await pool.query(`UPDATE resumos_diarios SET conteudo = $3, canal = 'APP', estado = 'SO_APP' WHERE tenant_id = $1 AND dia = $2`, [id, dia, r]);
      }
    } catch (e) {
      logger.warn({ err: e, tenantId: id, dia }, 'Resumo diário falhou');
      await pool.query(`UPDATE resumos_diarios SET estado = 'FALHOU', erro = $3 WHERE tenant_id = $1 AND dia = $2`, [id, dia, String(e.message).slice(0, 300)]);
    }
  }
  return tratados;
}

module.exports = { lerConfig, gravarConfig, calcular, texto, parametros, alertas, obter, enviarAgora, processarTick, passouHora, ontem };
