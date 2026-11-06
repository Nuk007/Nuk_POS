'use strict';
/**
 * ComprasService — compras pontuais pagas só com o dinheiro do caixa do dia e só de produtos cadastrados (itens de stock).
 * A compra sai da gaveta (movimento CASH negativo no caixa) e entra no stock. Nunca se apaga: anula-se com o movimento contrário.
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { withTx, erro } = require('./shared');

const arred = n => Math.round(n * 100) / 100;
const arred3 = n => Math.round(n * 1000) / 1000;

async function sessaoBloqueada(db, tenantId) {
  const r = await db.query(`SELECT * FROM caixa_sessoes WHERE tenant_id = $1 AND fechada_em IS NULL FOR UPDATE`, [tenantId]);
  if (!r.rows[0]) throw erro(409, 'O caixa está fechado. Abra o caixa do dia primeiro.', { codigo: 'CAIXA_FECHADO' });
  return r.rows[0];
}
async function dinheiroNaGaveta(db, sessao) {
  const r = await db.query(`SELECT COALESCE(SUM(valor),0) AS cash FROM caixa_movimentos WHERE sessao_id = $1 AND metodo = 'CASH'`, [sessao.id]);
  return arred(parseFloat(sessao.fundo_inicial) + parseFloat(r.rows[0].cash));
}

async function listar({ tenantId }) {
  const r = await pool.query(`
    SELECT c.id, c.quantidade, c.valor_total, c.fornecedor, c.observacoes, c.criado_em, c.anulada_em, c.sessao_id,
           s.nome AS item_nome, s.unidade, f.nome AS operador, (cs.fechada_em IS NULL) AS sessao_aberta
    FROM compras_pontuais c
    JOIN stock_items s ON s.id = c.stock_item_id
    JOIN caixa_sessoes cs ON cs.id = c.sessao_id
    LEFT JOIN funcionarios f ON f.id = c.criado_por
    WHERE c.tenant_id = $1 ORDER BY c.criado_em DESC LIMIT 100`, [tenantId]);
  return r.rows;
}

async function registar({ tenantId, userId, stock_item_id, quantidade, valor_total, fornecedor, observacoes }) {
  const q = Number(quantidade), v = Number(valor_total);
  if (!stock_item_id) throw erro(400, 'Escolha o produto comprado (tem de estar cadastrado no stock)');
  if (!Number.isFinite(q) || q <= 0 || q > 1000000) throw erro(400, 'Quantidade inválida');
  if (!Number.isFinite(v) || v <= 0 || v > 100000000) throw erro(400, 'Valor pago inválido');

  const out = await withTx(async db => {
    const sessao = await sessaoBloqueada(db, tenantId);
    const it = await db.query(`SELECT id, nome, stock_atual, stock_minimo, unidade FROM stock_items WHERE id = $1::uuid AND tenant_id = $2 AND ativo = true FOR UPDATE`, [stock_item_id, tenantId]);
    if (!it.rows[0]) throw erro(404, 'Produto não encontrado. Só se compra o que está cadastrado no stock.');
    const gaveta = await dinheiroNaGaveta(db, sessao);
    if (arred(v) > gaveta) throw erro(409, 'Dinheiro insuficiente no caixa para esta compra', { disponivel: gaveta });

    const c = await db.query(
      `INSERT INTO compras_pontuais (tenant_id, sessao_id, stock_item_id, quantidade, valor_total, fornecedor, observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tenantId, sessao.id, stock_item_id, arred3(q), arred(v), fornecedor ? String(fornecedor).slice(0, 120) : null, observacoes ? String(observacoes).slice(0, 500) : null, userId || null]);
    await db.query(
      `INSERT INTO caixa_movimentos (tenant_id, sessao_id, tipo, metodo, valor, descricao, compra_id, criado_por) VALUES ($1,$2,'COMPRA','CASH',$3,$4,$5,$6)`,
      [tenantId, sessao.id, -arred(v), `Compra: ${it.rows[0].nome}`, c.rows[0].id, userId || null]);

    const antes = parseFloat(it.rows[0].stock_atual);
    await db.query(`UPDATE stock_items SET stock_atual = $1, custo_unitario = $2, atualizado_em = NOW() WHERE id = $3`, [arred3(antes + q), arred(v / q), stock_item_id]);
    await db.query(
      `INSERT INTO movimentos_stock (stock_item_id, tipo, quantidade, quantidade_antes, motivo, operador_id) VALUES ($1,'COMPRA',$2,$3,$4,$5)`,
      [stock_item_id, arred3(q), antes, 'Compra pontual paga pelo caixa', userId || null]);
    return { compra: c.rows[0], item: it.rows[0].nome, dinheiro_na_gaveta: arred(gaveta - v) };
  });
  broadcast('caixa_atualizada', { aberta: true }, tenantId);
  return out;
}

async function anular({ tenantId, userId, id }) {
  const out = await withTx(async db => {
    const sessao = await sessaoBloqueada(db, tenantId);
    const r = await db.query(`SELECT * FROM compras_pontuais WHERE id = $1::uuid AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
    const c = r.rows[0];
    if (!c) throw erro(404, 'Compra não encontrada');
    if (c.anulada_em) throw erro(409, 'Esta compra já foi anulada');
    if (c.sessao_id !== sessao.id) throw erro(409, 'Só se anulam compras do caixa em curso');
    const it = await db.query(`SELECT stock_atual FROM stock_items WHERE id = $1 FOR UPDATE`, [c.stock_item_id]);
    const antes = parseFloat(it.rows[0].stock_atual), q = parseFloat(c.quantidade);
    if (antes - q < 0) throw erro(409, 'Parte do que foi comprado já foi consumido; ajuste o stock em vez de anular', { disponivel: antes });

    await db.query(`UPDATE compras_pontuais SET anulada_em = NOW(), anulada_por = $1 WHERE id = $2`, [userId || null, c.id]);
    await db.query(
      `INSERT INTO caixa_movimentos (tenant_id, sessao_id, tipo, metodo, valor, descricao, compra_id, criado_por) VALUES ($1,$2,'COMPRA','CASH',$3,'Anulação de compra',$4,$5)`,
      [tenantId, sessao.id, arred(parseFloat(c.valor_total)), c.id, userId || null]);
    await db.query(`UPDATE stock_items SET stock_atual = $1, atualizado_em = NOW() WHERE id = $2`, [arred3(antes - q), c.stock_item_id]);
    await db.query(
      `INSERT INTO movimentos_stock (stock_item_id, tipo, quantidade, quantidade_antes, motivo, operador_id) VALUES ($1,'AJUSTE',$2,$3,'Anulação de compra pontual',$4)`,
      [c.stock_item_id, -q, antes, userId || null]);
    return { id: c.id, anulada: true };
  });
  broadcast('caixa_atualizada', { aberta: true }, tenantId);
  return out;
}

module.exports = { listar, registar, anular };
