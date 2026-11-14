'use strict';
/**
 * Impressão em rede por um agente local (14/11/2026).
 *
 * - O ADMIN cria um agente em Configurações: o token aparece UMA vez (guarda-se só o SHA-256) e vai para o
 *   programa `agente-impressao/agente.js`, que corre num computador da rede do estabelecimento.
 * - O navegador converte o documento em ESC/POS (impressora.js) e põe o trabalho na fila com o IP da impressora.
 * - O agente pede trabalhos (`FOR UPDATE SKIP LOCKED`: com dois agentes cada trabalho sai uma vez), envia-os por
 *   TCP para IP:porta e diz como correu. Trabalho reclamado há mais de 2 min sem resposta volta à fila (até 3 tentativas).
 * - Só endereços privados (10/8, 172.16/12, 192.168/16) e portas 9100–9109: o agente nunca serve para chegar a
 *   outra coisa na rede ou fora dela.
 */
const crypto = require('crypto');
const { pool } = require('../db');
const { erro } = require('./shared');

const MAX_BYTES = 64 * 1024;
const MAX_TENTATIVAS = 3;
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

/** «192.168.1.50:9100» → { host, porta } ou erro 400. */
function validarImpressora(v) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{2,5}))?$/.exec(String(v || '').trim());
  if (!m) throw erro(400, 'Impressora inválida: use o IP da impressora (ex.: 192.168.1.50:9100)');
  const o = m.slice(1, 5).map(Number);
  if (o.some(x => x > 255)) throw erro(400, 'Endereço IP inválido');
  const privado = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
  if (!privado) throw erro(400, 'Só impressoras da rede local (10.x, 172.16–31.x ou 192.168.x)');
  const porta = m[5] ? Number(m[5]) : 9100;
  if (porta < 9100 || porta > 9109) throw erro(400, 'Porta da impressora entre 9100 e 9109');
  return `${o.join('.')}:${porta}`;
}

// ── Gestão dos agentes (ADMIN, Configurações) ──
async function criarAgente({ tenantId, userId, nome }) {
  const n = String(nome || '').trim();
  if (n.length < 2 || n.length > 80) throw erro(400, 'Dê um nome ao agente (ex.: «PC da cozinha»)');
  const activos = await pool.query(`SELECT COUNT(*)::int AS n FROM agentes_impressao WHERE tenant_id = $1 AND revogado_em IS NULL`, [tenantId]);
  if (activos.rows[0].n >= 5) throw erro(409, 'Máximo de 5 agentes activos por estabelecimento');
  const token = 'nka_' + crypto.randomBytes(24).toString('base64url');
  const r = await pool.query(
    `INSERT INTO agentes_impressao (tenant_id, nome, token_hash, criado_por) VALUES ($1,$2,$3,$4) RETURNING id, nome, criado_em`,
    [tenantId, n, hash(token), userId || null]);
  return { ...r.rows[0], token }; // o token só é mostrado agora
}

async function listarAgentes({ tenantId }) {
  const r = await pool.query(
    `SELECT a.id, a.nome, a.criado_em, a.ultimo_contacto, a.revogado_em,
            (SELECT COUNT(*)::int FROM trabalhos_impressao t WHERE t.tenant_id = a.tenant_id AND t.estado IN ('PENDENTE','A_ENVIAR')) AS fila
       FROM agentes_impressao a WHERE a.tenant_id = $1 ORDER BY a.revogado_em NULLS FIRST, a.criado_em DESC`, [tenantId]);
  return r.rows.map(a => ({ ...a, online: !a.revogado_em && a.ultimo_contacto && Date.now() - new Date(a.ultimo_contacto) < 60000 }));
}

