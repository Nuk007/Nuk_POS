'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, validarUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');

// GET /api/pedidos
router.get('/', authMiddleware, async (req, res) => {
  const { status, mesa_id, data_inicio, data_fim } = req.query;
  const tenantId = req.tenantId;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  let q = `
    SELECT p.*, m.numero as mesa_numero, m.zona as mesa_zona,
           f.nome as funcionario_nome,
           json_agg(json_build_object(
             'id', ip.id, 'produto_id', ip.produto_id, 'produto_nome', pr.nome,
             'quantidade', ip.quantidade, 'preco_unitario', ip.preco_unitario,
             'status_cozinha', ip.status_cozinha, 'observacoes', ip.observacoes
           )) FILTER (WHERE ip.id IS NOT NULL) as itens
    FROM pedidos p
    LEFT JOIN mesas m ON p.mesa_id = m.id
    LEFT JOIN funcionarios f ON p.funcionario_id = f.id
    LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
    LEFT JOIN produtos pr ON ip.produto_id = pr.id
    WHERE ($1::uuid IS NULL OR p.tenant_id = $1)
  `;
  const vals = [tenantId || null];
  if (status) { q += ` AND p.status = $${vals.length + 1}`; vals.push(status); }
  if (mesa_id) { q += ` AND p.mesa_id = $${vals.length + 1}`; vals.push(mesa_id); }
  if (data_inicio) { q += ` AND p.criado_em >= $${vals.length + 1}`; vals.push(data_inicio); }
  if (data_fim) { q += ` AND p.criado_em <= $${vals.length + 1}`; vals.push(data_fim); }
  q += ` GROUP BY p.id, m.numero, m.zona, f.nome ORDER BY p.criado_em DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
  vals.push(limit, offset);
  try {
    const r = await pool.query(q, vals);
    res.json({ data: r.rows, page, limit, total: r.rows.length });
  } catch (e) {
    console.error('GET /api/pedidos:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// GET /api/pedidos/hoje
router.get('/hoje', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(`
      SELECT p.*, m.numero as mesa_numero,
             json_agg(json_build_object(
               'produto_nome', pr.nome, 'quantidade', ip.quantidade,
               'preco_unitario', ip.preco_unitario, 'status_cozinha', ip.status_cozinha
             )) FILTER (WHERE ip.id IS NOT NULL) as itens
      FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
      LEFT JOIN produtos pr ON ip.produto_id = pr.id
      WHERE p.criado_em >= CURRENT_DATE AT TIME ZONE 'Africa/Luanda'
        AND ($1::uuid IS NULL OR p.tenant_id = $1)
      GROUP BY p.id, m.numero
      ORDER BY p.criado_em DESC
    `, [tenantId || null]);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/pedidos/hoje:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/pedidos
router.post('/', authMiddleware, async (req, res) => {
  const { mesa_id, cliente_id, itens, observacoes } = req.body;
  if (!itens || !itens.length) return res.status(400).json({ erro: 'Pedido sem itens' });
  const tenantId = req.tenantId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    const itensDetalhes = [];
    for (const item of itens) {
      const pr = await client.query(
        `SELECT preco FROM produtos WHERE id=$1 AND disponivel=true AND ativo=true
         AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [item.produto_id, tenantId || null]
      );
      if (!pr.rows[0]) throw new Error(`Produto ${item.produto_id} não disponível`);
      const subtotal = pr.rows[0].preco * item.quantidade;
      total += subtotal;
      itensDetalhes.push({ ...item, preco_unitario: pr.rows[0].preco });
    }

    const pedidoR = await client.query(
      `INSERT INTO pedidos (tenant_id, mesa_id, cliente_id, funcionario_id, total, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId || null, mesa_id || null, cliente_id || null, req.user.id, total, observacoes || null]
    );
    const pedido = pedidoR.rows[0];

    for (const item of itensDetalhes) {
      await client.query(
        `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario, observacoes)
         VALUES ($1,$2,$3,$4,$5)`,
        [pedido.id, item.produto_id, item.quantidade, item.preco_unitario, item.observacoes || null]
      );
    }

    if (mesa_id) {
      await client.query(`UPDATE mesas SET status='OCUPADA', ultima_atividade=NOW() WHERE id=$1`, [mesa_id]);
    }

    await client.query('COMMIT');

    const pedidoCompleto = await pool.query(`
      SELECT p.*, m.numero as mesa_numero,
             json_agg(json_build_object(
               'id', ip.id, 'produto_id', ip.produto_id, 'produto_nome', pr.nome,
               'quantidade', ip.quantidade, 'preco_unitario', ip.preco_unitario,
               'status_cozinha', ip.status_cozinha
             )) as itens
      FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
      LEFT JOIN produtos pr ON ip.produto_id = pr.id
      WHERE p.id = $1
      GROUP BY p.id, m.numero
    `, [pedido.id]);

    broadcast('novo_pedido', pedidoCompleto.rows[0], tenantId || null);
    res.status(201).json(pedidoCompleto.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ erro: e.message });
  } finally {
    client.release();
  }
});

// PATCH /api/pedidos/:id/status
router.patch('/:id/status', authMiddleware, validarUUID('id'), async (req, res) => {
  const STATUSES_VALIDOS = ['ABERTO','EM_PREPARO','PRONTO','FECHADO','CANCELADO'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE pedidos SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND ($3::uuid IS NULL OR tenant_id = $3) RETURNING *`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Pedido não encontrado' });

    if (status === 'FECHADO' && r.rows[0].mesa_id) {
      const outrosPedidos = await pool.query(
        `SELECT id FROM pedidos WHERE mesa_id=$1 AND status NOT IN ('FECHADO','CANCELADO') AND id != $2`,
        [r.rows[0].mesa_id, req.params.id]
      );
      if (!outrosPedidos.rows.length) {
        await pool.query(`UPDATE mesas SET status='LIVRE' WHERE id=$1`, [r.rows[0].mesa_id]);
      }
    }

    broadcast('pedido_atualizado', { id: req.params.id, status }, tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PATCH /api/pedidos/:id/status:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// PATCH /api/pedidos/:pedidoId/itens/:itemId/status
router.patch('/:pedidoId/itens/:itemId/status', authMiddleware, validarUUID('pedidoId'), validarUUID('itemId'), async (req, res) => {
  const { status_cozinha } = req.body;
  const STATUSES_COZINHA = ['AGUARDANDO', 'PREPARANDO', 'PRONTO', 'ENTREGUE'];
  if (status_cozinha && !STATUSES_COZINHA.includes(status_cozinha)) {
    return res.status(400).json({ erro: 'status_cozinha inválido' });
  }
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE itens_pedido ip SET status_cozinha=$1
       FROM pedidos p
       WHERE ip.id=$2 AND ip.pedido_id=$3 AND p.id=ip.pedido_id
         AND ($4::uuid IS NULL OR p.tenant_id=$4)
       RETURNING ip.*`,
      [status_cozinha, req.params.itemId, req.params.pedidoId, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Item não encontrado' });
    broadcast('item_atualizado', r.rows[0], tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PATCH itens status:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
