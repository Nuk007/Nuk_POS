'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const svc = require('../services/funcionarios.service');

const falha = (res, next) => e => e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e);

/**
 * @openapi
 * /api/funcionarios:
 *   get:
 *     tags: [Funcionários]
 *     summary: Lista de funcionários (ADMIN/GERENTE). Inclui titular e perfis de quartos
 *     responses: { 200: { description: Lista de funcionários } }
 *   post:
 *     tags: [Funcionários]
 *     summary: Criar funcionário (ADMIN). Só o titular cria administradores; os outros administradores só atribuem acessos dentro do seu limite (`permissoes`). Perfis opcionais pode_vender_quartos e arruma_quartos
 *     responses: { 201: { description: Criado }, 409: { description: Email já registado } }
 * /api/funcionarios/{id}:
 *   put:
 *     tags: [Funcionários]
 *     summary: Editar funcionário (ADMIN). O titular não pode ser desactivado nem despromovido (403)
 *     responses: { 200: { description: Actualizado }, 403: { description: Titular protegido }, 404: { description: Não encontrado } }
 * /api/funcionarios/transferir-titularidade:
 *   post:
 *     tags: [Funcionários]
 *     summary: O titular transfere a titularidade a outro funcionário activo (exige a sua palavra-passe)
 *     requestBody: { content: { application/json: { schema: { type: object, required: [novo_titular_id, password], properties: { novo_titular_id: { type: string, format: uuid }, password: { type: string } } } } } }
 *     responses: { 200: { description: Titularidade transferida }, 401: { description: Palavra-passe incorrecta }, 403: { description: Não é o titular } }
 */
router.get('/', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res, next) => {
  try { res.json(await svc.listar({ tenantId: req.tenantId })); } catch (e) { falha(res, next)(e); }
});

router.get('/acessos', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res, next) => {
  try { res.json(await svc.metadadosAcessos({ tenantId: req.tenantId, actorId: req.user.id })); } catch (e) { falha(res, next)(e); }
});

router.post('/transferir-titularidade', authMiddleware, requerNivel(['ADMIN']), async (req, res, next) => {
  try {
    const b = req.body || {};
    res.json(await svc.transferirTitularidade({ tenantId: req.tenantId, userId: req.user.id, novoTitularId: b.novo_titular_id, password: b.password }));
  } catch (e) { falha(res, next)(e); }
});

router.post('/', authMiddleware, requerNivel(['ADMIN']), async (req, res, next) => {
  try { res.status(201).json(await svc.criar({ ...req.body, tenantId: req.tenantId, actorId: req.user.id })); } catch (e) { falha(res, next)(e); }
});

router.put('/:id', authMiddleware, requerNivel(['ADMIN']), async (req, res, next) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  try { res.json(await svc.actualizar({ ...req.body, tenantId: req.tenantId, actorId: req.user.id, id: req.params.id })); } catch (e) { falha(res, next)(e); }
});

module.exports = router;
