'use strict';
/**
 * Conta corrente de clientes (crédito): empresas e hóspedes autorizados consomem e pagam mais tarde.
 *  - Só o ADMIN autoriza o cliente e fixa o limite (cartão em Configurações).
 *  - O consumo entra na conta no Caixa → Receber, com a forma «Conta corrente» (sozinha ou num pagamento misto):
 *    a mesa/quarto fica livre, o pedido fica com pago_metodo CONTA (ou MISTO) e nasce um DEBITO por pedido.
 *  - A liquidação faz-se no Caixa (exige caixa aberto) e entra no livro-razão do caixa como CONTA_PAGAMENTO.
 *  - Saldo em dívida = Σ DEBITO − Σ PAGAMENTO; nunca se paga mais do que se deve; nunca se passa o limite.
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { withTx, erro } = require('./shared');

const METODOS_PAGAMENTO = ['CASH', 'TPA', 'TRANSFERENCIA', 'EXPRESS'];
const cent = v => Math.round(Number(v) * 100);
const kz = c => Number((c / 100).toFixed(2));

const SALDO_SQL = `COALESCE((SELECT SUM(CASE WHEN m.tipo = 'DEBITO' THEN m.valor ELSE -m.valor END)
                              FROM conta_corrente_movimentos m WHERE m.cliente_id = c.id), 0)`;

async function saldoCent(db, clienteId) {
  const r = await db.query(`SELECT COALESCE(SUM(CASE WHEN tipo = 'DEBITO' THEN valor ELSE -valor END), 0) AS s FROM conta_corrente_movimentos WHERE cliente_id = $1`, [clienteId]);
  return cent(r.rows[0].s);
}

/** Bloqueia o cliente (FOR UPDATE) e confirma que é do estabelecimento. */
async function clienteBloqueado(db, tenantId, clienteId) {
  const r = await db.query(`SELECT id, nome, conta_corrente_ativa, limite_credito FROM clientes WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [clienteId, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Cliente não encontrado');
  return r.rows[0];
}

/** Clientes com conta corrente autorizada ou com dívida, com saldo e crédito disponível. */
async function listar({ tenantId }) {
  const r = await pool.query(`
    SELECT c.id, c.nome, c.telefone, c.nif, c.conta_corrente_ativa, c.limite_credito, ${SALDO_SQL} AS saldo
      FROM clientes c
     WHERE c.tenant_id = $1 AND (c.conta_corrente_ativa OR ${SALDO_SQL} <> 0)
     ORDER BY ${SALDO_SQL} DESC, c.nome`, [tenantId]);
  return r.rows.map(x => ({
    ...x, saldo: Number(x.saldo), limite_credito: Number(x.limite_credito),
    disponivel: x.conta_corrente_ativa ? Math.max(0, kz(cent(x.limite_credito) - cent(x.saldo))) : 0,
  }));
}

/** Extracto: movimentos com saldo acumulado (mais recentes primeiro). */
async function extracto({ tenantId, clienteId }) {
  const c = await pool.query(`SELECT c.id, c.nome, c.telefone, c.nif, c.conta_corrente_ativa, c.limite_credito, ${SALDO_SQL} AS saldo FROM clientes c WHERE c.id = $1 AND c.tenant_id = $2`, [clienteId, tenantId]);
  if (!c.rows[0]) throw erro(404, 'Cliente não encontrado');
  const m = await pool.query(`
    SELECT m.id, m.tipo, m.valor, m.metodo, m.descricao, m.criado_em, m.pedido_id, f.nome AS funcionario,
           SUM(CASE WHEN m.tipo = 'DEBITO' THEN m.valor ELSE -m.valor END) OVER (ORDER BY m.criado_em, m.id) AS saldo_apos
      FROM conta_corrente_movimentos m LEFT JOIN funcionarios f ON f.id = m.criado_por
     WHERE m.cliente_id = $1 AND m.tenant_id = $2
     ORDER BY m.criado_em DESC, m.id DESC LIMIT 200`, [clienteId, tenantId]);
  const cli = c.rows[0];
  return {
    cliente: { ...cli, saldo: Number(cli.saldo), limite_credito: Number(cli.limite_credito) },
    movimentos: m.rows.map(x => ({ ...x, valor: Number(x.valor), saldo_apos: Number(x.saldo_apos) })),
  };
}

/** ADMIN: autorizar/retirar a conta corrente e fixar o limite. */
async function configurar({ tenantId, clienteId, ativa, limite }) {
  const l = limite === undefined || limite === null || limite === '' ? null : Number(limite);
  if (l !== null && (!Number.isFinite(l) || l < 0 || l > 1e11)) throw erro(400, 'Limite de crédito inválido');
  if (ativa !== undefined && typeof ativa !== 'boolean') throw erro(400, 'ativa deve ser verdadeiro ou falso');
  const r = await pool.query(`
    UPDATE clientes SET conta_corrente_ativa = COALESCE($3, conta_corrente_ativa), limite_credito = COALESCE($4, limite_credito)
     WHERE id = $1 AND tenant_id = $2 RETURNING id, nome, conta_corrente_ativa, limite_credito`, [clienteId, tenantId, ativa === undefined ? null : ativa, l]);
  if (!r.rows[0]) throw erro(404, 'Cliente não encontrado');
  return { ...r.rows[0], limite_credito: Number(r.rows[0].limite_credito) };
}

/**
 * Usado pelo Caixa dentro da transacção do recebimento: confirma autorização e limite (com o cliente bloqueado).
 * Devolve o cliente; o débito por pedido é feito com `lancarDebito`.
 */
async function verificarCredito(db, { tenantId, clienteId, valorCent }) {
  const c = await clienteBloqueado(db, tenantId, clienteId);
  if (!c.conta_corrente_ativa) throw erro(409, `${c.nome} não tem conta corrente autorizada`, { codigo: 'SEM_CONTA_CORRENTE' });
  const disponivel = cent(c.limite_credito) - await saldoCent(db, clienteId);
  if (valorCent > disponivel) throw erro(409, `Limite de crédito excedido: disponível ${kz(Math.max(0, disponivel)).toFixed(2)} Kz`, { codigo: 'LIMITE_CREDITO', disponivel: kz(Math.max(0, disponivel)) });
  return c;
}
async function lancarDebito(db, { tenantId, clienteId, valor, pedidoId, sessaoId, userId }) {
  await db.query(
    `INSERT INTO conta_corrente_movimentos (tenant_id, cliente_id, tipo, valor, metodo, pedido_id, sessao_id, descricao, criado_por)
     VALUES ($1,$2,'DEBITO',$3,'CONTA',$4,$5,'Consumo lançado na conta',$6)`, [tenantId, clienteId, valor, pedidoId || null, sessaoId || null, userId || null]);
}

/** Liquidação (total ou parcial) no Caixa. */
async function pagar({ tenantId, userId, clienteId, valor, metodo, observacoes }) {
  const m = String(metodo || 'CASH').toUpperCase();
  if (!METODOS_PAGAMENTO.includes(m)) throw erro(400, `Forma de pagamento inválida. Aceites: ${METODOS_PAGAMENTO.join(', ')}`);
  const v = cent(valor);
  if (!Number.isFinite(v) || v <= 0) throw erro(400, 'Valor inválido');
  const obs = observacoes == null ? '' : String(observacoes).trim().slice(0, 200);
  const out = await withTx(async db => {
    const s = await db.query(`SELECT id FROM caixa_sessoes WHERE tenant_id = $1 AND fechada_em IS NULL`, [tenantId]);
    if (!s.rows[0]) throw erro(409, 'O caixa está fechado. Abra o caixa do dia primeiro.', { codigo: 'CAIXA_FECHADO' });
    const c = await clienteBloqueado(db, tenantId, clienteId);
    const deve = await saldoCent(db, clienteId);
    if (deve <= 0) throw erro(409, `${c.nome} não tem dívida em conta corrente`);
    if (v > deve) throw erro(409, `O valor passa a dívida (${kz(deve).toFixed(2)} Kz)`, { codigo: 'ACIMA_DA_DIVIDA', divida: kz(deve) });
    const desc = `Pagamento de conta corrente${obs ? ` — ${obs}` : ''}`;
    await db.query(
      `INSERT INTO conta_corrente_movimentos (tenant_id, cliente_id, tipo, valor, metodo, sessao_id, descricao, criado_por)
       VALUES ($1,$2,'PAGAMENTO',$3,$4,$5,$6,$7)`, [tenantId, clienteId, kz(v), m, s.rows[0].id, desc, userId || null]);
    await db.query(
      `INSERT INTO caixa_movimentos (tenant_id, sessao_id, tipo, metodo, valor, descricao, cliente_id, criado_por)
       VALUES ($1,$2,'CONTA_PAGAMENTO',$3,$4,$5,$6,$7)`, [tenantId, s.rows[0].id, m, kz(v), `Conta corrente · ${c.nome}`, clienteId, userId || null]);
    return { cliente_id: clienteId, pago: kz(v), metodo: m, saldo: kz(deve - v) };
  });
  broadcast('caixa_atualizada', {}, tenantId);
  return out;
}

module.exports = { listar, extracto, configurar, verificarCredito, lancarDebito, pagar, METODOS_PAGAMENTO };
