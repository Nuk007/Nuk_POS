'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');

const fin = require('../services/financeiro.service');
const chefia = requerNivel(['ADMIN', 'GERENTE']);

/**
 * @openapi
 * /api/financeiro/resumo:
 *   get:
 *     tags: [Financeiro]
 *     summary: Resumo de um dia (pedidos, categorias, estados, quartos)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: data, schema: { type: string, format: date } }]
 *     responses: { 200: { description: Resumo } }
 */
router.get('/resumo', authMiddleware, async (req, res) => {
  try { res.json(await fin.resumoDia({ tenantId: req.tenantId, data: req.query.data })); }
  catch (e) { res.status(500).json({ erro: 'Erro interno do servidor' }); }
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

/**
 * @openapi
 * /api/financeiro/resultado:
 *   get:
 *     tags: [Financeiro]
 *     summary: Resultado do período (receita cobrada, custo das vendas, despesas, lucro) e margem por produto — ADMIN/GERENTE
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: de, schema: { type: string, format: date } }
 *       - { in: query, name: ate, schema: { type: string, format: date } }
 *     responses: { 200: { description: Resultado }, 400: { description: Datas inválidas } }
 * /api/financeiro/despesas:
 *   get:
 *     tags: [Financeiro]
 *     summary: Despesas do período (ADMIN/GERENTE)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista } }
 *   post:
 *     tags: [Financeiro]
 *     summary: Regista uma despesa (pela gaveta exige caixa aberto e dinheiro suficiente) — ADMIN/GERENTE
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [categoria, descricao, valor], properties: { categoria: { type: string }, descricao: { type: string }, valor: { type: number }, data: { type: string, format: date }, pela_gaveta: { type: boolean } } } } } }
 *     responses: { 201: { description: Registada }, 409: { description: Caixa fechado ou dinheiro insuficiente } }
 * /api/financeiro/despesas/{id}/anular:
 *   post:
 *     tags: [Financeiro]
 *     summary: Anula uma despesa com motivo (se saiu da gaveta, só no caixa em curso) — ADMIN/GERENTE
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Anulada }, 409: { description: Já anulada ou caixa fechado } }
 */
router.get('/resultado', authMiddleware, chefia, h(async (req, res) => res.json(await fin.resultado({ tenantId: req.tenantId, de: req.query.de, ate: req.query.ate }))));
router.get('/despesas', authMiddleware, chefia, h(async (req, res) => res.json(await fin.listarDespesas({ tenantId: req.tenantId, de: req.query.de, ate: req.query.ate }))));
router.post('/despesas', authMiddleware, chefia, h(async (req, res) => {
  const b = req.body || {};
  res.status(201).json(await fin.criarDespesa({ categoria: b.categoria, descricao: b.descricao, valor: b.valor, data: b.data, pela_gaveta: b.pela_gaveta, ...base(req) }));
}));
router.post('/despesas/:id/anular', authMiddleware, chefia, h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  res.json(await fin.anularDespesa({ id: req.params.id, motivo: (req.body || {}).motivo, ...base(req) }));
}));

// GET /api/financeiro/faturas/:id/pdf — documento em A4
router.get('/faturas/:id/pdf', authMiddleware, h(async (req, res) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  const pdf = await require('../services/documentos.service').facturaPdf({ tenantId: req.tenantId, faturaId: req.params.id });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="factura-${req.params.id.slice(0, 8)}.pdf"`, 'Cache-Control': 'no-store' }).send(pdf);
}));

module.exports = router;
