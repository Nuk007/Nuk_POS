'use strict';
/**
 * StockService — lógica de negócio de stock isolada dos route handlers.
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');

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

module.exports = { listarStock, criarItemStock, registarMovimento };
