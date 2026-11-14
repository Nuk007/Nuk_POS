'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');

// GET /api/financeiro/resumo
router.get('/resumo', authMiddleware, async (req, res) => {
  const { data } = req.query;
  let dataFiltro = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' }); // dia civil em Luanda (UTC+1)
  if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    const d = new Date(data + 'T00:00:00Z');
    if (!isNaN(d.getTime()) && d.toISOString().startsWith(data)) {
      dataFiltro = data;
    }
  }
  const tenantId = req.tenantId;
  try {
    const [vendas, porCategoria, porStatus, quartos] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE status <> 'CANCELADO') as total_pedidos,
               COALESCE(SUM(total) FILTER (WHERE status = 'FECHADO'),0) as receita_total,
               COUNT(*) FILTER (WHERE status = 'FECHADO') as pedidos_fechados,
               COUNT(*) FILTER (WHERE status = 'CANCELADO') as pedidos_cancelados
        FROM pedidos WHERE (criado_em AT TIME ZONE 'Africa/Luanda')::date = $1 AND ($2::uuid IS NULL OR tenant_id=$2)
      `, [dataFiltro, tenantId || null]),
      pool.query(`
        SELECT pr.categoria, COALESCE(SUM(ip.quantidade),0) as itens_vendidos, COALESCE(SUM(ip.quantidade * ip.preco_unitario),0) as total
        FROM itens_pedido ip
        JOIN produtos pr ON ip.produto_id = pr.id
        JOIN pedidos p ON ip.pedido_id = p.id
        WHERE (p.criado_em AT TIME ZONE 'Africa/Luanda')::date = $1 AND p.status = 'FECHADO'
          AND ($2::uuid IS NULL OR p.tenant_id=$2)
        GROUP BY pr.categoria ORDER BY total DESC
      `, [dataFiltro, tenantId || null]),
      pool.query(`
        SELECT status, COUNT(*) as total, COALESCE(SUM(total),0) as valor
        FROM pedidos WHERE (criado_em AT TIME ZONE 'Africa/Luanda')::date = $1 AND ($2::uuid IS NULL OR tenant_id=$2) GROUP BY status
      `, [dataFiltro, tenantId || null]),
      pool.query(`
        SELECT COUNT(*) as total_reservas, COALESCE(SUM(rv.valor_total),0) as receita_quartos
        FROM reservas rv JOIN quartos q ON rv.quarto_id=q.id
        WHERE (rv.criado_em AT TIME ZONE 'Africa/Luanda')::date = $1 AND rv.status != 'CANCELADA'
          AND ($2::uuid IS NULL OR q.tenant_id=$2)
      `, [dataFiltro, tenantId || null]),
    ]);

    res.json({
      data: dataFiltro,
      pedidos: vendas.rows[0],
      por_categoria: porCategoria.rows,
      por_status: porStatus.rows,
      quartos: quartos.rows[0],
    });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

const svc = require('../services/fiscal/faturas.service');

/** Mapeia os erros dos serviços (err.statusCode) e o 23505 de corrida na numeração. */
const h = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    if (e.code === '23505') return res.status(409).json({ erro: 'Factura duplicada' });
    console.error(`${req.method} /financeiro${req.path}:`, e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};
const base = req => ({ tenantId: req.tenantId, userId: req.user && req.user.id });

/**
 * @openapi
 * /api/financeiro/faturas:
 *   get:
 *     tags: [Financeiro]
 *     summary: Últimos 100 documentos fiscais (FT, FR, NC), com a nota de crédito que anulou cada um
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista de documentos } }
 *   post:
 *     tags: [Financeiro]
 *     summary: Emite factura (FT) ou factura-recibo (FR) de um pedido FECHADO, de uma reserva ou de um valor manual
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tipo: { type: string, enum: [FT, FR], default: FT }
 *               pedido_id: { type: string, format: uuid }
 *               reserva_id: { type: string, format: uuid }
 *               total_manual: { type: number }
 *               descricao: { type: string, description: Descrição da linha quando o valor é manual }
 *               cliente_id: { type: string, format: uuid }
 *               nif_cliente: { type: string }
 *               nome_cliente: { type: string }
 *     responses:
 *       201: { description: Documento emitido com as linhas }
 *       400: { description: Dados inválidos }
 *       404: { description: Pedido, reserva ou cliente não encontrado }
 *       409: { description: Pedido não FECHADO, já facturado, ou FR de conta por receber }
 */
router.get('/faturas', authMiddleware, h(async (req, res) => {
  res.json(await svc.listar(base(req)));
}));

router.post('/faturas', authMiddleware, h(async (req, res) => {
  const { tipo, pedido_id, reserva_id, cliente_id, total_manual, descricao, nif_cliente, nome_cliente } = req.body || {};
  if (pedido_id && !isUUID(pedido_id)) return res.status(400).json({ erro: 'pedido_id inválido' });
  if (reserva_id && !isUUID(reserva_id)) return res.status(400).json({ erro: 'reserva_id inválido' });
  if (cliente_id && !isUUID(cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  const f = await svc.emitir({ tipo, pedido_id, reserva_id, cliente_id, total_manual, descricao, nif_cliente, nome_cliente, ...base(req) });
  res.status(201).json(f);
}));

/**
 * @openapi
 * /api/financeiro/faturas/{id}:
 *   get:
 *     tags: [Financeiro]
 *     summary: Documento fiscal com as linhas
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Documento }, 404: { description: Não encontrado } }
 */
router.get('/faturas/:id', authMiddleware, h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  res.json(await svc.obter({ ...base(req), faturaId: req.params.id }));
}));

/**
 * @openapi
 * /api/financeiro/faturas/{id}/nota-credito:
 *   post:
 *     tags: [Financeiro]
 *     summary: Emite a nota de crédito (valor total) que anula uma FT/FR — só ADMIN/GERENTE
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       content: { application/json: { schema: { type: object, required: [motivo], properties: { motivo: { type: string } } } } }
 *     responses:
 *       201: { description: Nota de crédito emitida }
 *       400: { description: Motivo em falta }
 *       403: { description: Sem permissão }
 *       404: { description: Documento não encontrado }
 *       409: { description: Já anulado ou é uma nota de crédito }
 */
router.post('/faturas/:id/nota-credito', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  const nc = await svc.notaCredito({ ...base(req), faturaId: req.params.id, motivo: (req.body || {}).motivo });
  res.status(201).json(nc);
}));

// GET /api/financeiro/faturas/:id/pdf — documento em A4
router.get('/faturas/:id/pdf', authMiddleware, h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  const pdf = await require('../services/documentos.service').facturaPdf({ tenantId: req.tenantId, faturaId: req.params.id });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="factura-${req.params.id.slice(0, 8)}.pdf"`, 'Cache-Control': 'no-store' }).send(pdf);
}));

module.exports = router;
