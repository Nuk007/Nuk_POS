'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');
const { exigirModulo } = require('../middleware/modulos');
const svc = require('../services/mesas.service');

// GET /api/mesas
router.get('/', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT m.*, COUNT(p.id) FILTER (WHERE p.status IN ('ABERTO','EM_PREPARO','PRONTO')) as pedidos_ativos
       FROM mesas m
       LEFT JOIN pedidos p ON p.mesa_id = m.id
       WHERE ($1::uuid IS NULL OR m.tenant_id = $1)
       GROUP BY m.id ORDER BY m.numero`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

/**
 * @openapi
 * /api/mesas/quantidade:
 *   get:
 *     summary: Número de mesas do estabelecimento
 *     tags: [Mesas]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ quantidade }" } }
 *   put:
 *     summary: Define o número de mesas (só ADMIN, em Configurações). Cria M01… ou retira as mais altas se livres e sem histórico
 *     tags: [Mesas]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, properties: { quantidade: { type: integer }, zona: { type: string }, capacidade: { type: integer } } } } }
 *     responses: { 200: { description: "{ quantidade, criadas, removidas }" }, 400: { description: Valor inválido }, 409: { description: Mesas em uso ou com histórico } }
 */
router.get('/quantidade', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.contar({ tenantId: req.tenantId })); } catch (e) { next(e); }
});
router.put('/quantidade', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try {
    const r = await svc.definirQuantidade({ ...req.body, tenantId: req.tenantId });
    broadcast('mesa_atualizada', { quantidade: r.quantidade }, req.tenantId);
    res.json(r);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message, ...(e.mesas ? { mesas: e.mesas } : {}) });
    next(e);
  }
});

// PATCH /api/mesas/:id/status
router.patch('/:id/status', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!isUUID(id)) return res.status(400).json({ erro: 'id inválido' });
  const ESTADOS = ['LIVRE', 'OCUPADA', 'RESERVADA', 'LIMPEZA', 'MANUTENCAO'];
  const { status } = req.body;
  if (!ESTADOS.includes(status)) {
    return res.status(400).json({ erro: `status inválido. Valores: ${ESTADOS.join(', ')}` });
  }
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE mesas SET status = $1, ultima_atividade = NOW()
       WHERE id = $2 AND ($3::uuid IS NULL OR tenant_id = $3)
       RETURNING *`,
      [status, id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Mesa não encontrada' });
    broadcast('mesa_atualizada', r.rows[0], tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
