'use strict';
/**
 * StockService — lógica de negócio de stock isolada dos route handlers.
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { erro } = require('./shared');

async function listarStock({ tenantId, page = 1, limit = 200 }) {
  page  = Math.max(1, page);
  limit = Math.min(500, Math.max(1, limit));
  const offset = (page - 1) * limit;

  const [r, countR] = await Promise.all([
    pool.query(`
      SELECT s.*,
        CASE WHEN s.stock_atual <= s.stock_minimo THEN true ELSE false END as alerta_stock
      FROM stock_items s
      WHERE s.ativo = true AND ($1::uuid IS NULL OR s.tenant_id = $1)
      ORDER BY s.categoria, s.nome
      LIMIT $2 OFFSET $3
    `, [tenantId || null, limit, offset]),
    pool.query(
      `SELECT COUNT(*) FROM stock_items WHERE ativo = true AND ($1::uuid IS NULL OR tenant_id = $1)`,
      [tenantId || null]
    ),
  ]);

  return { data: r.rows, page, limit, total: parseInt(countR.rows[0].count) };
}

async function criarItemStock({ tenantId, nome, categoria, stock_atual, stock_minimo, stock_ideal, unidade, custo_unitario, fornecedor }) {
  if (!nome || !categoria || !unidade) {
    const err = new Error('Nome, categoria e unidade são obrigatórios');
    err.statusCode = 400; throw err;
  }

  const r = await pool.query(
    `INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, stock_minimo, stock_ideal, unidade, custo_unitario, fornecedor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenantId || null, nome, categoria, stock_atual || 0, stock_minimo || 0, stock_ideal || 0, unidade, custo_unitario || null, fornecedor || null]
  );
  return r.rows[0];
}

async function registarMovimento({ tenantId, userId, itemId, tipo, quantidade, motivo }) {
  const TIPOS_VALIDOS = ['VENDA', 'COMPRA', 'AJUSTE', 'DESPERDICIO', 'INVENTARIO'];
  if (!TIPOS_VALIDOS.includes(tipo)) {
    const err = new Error('Tipo de movimento inválido'); err.statusCode = 400; throw err;
  }
  if (!quantidade || isNaN(quantidade) || parseFloat(quantidade) === 0) {
    const err = new Error('Quantidade inválida'); err.statusCode = 400; throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const s = await client.query(
      `SELECT stock_atual FROM stock_items WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2) FOR UPDATE`,
      [itemId, tenantId || null]
    );
    if (!s.rows[0]) {
      const err = new Error('Item não encontrado'); err.statusCode = 404; throw err;
    }

    const antes = parseFloat(s.rows[0].stock_atual);
    let delta;
    if (tipo === 'COMPRA' || tipo === 'INVENTARIO') delta = Math.abs(quantidade);
    else if (tipo === 'VENDA' || tipo === 'DESPERDICIO') delta = -Math.abs(quantidade);
    else delta = parseFloat(quantidade);

    const depois = antes + delta;
    if (depois < 0) {
      await client.query('ROLLBACK');
      const err = new Error('Stock insuficiente');
      err.statusCode = 409; err.disponivel = antes; throw err;
    }

    await client.query(
      `UPDATE stock_items SET stock_atual=$1, atualizado_em=NOW() WHERE id=$2`,
      [depois, itemId]
    );
    const r = await client.query(
      `INSERT INTO movimentos_stock (stock_item_id, tipo, quantidade, quantidade_antes, motivo, operador_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [itemId, tipo, quantidade, antes, motivo || null, userId]
    );
    await client.query('COMMIT');

    const item = await pool.query(`SELECT * FROM stock_items WHERE id=$1`, [itemId]);
    if (parseFloat(item.rows[0].stock_atual) <= parseFloat(item.rows[0].stock_minimo)) {
      broadcast('alerta_stock', { item: item.rows[0], mensagem: `Stock baixo: ${item.rows[0].nome}` }, item.rows[0].tenant_id || null);
    }

    return r.rows[0];
  } catch (e) {
    // ROLLBACK já feito acima no caso de stock insuficiente; nos outros casos faz aqui
    try { await client.query('ROLLBACK'); } catch (_) { /* ignorar */ }
    throw e;
  } finally {
    client.release();
  }
}


// ───────────────────────── Vendas ↔ stock ─────────────────────────
const arred3 = n => Math.round(n * 1000) / 1000;

/**
 * Abate o stock consumido pelas linhas de um pedido. Corre DENTRO da transacção do pedido (db = cliente da tx):
 * se faltar stock de qualquer ingrediente, lança 409 e o pedido inteiro é revertido.
 * Produtos sem receita (produto_ingredientes) não mexem no stock.
 * @param linhas [{ produto_id, quantidade }]
 * @returns {Array} itens que ficaram em/abaixo do mínimo (o chamador faz o broadcast depois do COMMIT)
 */
