'use strict';
const express = require('express');
const { exigirModulo } = require('../middleware/modulos');
const router = express.Router();
const { authMiddleware, requerNivel, validarUUID, isUUID } = require('../middleware/auth');

const svc = require('../services/produtos.service');
const erroHttp = (res, next) => e => (e.statusCode ? res.status(e.statusCode).json({ erro: e.message }) : next(e));
// Campos aceites do corpo (o tenant vem sempre do token)
const CAMPOS = ['nome', 'descricao', 'preco', 'categoria', 'disponivel', 'ativo', 'vendido_ao_peso', 'codigo_barras'];
const corpo = b => Object.fromEntries(CAMPOS.filter(k => b && b[k] !== undefined).map(k => [k, b[k]]));

/**
 * @openapi
 * /api/produtos:
 *   get:
 *     summary: Ementa do estabelecimento (inclui vendido_ao_peso e codigo_barras)
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista de produtos } }
 *   post:
 *     summary: Cria um produto (só ADMIN, no painel de Configurações). vendido_ao_peso = preço por kg
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [nome, preco, categoria], properties: { nome: { type: string }, preco: { type: number }, categoria: { type: string }, vendido_ao_peso: { type: boolean }, codigo_barras: { type: string, nullable: true } } } } } }
 *     responses: { 201: { description: Produto criado }, 400: { description: Dados inválidos }, 409: { description: Código de barras já usado } }
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.listar({ tenantId: req.tenantId })); } catch (e) { erroHttp(res, next)(e); }
});

router.post('/', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try { res.status(201).json(await svc.criar({ ...corpo(req.body), tenantId: req.tenantId })); } catch (e) { erroHttp(res, next)(e); }
});

/**
 * @openapi
 * /api/produtos/etiquetas.pdf:
 *   get:
 *     summary: Folha A4 de etiquetas (24 por folha, 70 × 37 mm) com nome, preço e código de barras (só ADMIN). Produtos sem código recebem um EAN-13 interno
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: itens, required: true, schema: { type: string }, description: "id:copias separados por vírgulas (até 200 produtos, 100 cópias cada, 1000 etiquetas)" }]
 *     responses: { 200: { description: PDF }, 400: { description: Lista inválida }, 404: { description: Produto de outro estabelecimento } }
 */
router.get('/etiquetas.pdf', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), async (req, res, next) => {
  try {
    const pdf = await require('../services/etiquetas.service').folhaEtiquetas({ tenantId: req.tenantId, itens: req.query.itens });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="etiquetas.pdf"' }).send(pdf);
  } catch (e) { erroHttp(res, next)(e); }
});

/**
 * @openapi
 * /api/produtos/codigo/{codigo}:
 *   get:
 *     summary: Produto disponível pelo código de barras (leitor no painel de venda)
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: codigo, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Produto }, 404: { description: Nenhum produto com esse código }, 409: { description: Produto indisponível } }
 */
router.get('/codigo/:codigo', authMiddleware, async (req, res, next) => {
  try { res.json(await svc.porCodigo({ tenantId: req.tenantId, codigo: req.params.codigo })); } catch (e) { erroHttp(res, next)(e); }
});

/**
 * @openapi
 * /api/produtos/{id}:
 *   put:
 *     summary: Edita um produto (só ADMIN). codigo_barras null ou vazio tira o código
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Produto actualizado }, 404: { description: Não encontrado }, 409: { description: Código de barras já usado } }
 * /api/produtos/{id}/codigo-barras/gerar:
 *   post:
 *     summary: Gera um EAN-13 interno (começa por 2) para um produto sem código (só ADMIN)
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Produto com o código }, 409: { description: O produto já tem código } }
 */
router.put('/:id', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), validarUUID('id'), async (req, res, next) => {
  try { res.json(await svc.actualizar({ ...corpo(req.body), id: req.params.id, tenantId: req.tenantId })); } catch (e) { erroHttp(res, next)(e); }
});
router.post('/:id/codigo-barras/gerar', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), validarUUID('id'), async (req, res, next) => {
  try { res.json(await svc.gerarCodigo({ id: req.params.id, tenantId: req.tenantId })); } catch (e) { erroHttp(res, next)(e); }
});

/**
 * @openapi
 * /api/produtos/{id}/ingredientes:
 *   get:
 *     summary: Receita do produto — o que cada venda consome do stock
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: "Lista de ingredientes (stock_item_id, nome, unidade, quantidade)" }, 404: { description: Produto não encontrado } }
 *   put:
 *     summary: Define a receita do produto (lista vazia = não abate stock). ADMIN
 *     tags: [Produtos]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [ingredientes], properties: { ingredientes: { type: array, items: { type: object, properties: { stock_item_id: { type: string, format: uuid }, quantidade: { type: number } } } } } } } } }
 *     responses: { 200: { description: Receita actualizada }, 400: { description: Dados inválidos }, 404: { description: Produto ou item não encontrado } }
 */
const stockSvc = require('../services/stock.service');
const comErros = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (e) { if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message }); next(e); }
};
router.get('/:id/ingredientes', authMiddleware, (req, res, next) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  comErros(r => stockSvc.obterIngredientes({ tenantId: r.tenantId, produtoId: r.params.id }))(req, res, next);
});
router.put('/:id/ingredientes', authMiddleware, requerNivel(['ADMIN']), exigirModulo('configuracoes'), (req, res, next) => {
  if (!isUUID(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
  comErros(r => stockSvc.definirIngredientes({ tenantId: r.tenantId, produtoId: r.params.id, ingredientes: r.body.ingredientes }))(req, res, next);
});

module.exports = router;
