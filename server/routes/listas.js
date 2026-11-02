'use strict';
const express = require('express');
const { exigirModulo } = require('../middleware/modulos');
const router = express.Router();
const { authMiddleware, requerNivel, validarUUID } = require('../middleware/auth');
const svc = require('../services/listas.service');

const falha = (res, next) => e => e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e);

/**
 * @openapi
 * /api/listas:
 *   get:
 *     tags: [Listas]
 *     summary: Todas as listas de opções do estabelecimento (tipos de quarto, categorias de produto/stock, unidades)
 *     responses: { 200: { description: "{ LISTA: { nome, opcoes: [{id, valor, ordem, ativo}] } }" } }
 * /api/listas/{lista}:
 *   get:
 *     tags: [Listas]
 *     summary: Opções de uma lista (TIPO_QUARTO, CATEGORIA_PRODUTO, CATEGORIA_STOCK, UNIDADE_STOCK)
 *     responses: { 200: { description: Lista de opções }, 404: { description: Lista desconhecida } }
 *   post:
 *     tags: [Listas]
 *     summary: Acrescentar opção (ADMIN)
 *     requestBody: { content: { application/json: { schema: { type: object, required: [nome], properties: { nome: { type: string } } } } } }
 *     responses: { 201: { description: Opção criada }, 409: { description: Já existe } }
 * /api/listas/{lista}/{id}:
 *   put:
 *     tags: [Listas]
 *     summary: Activar/desactivar ou reordenar uma opção (ADMIN)
 *     responses: { 200: { description: Opção actualizada } }
 *   delete:
 *     tags: [Listas]
 *     summary: Apagar opção que não esteja em uso (ADMIN)
 *     responses: { 204: { description: Apagada }, 409: { description: Em uso } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.todas({ tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});
router.get('/:lista', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.listar({ tenantId: req.tenantId, lista: req.params.lista })); } catch (e) { falha(res, next)(e); }
});
router.post('/:lista', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try { res.status(201).json(await svc.criar({ tenantId: req.tenantId, lista: req.params.lista, nome: (req.body || {}).nome })); } catch (e) { falha(res, next)(e); }
});
router.put('/:lista/:id', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), validarUUID('id'), async (req, res, next) => {
  try { res.json(await svc.actualizar({ tenantId: req.tenantId, lista: req.params.lista, id: req.params.id, ativo: (req.body || {}).ativo, ordem: (req.body || {}).ordem })); } catch (e) { falha(res, next)(e); }
});
router.delete('/:lista/:id', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), validarUUID('id'), async (req, res, next) => {
  try { await svc.remover({ tenantId: req.tenantId, lista: req.params.lista, id: req.params.id }); res.status(204).end(); } catch (e) { falha(res, next)(e); }
});

module.exports = router;
