'use strict';
/**
 * PedidosService — lógica de negócio isolada dos route handlers.
 * Os handlers em routes/pedidos.js apenas validam input, chamam aqui,
 * e formatam a resposta HTTP.
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { buildWhere, withTx } = require('./shared');

/**
 * Lista pedidos paginados com filtros opcionais.
 * @returns {{ data: Array, page: number, limit: number, total: number }}
 */
async function listarPedidos({ tenantId, status, mesa_id, data_inicio, data_fim, page = 1, limit = 100 }) {
  page  = Math.max(1, page);
  limit = Math.min(200, Math.max(1, limit));
  const offset = (page - 1) * limit;

  const baseConditions = ['($1::uuid IS NULL OR p.tenant_id = $1)'];
  const baseVals       = [tenantId || null];

  const dynamicFilters = {};
  if (status)  dynamicFilters.status  = status;
  if (mesa_id) dynamicFilters.mesa_id = mesa_id;

  // alias 'p' obrigatório: mesas também tem coluna `status` (ambiguidade no JOIN)
  let { where: filterWhere, vals: filterVals } = buildWhere(baseConditions, baseVals, dynamicFilters, 'p');

  if (data_inicio) {
    filterVals.push(data_inicio);
    filterWhere += (filterWhere ? ' AND ' : 'WHERE ') + `p.criado_em >= $${filterVals.length}`;
  }
  if (data_fim) {
    filterVals.push(data_fim);
    filterWhere += (filterWhere ? ' AND ' : 'WHERE ') + `p.criado_em <= $${filterVals.length}`;
  }

  const dataQ = `
    SELECT p.*, m.numero AS mesa_numero, m.zona AS mesa_zona,
           f.nome AS funcionario_nome,
           json_agg(json_build_object(
             'id', ip.id, 'produto_id', ip.produto_id, 'produto_nome', pr.nome,
             'quantidade', ip.quantidade, 'preco_unitario', ip.preco_unitario,
             'status_cozinha', ip.status_cozinha, 'observacoes', ip.observacoes
           )) FILTER (WHERE ip.id IS NOT NULL) AS itens
    FROM pedidos p
    LEFT JOIN mesas m         ON p.mesa_id = m.id
    LEFT JOIN funcionarios f  ON p.funcionario_id = f.id
    LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
    LEFT JOIN produtos pr     ON ip.produto_id = pr.id
    ${filterWhere}
    GROUP BY p.id, m.numero, m.zona, f.nome
    ORDER BY p.criado_em DESC
    LIMIT $${filterVals.length + 1} OFFSET $${filterVals.length + 2}
  `;
  const countQ = `SELECT COUNT(*) FROM pedidos p ${filterWhere}`;

  const [r, countR] = await Promise.all([
    pool.query(dataQ, [...filterVals, limit, offset]),
    pool.query(countQ, filterVals),
  ]);

  return { data: r.rows, page, limit, total: parseInt(countR.rows[0].count) };
}

/**
 * Lista pedidos criados hoje (fuso de Luanda).
 */
async function listarPedidosHoje({ tenantId }) {
  const r = await pool.query(`
    SELECT p.*, m.numero AS mesa_numero,
           json_agg(json_build_object(
             'produto_nome', pr.nome, 'quantidade', ip.quantidade,
             'preco_unitario', ip.preco_unitario, 'status_cozinha', ip.status_cozinha
           )) FILTER (WHERE ip.id IS NOT NULL) AS itens
    FROM pedidos p
    LEFT JOIN mesas m         ON p.mesa_id = m.id
    LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
    LEFT JOIN produtos pr     ON ip.produto_id = pr.id
    WHERE p.criado_em >= CURRENT_DATE AT TIME ZONE 'Africa/Luanda'
      AND ($1::uuid IS NULL OR p.tenant_id = $1)
    GROUP BY p.id, m.numero
    ORDER BY p.criado_em DESC
  `, [tenantId || null]);
  return r.rows;
}

/**
 * Cria um novo pedido numa transacção.
 * @throws {Error} com mensagem legível em caso de falha de negócio
 */
