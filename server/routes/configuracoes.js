'use strict';
const express = require('express');
const { exigirModulo } = require('../middleware/modulos');
const router = express.Router();
const { authMiddleware, requerNivel } = require('../middleware/auth');

const svc = require('../services/configuracoes.service');

/**
 * @openapi
 * /api/configuracoes:
 *   get:
 *     summary: "Chaves de configuração do estabelecimento ({ chave: valor })"
 *     tags: [Configurações]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Objecto chave → valor } }
 *   put:
 *     summary: Grava várias chaves de uma vez (só ADMIN; só as chaves permitidas; morada, NIF e telefone validados)
 *     tags: [Configurações]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ ok: true }" }, 400: { description: Chave não permitida ou valor inválido } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.ler({ tenantId: req.tenantId })); } catch (e) { next(e); }
});

router.put('/', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try { res.json(await svc.guardar({ valores: req.body, tenantId: req.tenantId })); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
});

/**
 * @openapi
 * /api/configuracoes/balcao:
 *   put:
 *     summary: Define as categorias de produto que o Balcão vende (só ADMIN; regra do dono de 20/11/2026)
 *     tags: [Configurações]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [categorias], properties: { categorias: { type: array, items: { type: string } } } } } } }
 *     responses: { 200: { description: "{ categorias }" }, 400: { description: "Lista vazia ou categoria inexistente" } }
 */
router.put('/balcao', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try { res.json(await require('../services/balcao.service').definir({ categorias: req.body.categorias, tenantId: req.tenantId })); }
  catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
});

/**
 * @openapi
 * /api/configuracoes/fluxos/{fluxo}:
 *   put:
 *     summary: Define as categorias de produto que um fluxo de venda vende (BALCAO, TAKEAWAY, LAZER, LOJA; só ADMIN). categorias null repõe o padrão
 *     tags: [Configurações]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: fluxo, required: true, schema: { type: string, enum: [BALCAO, TAKEAWAY, LAZER, LOJA] } }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [categorias], properties: { categorias: { type: array, nullable: true, items: { type: string } } } } } } }
 *     responses: { 200: { description: "{ fluxo, nome, categorias, configurado }" }, 400: { description: "Fluxo inválido, lista vazia ou categoria inexistente" } }
 */
router.put('/fluxos/:fluxo', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try {
    const categorias = req.body.categorias === null ? null : req.body.categorias;
    res.json(await require('../services/fluxos-venda.service').definir({ fluxo: req.params.fluxo, categorias, tenantId: req.tenantId }));
  } catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
});

module.exports = router;
