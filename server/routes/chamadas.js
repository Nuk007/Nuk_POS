'use strict';
/** Rotas finas das chamadas ao empregado (lógica em services/chamadas.service.js). */
const express = require('express');
const router = express.Router();
const { authMiddleware, validarUUID, isUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');
const svc = require('../services/chamadas.service');

const falha = (res, next, e) => (e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e));

/**
 * @openapi
 * /api/chamadas:
 *   post:
 *     summary: Chama o empregado a uma mesa
 *     tags: [Mesas]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [mesa_id], properties: { mesa_id: { type: string, format: uuid }, motivo: { type: string } } } } } }
 *     responses: { 201: { description: Chamada registada }, 404: { description: Mesa não encontrada } }
 */
router.post('/', authMiddleware, async (req, res, next) => {
  const { mesa_id, motivo } = req.body;
  if (!mesa_id || !isUUID(mesa_id)) return res.status(400).json({ erro: 'mesa_id inválido' });
  try {
    const r = await svc.chamar({ tenantId: req.tenantId, mesa_id, motivo });
    broadcast('chamada_staff', { mesa_id, motivo: r.motivo, id: r.id }, req.tenantId);
    res.status(201).json(r);
  } catch (e) { falha(res, next, e); }
});

/**
 * @openapi
 * /api/chamadas/{id}/atender:
 *   patch:
 *     summary: Dá a chamada como atendida (grava o tempo de resposta)
 *     tags: [Mesas]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Atendida }, 404: { description: Não encontrada } }
 */
router.patch('/:id/atender', authMiddleware, validarUUID('id'), async (req, res, next) => {
  try {
    const r = await svc.atender({ tenantId: req.tenantId, userId: req.user.id, id: req.params.id });
    broadcast('chamada_atendida', r, req.tenantId);
    res.json(r);
  } catch (e) { falha(res, next, e); }
});

module.exports = router;
