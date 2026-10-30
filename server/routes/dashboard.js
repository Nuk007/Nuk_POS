'use strict';
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/dashboard
router.get('/', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const [
      resumoHoje, mesasStatus, quartosStatus, stockAlertas,
      pedidosAbertos, topProdutos
    ] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total),0) as receita_hoje,
               COUNT(CASE WHEN status='FECHADO' THEN 1 END) as fechados
        FROM pedidos WHERE criado_em::date = CURRENT_DATE
          AND ($1::uuid IS NULL OR tenant_id = $1)
      `, [tenantId || null]),
      pool.query(`SELECT status, COUNT(*) as total FROM mesas WHERE ($1::uuid IS NULL OR tenant_id = $1) GROUP BY status`, [tenantId || null]),
      pool.query(`SELECT status, COUNT(*) as total FROM quartos WHERE ($1::uuid IS NULL OR tenant_id = $1) GROUP BY status`, [tenantId || null]),
      pool.query(`SELECT COUNT(*) as total FROM stock_items WHERE ativo=true AND stock_atual <= stock_minimo AND ($1::uuid IS NULL OR tenant_id=$1)`, [tenantId || null]),
      pool.query(`
        SELECT p.id, p.status, m.numero as mesa, p.total, p.criado_em,
               COUNT(ip.id) as num_itens
        FROM pedidos p
        LEFT JOIN mesas m ON p.mesa_id = m.id
        LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
        WHERE p.status IN ('ABERTO','EM_PREPARO','PRONTO')
          AND ($1::uuid IS NULL OR p.tenant_id = $1)
        GROUP BY p.id, m.numero
        ORDER BY p.criado_em ASC
      `, [tenantId || null]),
      pool.query(`
        SELECT pr.nome, pr.categoria, SUM(ip.quantidade) as total_vendido
        FROM itens_pedido ip
        JOIN produtos pr ON ip.produto_id = pr.id
        JOIN pedidos p ON ip.pedido_id = p.id
        WHERE p.criado_em::date = CURRENT_DATE AND p.status = 'FECHADO'
          AND ($1::uuid IS NULL OR p.tenant_id = $1)
        GROUP BY pr.id ORDER BY total_vendido DESC LIMIT 5
      `, [tenantId || null]),
    ]);

    res.json({
      resumo_hoje: resumoHoje.rows[0],
      mesas: mesasStatus.rows,
      quartos: quartosStatus.rows,
      alertas_stock: parseInt(stockAlertas.rows[0].total),
      pedidos_abertos: pedidosAbertos.rows,
      top_produtos: topProdutos.rows,
    });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