async function baixarStockPedido(db, { tenantId, pedidoId, linhas, userId }) {
  const ids = [...new Set(linhas.map(l => l.produto_id))];
  if (!ids.length) return [];
  const ing = await db.query(
    `SELECT pi.produto_id, pi.stock_item_id, pi.quantidade
       FROM produto_ingredientes pi JOIN stock_items si ON si.id = pi.stock_item_id
      WHERE pi.produto_id = ANY($1::uuid[]) AND ($2::uuid IS NULL OR si.tenant_id = $2)`,
    [ids, tenantId || null]
  );
  if (!ing.rows.length) return [];

  const qtdPorProduto = new Map();
  for (const l of linhas) qtdPorProduto.set(l.produto_id, (qtdPorProduto.get(l.produto_id) || 0) + Number(l.quantidade));
  const precisa = new Map(); // stock_item_id → total a abater
  for (const r of ing.rows) {
    precisa.set(r.stock_item_id, arred3((precisa.get(r.stock_item_id) || 0) + Number(r.quantidade) * (qtdPorProduto.get(r.produto_id) || 0)));
  }

  const alertas = [];
  for (const itemId of [...precisa.keys()].sort()) { // ordem estável: evita deadlocks entre pedidos concorrentes
    const necessario = precisa.get(itemId);
    const s = await db.query(`SELECT id, nome, stock_atual, stock_minimo, tenant_id, unidade FROM stock_items WHERE id = $1 FOR UPDATE`, [itemId]);
    const it = s.rows[0];
    const antes = Number(it.stock_atual), depois = arred3(antes - necessario);
    if (depois < 0) throw erro(409, `Stock insuficiente de ${it.nome}`, { item: it.nome, disponivel: antes, necessario, unidade: it.unidade });
    await db.query(`UPDATE stock_items SET stock_atual = $1, atualizado_em = NOW() WHERE id = $2`, [depois, itemId]);
    await db.query(
      `INSERT INTO movimentos_stock (stock_item_id, tipo, quantidade, quantidade_antes, motivo, operador_id, pedido_id)
       VALUES ($1,'VENDA',$2,$3,$4,$5,$6)`,
      [itemId, necessario, antes, `Pedido ${String(pedidoId).slice(0, 8).toUpperCase()}`, userId || null, pedidoId]
    );
    if (depois <= Number(it.stock_minimo)) alertas.push({ ...it, stock_atual: depois });
  }
  return alertas;
}

/** Devolve ao stock o que um pedido cancelado tinha abatido — uma só vez (movimento ESTORNO). */
async function devolverStockPedido(db, { pedidoId, userId }) {
  const ja = await db.query(`SELECT 1 FROM movimentos_stock WHERE pedido_id = $1 AND tipo = 'ESTORNO' LIMIT 1`, [pedidoId]);
  if (ja.rows.length) return;
  const mov = await db.query(`SELECT stock_item_id, SUM(quantidade) AS q FROM movimentos_stock WHERE pedido_id = $1 AND tipo = 'VENDA' GROUP BY stock_item_id ORDER BY stock_item_id`, [pedidoId]);
  for (const m of mov.rows) {
    const s = await db.query(`SELECT stock_atual FROM stock_items WHERE id = $1 FOR UPDATE`, [m.stock_item_id]);
    const antes = Number(s.rows[0].stock_atual), q = Number(m.q), depois = arred3(antes + q);
    await db.query(`UPDATE stock_items SET stock_atual = $1, atualizado_em = NOW() WHERE id = $2`, [depois, m.stock_item_id]);
    await db.query(
      `INSERT INTO movimentos_stock (stock_item_id, tipo, quantidade, quantidade_antes, motivo, operador_id, pedido_id)
       VALUES ($1,'ESTORNO',$2,$3,$4,$5,$6)`,
      [m.stock_item_id, q, antes, `Cancelamento do pedido ${String(pedidoId).slice(0, 8).toUpperCase()}`, userId || null, pedidoId]
    );
  }
}

function avisarStockBaixo(alertas) {
  for (const it of alertas) broadcast('alerta_stock', { item: it, mensagem: `Stock baixo: ${it.nome}` }, it.tenant_id || null);
}

/** Receita de um produto (o que consome do stock por unidade vendida). */
async function obterIngredientes({ tenantId, produtoId }) {
  const p = await pool.query(`SELECT id FROM produtos WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [produtoId, tenantId || null]);
  if (!p.rows[0]) throw erro(404, 'Produto não encontrado');
  const r = await pool.query(
    `SELECT pi.stock_item_id, si.nome, si.unidade, pi.quantidade FROM produto_ingredientes pi JOIN stock_items si ON si.id = pi.stock_item_id WHERE pi.produto_id = $1 ORDER BY si.nome`, [produtoId]);
  return r.rows;
}

/** Substitui a receita de um produto. `ingredientes`: [{ stock_item_id, quantidade }] (vazio = não abate stock). */
async function definirIngredientes({ tenantId, produtoId, ingredientes }) {
  if (!Array.isArray(ingredientes)) throw erro(400, 'ingredientes deve ser uma lista');
  const vistos = new Set();
  for (const i of ingredientes) {
    if (!i || !/^[0-9a-f-]{36}$/i.test(String(i.stock_item_id))) throw erro(400, 'stock_item_id inválido');
    const q = Number(i.quantidade);
    if (!(q > 0) || q > 1e6) throw erro(400, 'A quantidade de cada ingrediente deve ser positiva');
    if (vistos.has(i.stock_item_id)) throw erro(400, 'Ingrediente repetido');
    vistos.add(i.stock_item_id);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(`SELECT id FROM produtos WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [produtoId, tenantId || null]);
    if (!p.rows[0]) throw erro(404, 'Produto não encontrado');
    for (const i of ingredientes) {
      const s = await client.query(`SELECT id FROM stock_items WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [i.stock_item_id, tenantId || null]);
      if (!s.rows[0]) throw erro(404, 'Item de stock não encontrado');
    }
    await client.query(`DELETE FROM produto_ingredientes WHERE produto_id = $1`, [produtoId]);
    for (const i of ingredientes) {
      await client.query(`INSERT INTO produto_ingredientes (produto_id, stock_item_id, quantidade) VALUES ($1,$2,$3)`, [produtoId, i.stock_item_id, arred3(Number(i.quantidade))]);
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignorar */ }
    throw e;
  } finally { client.release(); }
  return obterIngredientes({ tenantId, produtoId });
}

module.exports = { listarStock, criarItemStock, registarMovimento, baixarStockPedido, devolverStockPedido, avisarStockBaixo, obterIngredientes, definirIngredientes };
