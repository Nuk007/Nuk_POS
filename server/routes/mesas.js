'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');
const { exigirModulo } = require('../middleware/modulos');
const svc = require('../services/mesas.service');

/**
 * @openapi
 * /api/mesas:
 *   get:
 *     summary: Mesas do estabelecimento com o número de pedidos activos
 *     tags: [Mesas]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista de mesas } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.listar({ tenantId: req.tenantId })); } catch (e) { next(e); }
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

/**
 * @openapi
 * /api/mesas/{id}/status:
 *   patch:
 *     summary: Muda o estado da mesa (LIVRE só sem conta por pagar)
 *     tags: [Mesas]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { status: { type: string, enum: [LIVRE, OCUPADA, RESERVADA, LIMPEZA, MANUTENCAO] } } } } } }
 *     responses: { 200: { description: Mesa actualizada }, 400: { description: Estado inválido }, 404: { description: Não encontrada }, 409: { description: Conta por pagar } }
 */
router.patch('/:id/status', authMiddleware, async (req, res, next) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  try {
    const r = await svc.mudarEstado({ tenantId: req.tenantId, id: req.params.id, status: req.body.status });
    broadcast('mesa_atualizada', r, req.tenantId);
    res.json(r);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) });
    next(e);
  }
});

module.exports = router;
