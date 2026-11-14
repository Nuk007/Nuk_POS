'use strict';
/**
 * Licença do estabelecimento: estado para o ecrã (aviso antes de acabar, ecrã de bloqueio) e
 * renovação que prolonga o prazo sem mexer nas contas (14/11/2026).
 *
 * Antes, renovar gerava uma chave nova que o cliente activava na página de activação; essa página
 * voltava a pedir os dados do administrador e escrevia por cima da palavra-passe do titular, e o prazo
 * contava sempre a partir do dia da activação (perdia-se o tempo que ainda faltava).
 */
const { pool } = require('../db');
const { erro } = require('./shared');

const DIA_MS = 24 * 60 * 60 * 1000;
const AVISO_DIAS = 7;

/** Contacto de suporte (env SUPORTE_WHATSAPP, só dígitos). Sem ele o ecrã não mostra o botão. */
function suporteWhatsApp() {
  const n = String(process.env.SUPORTE_WHATSAPP || '').replace(/\D/g, '');
  return n.length >= 9 ? n : null;
}

/** Dias inteiros até ao fim (arredonda para cima: falta 1 h = 1 dia; passou = negativo ou 0). */
function diasRestantes(fim, agora = new Date()) {
  if (!fim) return null;
  return Math.ceil((new Date(fim).getTime() - agora.getTime()) / DIA_MS);
}

/**
 * Estado da licença para o ecrã. Nunca bloqueia: é o middleware que bloqueia as rotas.
 * `fim` = fim da licença activa ou, sem ela, o da última licença que existiu.
 */
async function estado({ tenantId, agora = new Date() }) {
  const r = await pool.query(`
    SELECT t.estado, t.nome,
           (SELECT l.fim FROM licencas l WHERE l.tenant_id = t.id AND l.estado = 'ACTIVA'
             ORDER BY l.fim DESC NULLS LAST LIMIT 1) AS fim_activa,
           (SELECT l.fim FROM licencas l WHERE l.tenant_id = t.id AND l.fim IS NOT NULL
             ORDER BY l.fim DESC LIMIT 1) AS fim_ultima
    FROM tenants t WHERE t.id = $1
  `, [tenantId]);
  if (r.rows.length === 0) throw erro(404, 'Estabelecimento não encontrado');
  const { estado: est, nome, fim_activa, fim_ultima } = r.rows[0];
  const fim = fim_activa || fim_ultima || null;
  const dias = diasRestantes(fim, agora);
  let situacao = 'ACTIVA';
  if (est === 'SUSPENSA') situacao = 'SUSPENSA';
  else if (est === 'EXPIRADA' || (fim && new Date(fim) < agora)) situacao = 'EXPIRADA';
  return {
    situacao,
    estabelecimento: nome,
    fim,
    dias_restantes: dias,
    aviso: situacao === 'ACTIVA' && dias !== null && dias <= AVISO_DIAS,
    suporte_whatsapp: suporteWhatsApp(),
  };
}

/**
 * Activa uma licença nova para um estabelecimento que já existe, DENTRO da transacção do chamador.
 * O prazo soma-se ao que falta da licença em curso (renovar antes do fim não perde dias); a licença
 * anterior passa a EXPIRADA para haver sempre uma só ACTIVA. A conta suspensa continua suspensa.
 * Se `licencaId` vier, activa essa (chave PENDENTE); senão cria a licença já activa.
 */
async function activarRenovacao(client, { tenantId, duracaoDias, planoId, notas, licencaId, licenseKey, ip, agora = new Date() }) {
  const dias = Number(duracaoDias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 3650) throw erro(400, 'Duração inválida (1 a 3650 dias)');

  const t = await client.query(`SELECT id, estado, plano_id FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
  if (t.rows.length === 0) throw erro(404, 'Estabelecimento não encontrado');

  const act = await client.query(
    `SELECT id, fim FROM licencas WHERE tenant_id = $1 AND estado = 'ACTIVA' ORDER BY fim DESC NULLS LAST FOR UPDATE`, [tenantId]);
  const fimActual = act.rows.map(x => x.fim).filter(Boolean).map(f => new Date(f)).sort((a, b) => b - a)[0];
  const inicio = fimActual && fimActual > agora ? fimActual : agora;
  const fim = new Date(inicio.getTime() + dias * DIA_MS);

  if (act.rows.length) {
    await client.query(`UPDATE licencas SET estado = 'EXPIRADA' WHERE tenant_id = $1 AND estado = 'ACTIVA'`, [tenantId]);
  }

  let id = licencaId;
  if (id) {
    await client.query(`
      UPDATE licencas SET estado = 'ACTIVA', inicio = $1, fim = $2, activado_em = $3, activado_por_ip = $4
      WHERE id = $5
    `, [inicio, fim, agora, ip || null, id]);
  } else {
    const ins = await client.query(`
      INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, estado, inicio, fim, activado_em, notas)
      VALUES ($1, $2, $3, $4, 'ACTIVA', $5, $6, $7, $8) RETURNING id
    `, [tenantId, licenseKey, planoId || t.rows[0].plano_id, dias, inicio, fim, agora, notas || 'Renovação']);
    id = ins.rows[0].id;
  }

  if (t.rows[0].estado !== 'SUSPENSA') {
    await client.query(`UPDATE tenants SET estado = 'ACTIVA', atualizado_em = NOW() WHERE id = $1`, [tenantId]);
  }
  return { licenca_id: id, inicio, fim, suspensa: t.rows[0].estado === 'SUSPENSA' };
}

/** O estabelecimento já tem um titular activo? (então activar uma chave é uma renovação). */
async function temTitular(clientOuPool, tenantId) {
  const r = await clientOuPool.query(
    `SELECT 1 FROM funcionarios WHERE tenant_id = $1 AND titular = true AND ativo = true LIMIT 1`, [tenantId]);
  return r.rows.length > 0;
}

module.exports = { estado, activarRenovacao, temTitular, diasRestantes, suporteWhatsApp, AVISO_DIAS };