async function criarPedido({ tenantId, userId, mesa_id, cliente_id, itens, observacoes }) {
  if (!itens || !itens.length) {
    const err = new Error('Pedido sem itens'); err.statusCode = 400; throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    const itensDetalhes = [];
    for (const item of itens) {
      const pr = await client.query(
        `SELECT preco FROM produtos
         WHERE id = $1 AND disponivel = true AND ativo = true
           AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [item.produto_id, tenantId || null]
      );
      if (!pr.rows[0]) {
        const err = new Error(`Produto ${item.produto_id} não disponível`);
        err.statusCode = 400; throw err;
      }
      total += pr.rows[0].preco * item.quantidade;
      itensDetalhes.push({ ...item, preco_unitario: pr.rows[0].preco });
    }

    const pedidoR = await client.query(
      `INSERT INTO pedidos (tenant_id, mesa_id, cliente_id, funcionario_id, total, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId || null, mesa_id || null, cliente_id || null, userId, total, observacoes || null]
    );
    const pedido = pedidoR.rows[0];

    for (const item of itensDetalhes) {
      await client.query(
        `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario, observacoes)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedido.id, item.produto_id, item.quantidade, item.preco_unitario, item.observacoes || null]
      );
    }

    if (mesa_id) {
      await client.query(
        `UPDATE mesas SET status = 'OCUPADA', ultima_atividade = NOW() WHERE id = $1`,
        [mesa_id]
      );
    }

    await client.query('COMMIT');

    const pedidoCompleto = await pool.query(`
      SELECT p.*, m.numero AS mesa_numero,
             json_agg(json_build_object(
               'id', ip.id, 'produto_id', ip.produto_id, 'produto_nome', pr.nome,
               'quantidade', ip.quantidade, 'preco_unitario', ip.preco_unitario,
               'status_cozinha', ip.status_cozinha
             )) AS itens
      FROM pedidos p
      LEFT JOIN mesas m         ON p.mesa_id = m.id
      LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
      LEFT JOIN produtos pr     ON ip.produto_id = pr.id
      WHERE p.id = $1
      GROUP BY p.id, m.numero
    `, [pedido.id]);

    broadcast('novo_pedido', pedidoCompleto.rows[0], tenantId || null);
    return pedidoCompleto.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Actualiza o status de um pedido.
 *  - FECHADO e CANCELADO são estados finais (não se reabre um pedido já facturado/estornado).
 *  - CANCELADO estorna o que foi pago em Nuk-Coin (livro-razão: movimento ESTORNO) — uma só vez.
 *  - A mesa é libertada quando o último pedido activo fecha ou é cancelado.
 */
async function actualizarStatusPedido({ tenantId, pedidoId, status }) {
  const STATUSES_VALIDOS = ['ABERTO', 'EM_PREPARO', 'PRONTO', 'FECHADO', 'CANCELADO'];
  if (!STATUSES_VALIDOS.includes(status)) {
    const err = new Error('Status inválido'); err.statusCode = 400; throw err;
  }

  const pedido = await withTx(async db => {
    const atual = await db.query(
      `SELECT * FROM pedidos WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE`,
      [pedidoId, tenantId || null]
    );
    const p = atual.rows[0];
    if (!p) { const err = new Error('Pedido não encontrado'); err.statusCode = 404; throw err; }
    if (p.status === status) return p; // idempotente
    if (p.status === 'FECHADO' || p.status === 'CANCELADO') {
      const err = new Error(`Pedido ${p.status === 'FECHADO' ? 'fechado' : 'cancelado'}: já não pode mudar de estado`);
      err.statusCode = 409; throw err;
    }

    const r = await db.query(
      `UPDATE pedidos SET status = $1, atualizado_em = NOW() WHERE id = $2 RETURNING *`,
      [status, pedidoId]
    );

    if (status === 'CANCELADO' && parseFloat(p.nukcoin_pago) > 0 && p.cliente_id) {
      const c = await db.query(`SELECT nukcoin_saldo FROM clientes WHERE id = $1 FOR UPDATE`, [p.cliente_id]);
      const antes = parseFloat(c.rows[0].nukcoin_saldo);
      const valor = parseFloat(p.nukcoin_pago);
      const depois = Math.round((antes + valor) * 100) / 100;
      await db.query(`UPDATE clientes SET nukcoin_saldo = $1 WHERE id = $2`, [depois, p.cliente_id]);
      await db.query(
        `INSERT INTO movimentos_nukcoin (cliente_id, tipo, valor, saldo_antes, saldo_depois, descricao, pedido_id)
         VALUES ($1,'ESTORNO',$2,$3,$4,'Estorno por cancelamento de pedido',$5)`,
        [p.cliente_id, valor, antes, depois, pedidoId]
      );
      await db.query(`UPDATE pedidos SET nukcoin_pago = 0 WHERE id = $1`, [pedidoId]);
      r.rows[0].nukcoin_pago = 0;
      r.rows[0].nukcoin_estornado = valor;
    }

    if ((status === 'FECHADO' || status === 'CANCELADO') && p.mesa_id) {
      const outros = await db.query(
        `SELECT 1 FROM pedidos WHERE mesa_id = $1 AND status NOT IN ('FECHADO', 'CANCELADO') AND id != $2 LIMIT 1`,
        [p.mesa_id, pedidoId]
      );
      if (!outros.rows.length) await db.query(`UPDATE mesas SET status = 'LIVRE' WHERE id = $1`, [p.mesa_id]);
    }
    return r.rows[0];
  });

  broadcast('pedido_atualizado', { id: pedidoId, status }, tenantId);
  if (pedido.nukcoin_estornado) broadcast('nukcoin_carregado', { cliente_id: pedido.cliente_id }, tenantId);
  return pedido;
}

/**
 * Actualiza o status de cozinha de um item de pedido.
 */
async function actualizarStatusItem({ tenantId, pedidoId, itemId, status_cozinha }) {
  const STATUSES_COZINHA = ['AGUARDANDO', 'PREPARANDO', 'PRONTO', 'ENTREGUE'];
  if (status_cozinha && !STATUSES_COZINHA.includes(status_cozinha)) {
    const err = new Error('status_cozinha inválido'); err.statusCode = 400; throw err;
  }

  const r = await pool.query(
    `UPDATE itens_pedido ip SET status_cozinha = $1
     FROM pedidos p
     WHERE ip.id = $2 AND ip.pedido_id = $3 AND p.id = ip.pedido_id
       AND ($4::uuid IS NULL OR p.tenant_id = $4)
     RETURNING ip.*`,
    [status_cozinha, itemId, pedidoId, tenantId || null]
  );
  if (!r.rows[0]) {
    const err = new Error('Item não encontrado'); err.statusCode = 404; throw err;
  }
  broadcast('item_atualizado', r.rows[0], tenantId);
  return r.rows[0];
}

module.exports = { listarPedidos, listarPedidosHoje, criarPedido, actualizarStatusPedido, actualizarStatusItem };
