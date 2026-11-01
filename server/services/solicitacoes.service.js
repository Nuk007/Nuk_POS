'use strict';
/**
 * Solicitações do portal do cliente (hospedagem, serviços e eventos) — lógica de negócio.
 *
 * O cliente pede no portal; a equipa vê a solicitação em tempo real no POS e confirma ou cancela.
 * Não há dinheiro envolvido (os preços mostrados no portal são só indicativos), por isso não se grava preço.
 */
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { buildWhere, erro } = require('./shared');

const TIPOS = ['HOSPEDAGEM', 'SERVICO', 'EVENTO'];
const ESTADOS = ['PENDENTE', 'CONFIRMADA', 'CANCELADA'];
const TEL_RE = /^9[0-9]{8}$/;

/** Criada pelo cliente no portal (rota pública). */
async function criar({ tenantId, tipo, nome_servico, nome, telefone, observacoes }) {
  if (!TIPOS.includes(tipo)) throw erro(400, `Tipo inválido. Valores aceites: ${TIPOS.join(', ')}`);
  const servico = String(nome_servico || '').trim();
  if (servico.length < 2 || servico.length > 120) throw erro(400, 'Indique o serviço pretendido (2 a 120 caracteres)');
  const contacto = String(nome || '').trim();
  if (contacto.length < 2 || contacto.length > 200) throw erro(400, 'Nome obrigatório (mínimo 2 caracteres)');
  const tel = String(telefone || '').replace(/\s/g, '');
  if (!TEL_RE.test(tel)) throw erro(400, 'Número de telefone inválido (formato 9XXXXXXXX)');
  const obs = observacoes ? String(observacoes).trim().slice(0, 500) : null;

  const id = uuidv4();
  const r = await pool.query(
    `INSERT INTO solicitacoes_portal (id, tenant_id, tipo, nome_servico, nome_contacto, telefone_contacto, observacoes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tipo, nome_servico, nome_contacto, telefone_contacto, status, criado_em`,
    [id, tenantId, tipo, servico, contacto, tel, obs]);
  broadcast('nova_solicitacao_portal', { id, tipo, nome_servico: servico, nome_contacto: contacto, telefone_contacto: tel }, tenantId);
  return { solicitacao: r.rows[0], mensagem: 'Pedido enviado! A nossa equipa entrará em contacto consigo em breve.' };
}

/** Caixa de entrada do estabelecimento (paginada, por estado e/ou tipo). */
async function listar({ tenantId, status, tipo, page = 1, limit = 50 }) {
  if (status && !ESTADOS.includes(status)) throw erro(400, 'Estado inválido');
  if (tipo && !TIPOS.includes(tipo)) throw erro(400, 'Tipo inválido');
  const pg = Math.max(1, parseInt(page) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const { where, vals } = buildWhere(['tenant_id = $1'], [tenantId], { status, tipo });
  const [dados, total] = await Promise.all([
    pool.query(`SELECT * FROM solicitacoes_portal ${where} ORDER BY criado_em DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`, [...vals, lim, (pg - 1) * lim]),
    pool.query(`SELECT COUNT(*) FROM solicitacoes_portal ${where}`, vals),
  ]);
  return { data: dados.rows, page: pg, limit: lim, total: parseInt(total.rows[0].count) };
}

async function contarPendentes({ tenantId }) {
  const r = await pool.query(`SELECT COUNT(*) FROM solicitacoes_portal WHERE tenant_id = $1 AND status = 'PENDENTE'`, [tenantId]);
  return { pendentes: parseInt(r.rows[0].count) };
}

async function actualizarStatus({ tenantId, id, status }) {
  if (!ESTADOS.includes(status)) throw erro(400, 'Estado inválido');
  const r = await pool.query(
    `UPDATE solicitacoes_portal SET status = $1, atualizado_em = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *`,
    [status, id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Solicitação não encontrada');
  return r.rows[0];
}

module.exports = { criar, listar, contarPendentes, actualizarStatus, TIPOS, ESTADOS };