async function revogarAgente({ tenantId, id }) {
  const r = await pool.query(
    `UPDATE agentes_impressao SET revogado_em = NOW() WHERE id = $1 AND tenant_id = $2 AND revogado_em IS NULL RETURNING id`, [id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Agente não encontrado ou já revogado');
  return { ok: true };
}

// ── Fila (navegador do POS) ──
async function enfileirar({ tenantId, userId, impressora, dados }) {
  const imp = validarImpressora(impressora);
  const b64 = String(dados || '');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw erro(400, 'Dados de impressão inválidos');
  if (Buffer.from(b64, 'base64').length > MAX_BYTES) throw erro(413, 'Documento demasiado grande para imprimir');
  const ag = await pool.query(`SELECT 1 FROM agentes_impressao WHERE tenant_id = $1 AND revogado_em IS NULL LIMIT 1`, [tenantId]);
  if (!ag.rows[0]) throw erro(409, 'Não há agente de impressão em rede configurado (Configurações → Impressão em rede)', { codigo: 'SEM_AGENTE' });
  const r = await pool.query(
    `INSERT INTO trabalhos_impressao (tenant_id, impressora, dados, criado_por) VALUES ($1,$2,$3,$4) RETURNING id, impressora, estado, criado_em`,
    [tenantId, imp, b64, userId || null]);
  return r.rows[0];
}

async function estadoTrabalho({ tenantId, id }) {
  const r = await pool.query(`SELECT id, impressora, estado, tentativas, erro, criado_em, concluido_em FROM trabalhos_impressao WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Trabalho não encontrado');
  return r.rows[0];
}

// ── Agente local (autenticado pelo token) ──
async function autenticarAgente(token) {
  if (!token || !/^nka_[A-Za-z0-9_-]{20,}$/.test(token)) throw erro(401, 'Token de agente inválido');
  const r = await pool.query(
    `UPDATE agentes_impressao a SET ultimo_contacto = NOW() FROM tenants t
      WHERE a.token_hash = $1 AND a.revogado_em IS NULL AND t.id = a.tenant_id AND t.estado = 'ACTIVA'
      RETURNING a.id, a.tenant_id, a.nome`, [hash(token)]);
  if (!r.rows[0]) throw erro(401, 'Token de agente inválido ou revogado');
  return r.rows[0];
}

/** Dá ao agente até 10 trabalhos: os pendentes e os que outro agente reclamou há mais de 2 min sem responder. */
async function reclamar({ agente }) {
  const r = await pool.query(
    `UPDATE trabalhos_impressao t SET estado = 'A_ENVIAR', agente_id = $2, reclamado_em = NOW(), tentativas = t.tentativas + 1
      WHERE t.id IN (
        SELECT id FROM trabalhos_impressao
         WHERE tenant_id = $1 AND criado_em > NOW() - INTERVAL '1 hour' AND tentativas < $3
           AND (estado = 'PENDENTE' OR (estado = 'A_ENVIAR' AND reclamado_em < NOW() - INTERVAL '2 minutes'))
         ORDER BY criado_em LIMIT 10 FOR UPDATE SKIP LOCKED)
      RETURNING t.id, t.impressora, t.dados`, [agente.tenant_id, agente.id, MAX_TENTATIVAS]);
  return r.rows;
}

async function concluir({ agente, id, ok, motivo }) {
  const r = await pool.query(
    `UPDATE trabalhos_impressao
        SET estado = CASE WHEN $3 THEN 'ENVIADO' WHEN tentativas >= $5 THEN 'FALHOU' ELSE 'PENDENTE' END,
            erro = CASE WHEN $3 THEN NULL ELSE $4 END, concluido_em = CASE WHEN $3 OR tentativas >= $5 THEN NOW() ELSE NULL END
      WHERE id = $1 AND tenant_id = $2 AND agente_id = $6 AND estado = 'A_ENVIAR'
      RETURNING id, estado`, [id, agente.tenant_id, !!ok, motivo ? String(motivo).slice(0, 300) : 'Falha sem motivo', MAX_TENTATIVAS, agente.id]);
  if (!r.rows[0]) throw erro(404, 'Trabalho não encontrado ou já concluído');
  return r.rows[0];
}

module.exports = { validarImpressora, criarAgente, listarAgentes, revogarAgente, enfileirar, estadoTrabalho, autenticarAgente, reclamar, concluir, MAX_BYTES };
