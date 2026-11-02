'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const svc = require('../services/dashboard.service');

const falha = (res, next) => e => e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e);

// GET /api/dashboard
router.get('/', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const [
      resumoHoje, mesasStatus, quartosStatus, stockAlertas,
      pedidosAbertos, topProdutos
    ] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total) FILTER (WHERE status='FECHADO'),0) as receita_hoje,
               COUNT(CASE WHEN status='FECHADO' THEN 1 END) as fechados
        FROM pedidos WHERE (criado_em AT TIME ZONE 'Africa/Luanda')::date = (NOW() AT TIME ZONE 'Africa/Luanda')::date
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
        WHERE (p.criado_em AT TIME ZONE 'Africa/Luanda')::date = (NOW() AT TIME ZONE 'Africa/Luanda')::date AND p.status = 'FECHADO'
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

/**
 * @openapi
 * /api/dashboard/comparativo:
 *   get:
 *     tags: [Dashboard]
 *     summary: Facturação e itens configurados — hoje, ontem e dia homólogo da semana (Africa/Luanda)
 *     responses: { 200: { description: "{ dias, facturacao: {valor, restaurante, quartos}, itens: [...] }" } }
 * /api/dashboard/itens:
 *   get:
 *     tags: [Dashboard]
 *     summary: Itens configurados (ADMIN), incluindo ocultos
 *     responses: { 200: { description: Lista de itens } }
 *   post:
 *     tags: [Dashboard]
 *     summary: Acrescentar item a controlar (ADMIN) — fonte PRODUTO, CATEGORIA, SERVICO, CONTADOR ou PENDENCIA
 *     responses: { 201: { description: Item criado }, 400: { description: Dados inválidos } }
 * /api/dashboard/itens/{id}:
 *   put:
 *     tags: [Dashboard]
 *     summary: Renomear ou ocultar/mostrar um item (ADMIN)
 *     responses: { 200: { description: Item actualizado } }
 *   delete:
 *     tags: [Dashboard]
 *     summary: Remover item e os seus registos (ADMIN)
 *     responses: { 204: { description: Removido } }
 * /api/dashboard/itens/{id}/registos:
 *   post:
 *     tags: [Dashboard]
 *     summary: Registo manual (MAIS/MENOS num contador; ABRIR/TRATAR numa pendência) — qualquer funcionário
 *     responses: { 204: { description: Registado }, 409: { description: Já está a zero / nada em aberto } }
 */
router.get('/comparativo', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.comparativo({ tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});
router.get('/itens', authMiddleware, requerNivel(['ADMIN']), async (req, res, next) => {
  try { res.json({ itens: await svc.listarItens({ tenantId: req.tenantId }), servicos: svc.SERVICOS }); } catch (e) { falha(res, next)(e); }
});
router.post('/itens', authMiddleware, requerNivel(['ADMIN']), async (req, res, next) => {
  try { res.status(201).json(await svc.criarItem({ ...req.body, tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});
router.put('/itens/:id', authMiddleware, requerNivel(['ADMIN']), validarUUID('id'), async (req, res, next) => {
  try { res.json(await svc.actualizarItem({ ...req.body, tenantId: req.tenantId, id: req.params.id })); } catch (e) { falha(res, next)(e); }
});
router.delete('/itens/:id', authMiddleware, requerNivel(['ADMIN']), validarUUID('id'), async (req, res, next) => {
  try { await svc.removerItem({ tenantId: req.tenantId, id: req.params.id }); res.status(204).end(); } catch (e) { falha(res, next)(e); }
});
router.post('/itens/:id/registos', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try { await svc.registar({ tenantId: req.tenantId, userId: req.user.id, itemId: req.params.id, evento: (req.body || {}).evento }); res.status(204).end(); } catch (e) { falha(res, next)(e); }
});

module.exports = router;
