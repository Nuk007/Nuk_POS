'use strict';
/**
 * Mesa e quarto «em uso» enquanto houver conta por pagar.
 * Conta por pagar = pedido não cancelado sem `pago_em`. Só o Caixa (receber) ou o cancelamento
 * dentro dos primeiros 5 minutos libertam a mesa / o quarto.
 */
const { broadcast } = require('../middleware/broadcast');

const JANELA_CANCELAR_MIN = 5;

/** Há contas por pagar nesta mesa? (opcionalmente ignorando um pedido) */
async function mesaTemContaPorPagar(db, mesaId, ignorarPedidoId = null) {
  const r = await db.query(
    `SELECT 1 FROM pedidos WHERE mesa_id = $1 AND status <> 'CANCELADO' AND pago_em IS NULL AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
    [mesaId, ignorarPedidoId]);
  return r.rows.length > 0;
}

async function quartoTemContaPorPagar(db, quartoId, ignorarPedidoId = null) {
  const r = await db.query(
    `SELECT 1 FROM pedidos WHERE quarto_id = $1 AND status <> 'CANCELADO' AND pago_em IS NULL AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
    [quartoId, ignorarPedidoId]);
  return r.rows.length > 0;
}

/** Liberta a mesa se já não há contas por pagar. Devolve true se mudou. */
async function libertarMesaSePago(db, mesaId, ignorarPedidoId = null) {
  if (!mesaId || await mesaTemContaPorPagar(db, mesaId, ignorarPedidoId)) return false;
  const r = await db.query(`UPDATE mesas SET status = 'LIVRE', ultima_atividade = NOW() WHERE id = $1 AND status = 'OCUPADA' RETURNING id`, [mesaId]);
  return r.rows.length > 0;
}

/** Um quarto POR_PAGAR (já arrumado) fica disponível quando a conta é paga. */
async function libertarQuartoSePago(db, quartoId, ignorarPedidoId = null) {
  if (!quartoId || await quartoTemContaPorPagar(db, quartoId, ignorarPedidoId)) return false;
  const r = await db.query(`UPDATE quartos SET status = 'DISPONIVEL', atualizado_em = NOW() WHERE id = $1 AND status = 'POR_PAGAR' RETURNING id`, [quartoId]);
  return r.rows.length > 0;
}

/** Depois do recebimento no Caixa: liberta as mesas e quartos dos pedidos pagos. */
async function libertarAposPagamento(db, tenantId, pedidos) {
  const mesas = [...new Set(pedidos.map(p => p.mesa_id).filter(Boolean))];
  const quartos = [...new Set(pedidos.map(p => p.quarto_id).filter(Boolean))];
  const libertas = { mesas: [], quartos: [] };
  for (const m of mesas) if (await libertarMesaSePago(db, m)) libertas.mesas.push(m);
  for (const q of quartos) if (await libertarQuartoSePago(db, q)) libertas.quartos.push(q);
  return libertas;
}

function avisarLibertadas(tenantId, libertas) {
  libertas.mesas.forEach(id => broadcast('mesa_atualizada', { id, status: 'LIVRE' }, tenantId));
  libertas.quartos.forEach(id => broadcast('quarto_atualizado', { quarto_id: id, status: 'DISPONIVEL' }, tenantId));
}

module.exports = { JANELA_CANCELAR_MIN, mesaTemContaPorPagar, quartoTemContaPorPagar, libertarMesaSePago, libertarQuartoSePago, libertarAposPagamento, avisarLibertadas };
