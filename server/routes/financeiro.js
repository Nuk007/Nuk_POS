'use strict';
const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, isUUID } = require('../middleware/auth');
const { withTx, erro } = require('../services/shared');

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

// GET /api/financeiro/faturas
router.get('/faturas', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(`
      SELECT f.*, c.nome as cliente_nome
      FROM faturas f LEFT JOIN clientes c ON f.cliente_id = c.id
      WHERE ($1::uuid IS NULL OR f.tenant_id = $1)
      ORDER BY f.emitida_em DESC LIMIT 100
    `, [tenantId || null]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// GET /api/financeiro/faturas/:id/pdf — factura em A4
router.get('/faturas/:id/pdf', authMiddleware, async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  try {
    const pdf = await require('../services/documentos.service').facturaPdf({ tenantId: req.tenantId, faturaId: req.params.id });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="factura-${req.params.id.slice(0, 8)}.pdf"`, 'Cache-Control': 'no-store' }).send(pdf);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// POST /api/financeiro/faturas
router.post('/faturas', authMiddleware, async (req, res) => {
  const { pedido_id, reserva_id, cliente_id, nif_cliente, nome_cliente } = req.body;
  const tenantId = req.tenantId;

  if (pedido_id && !isUUID(pedido_id)) return res.status(400).json({ erro: 'pedido_id inválido' });
  if (reserva_id && !isUUID(reserva_id)) return res.status(400).json({ erro: 'reserva_id inválido' });
  if (cliente_id && !isUUID(cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });

  try {
    const ano = parseInt(new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' }).slice(0, 4), 10);
    const fatura = await withTx(async db => {
      // Numeração fiscal sem buracos nem repetições: serializa a emissão por estabelecimento/ano
      await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fatura:${tenantId || 'global'}:${ano}`]);
      const seq = await db.query(
        `SELECT COALESCE(MAX(sequencial),0)+1 as prox FROM faturas WHERE serie='FT' AND ano=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`,
        [ano, tenantId || null]
      );
      const sequencial = seq.rows[0].prox;
      const numero_fatura = `FT ${ano}/${String(sequencial).padStart(6, '0')}`;

      const cfgIva = await db.query(
        `SELECT valor FROM configuracoes WHERE chave='iva_padrao' AND ($1::uuid IS NULL OR tenant_id=$1)`,
        [tenantId || null]
      );
      const taxa_iva = cfgIva.rows[0] ? parseFloat(cfgIva.rows[0].valor) || 14 : 14;

      let total = 0;
      if (pedido_id) {
        const p = await db.query(
          `SELECT total, status FROM pedidos WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`,
          [pedido_id, tenantId || null]
        );
        if (!p.rows[0]) throw erro(404, 'Pedido não encontrado');
        if (p.rows[0].status !== 'FECHADO') throw erro(409, 'Só se factura um pedido FECHADO');
        const dup = await db.query(`SELECT numero_fatura FROM faturas WHERE pedido_id=$1`, [pedido_id]);
        if (dup.rows[0]) throw erro(409, `Este pedido já foi facturado (${dup.rows[0].numero_fatura})`);
        total = parseFloat(p.rows[0].total || 0);
      } else if (reserva_id) {
        const rv = await db.query(`
          SELECT rv.valor_total FROM reservas rv
          JOIN quartos q ON rv.quarto_id = q.id
          WHERE rv.id=$1 AND ($2::uuid IS NULL OR q.tenant_id=$2)
        `, [reserva_id, tenantId || null]);
        if (!rv.rows[0]) throw erro(404, 'Reserva não encontrada');
        total = parseFloat(rv.rows[0].valor_total || 0);
      } else if (req.body.total_manual !== undefined) {
        total = parseFloat(req.body.total_manual) || 0;
        if (total <= 0) throw erro(400, 'total_manual deve ser positivo');
      } else {
        throw erro(400, 'Fornecer pedido_id, reserva_id ou total_manual');
      }

      const total_sem_iva = total / (1 + taxa_iva / 100);
      const iva = total - total_sem_iva;
      // hash determinístico — verificável a partir dos dados da factura (não é assinatura AGT)
      const hash = crypto.createHash('sha256')
        .update(`${numero_fatura}|${total.toFixed(2)}|${taxa_iva}|${tenantId || ''}`)
        .digest('hex');

      const r = await db.query(`
        INSERT INTO faturas (tenant_id, pedido_id, reserva_id, cliente_id, serie, ano, sequencial, numero_fatura,
                             nif_cliente, nome_cliente, total_sem_iva, iva, total, taxa_iva, hash_assinatura)
        VALUES ($1,$2,$3,$4,'FT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
      `, [tenantId || null, pedido_id || null, reserva_id || null, cliente_id || null, ano, sequencial, numero_fatura,
          nif_cliente || null, nome_cliente || null, total_sem_iva.toFixed(2), iva.toFixed(2), total.toFixed(2), taxa_iva, hash]);
      return r.rows[0];
    });
    res.status(201).json(fatura);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    if (e.code === '23505') return res.status(409).json({ erro: 'Factura duplicada' });
    console.error('POST /financeiro/faturas:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
