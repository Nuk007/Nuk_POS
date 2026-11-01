'use strict';
/**
 * /api/cliente — portal do cliente (rotas públicas por estabelecimento) + operações de balcão (JWT).
 * Rotas finas: a lógica está em services/portal.service.js.
 * Os endpoints públicos identificam o estabelecimento por X-Tenant-Slug (ou ?slug=).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const svc = require('../services/portal.service');
const solicitacoes = require('../services/solicitacoes.service');
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const { resolverTenantPublico } = require('../saas');

const clienteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: { erro: 'Demasiadas tentativas. Tente novamente em 10 minutos.' },
});

// Executa o serviço e mapeia erros de negócio → HTTP
const h = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (e) {
    if (e.statusCode) {
      const { statusCode, message, ...extra } = e;
      const campos = Object.fromEntries(Object.entries(extra).filter(([k]) => !['name', 'stack'].includes(k)));
      return res.status(statusCode).json({ erro: message, ...campos });
    }
    next(e);
  }
};
const pub = [clienteLimiter, resolverTenantPublico];

/**
 * @openapi
 * /api/cliente/cardapio:
 *   get:
 *     tags: [Portal cliente]
 *     summary: Cardápio do estabelecimento (público)
 *     security: []
 *     parameters: [{ in: header, name: X-Tenant-Slug, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Produtos disponíveis } }
 */
router.get('/cardapio', ...pub, h(async (req, res) => res.json(await svc.cardapio({ tenantId: req.tenantId }))));
router.get('/eventos', ...pub, h(async (req, res) => res.json(await svc.eventos({ tenantId: req.tenantId }))));

/**
 * @openapi
 * /api/cliente/login:
 *   post:
 *     tags: [Portal cliente]
 *     summary: Entrar com telefone e PIN de 4 dígitos
 *     security: []
 *     responses: { 200: { description: Cliente }, 401: { description: Credenciais inválidas }, 403: { description: Cliente sem PIN (sem_pin) } }
 */
router.post('/login', ...pub, h(async (req, res) => res.json(await svc.login({ ...req.body, tenantId: req.tenantId }))));

/**
 * @openapi
 * /api/cliente/definir-pin:
 *   post:
 *     tags: [Portal cliente]
 *     summary: Definir o PIN (só se ainda não existir; para repor, um operador usa /reset-pin)
 *     security: []
 *     responses: { 200: { description: PIN definido }, 403: { description: PIN já definido } }
 */
router.post('/definir-pin', ...pub, h(async (req, res) => res.json(await svc.definirPin({ ...req.body, tenantId: req.tenantId }))));

/**
 * @openapi
 * /api/cliente/reset-pin:
 *   post:
 *     tags: [Portal cliente]
 *     summary: Operador repõe o PIN de um cliente (ADMIN/GERENTE)
 *     requestBody: { content: { application/json: { schema: { type: object, required: [cliente_id], properties: { cliente_id: { type: string, format: uuid } } } } } }
 *     responses: { 200: { description: PIN reposto }, 404: { description: Cliente não encontrado } }
 */
router.post('/reset-pin', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), h(async (req, res) => {
  if (!isUUID(req.body.cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  res.json(await svc.reporPin({ tenantId: req.tenantId, clienteId: req.body.cliente_id }));
}));

/**
 * @openapi
 * /api/cliente/cadastrar:
 *   post:
 *     tags: [Portal cliente]
 *     summary: Cadastro de cliente (nome, telefone 9XXXXXXXX e PIN de 4 dígitos)
 *     security: []
 *     responses: { 201: { description: Cliente criado }, 409: { description: Telefone já cadastrado } }
 */
router.post('/cadastrar', ...pub, h(async (req, res) => res.status(201).json(await svc.cadastrar({ ...req.body, tenantId: req.tenantId }))));

/**
 * @openapi
 * /api/cliente/pedido-restaurante:
 *   post:
 *     tags: [Portal cliente]
 *     summary: Pedido do cliente. Pagar com NUKCOIN exige cliente_id + pin; débito e pedido são atómicos
 *     security: []
 *     responses: { 201: { description: Pedido criado }, 400: { description: Dados inválidos ou saldo insuficiente }, 401: { description: PIN inválido } }
 */
router.post('/pedido-restaurante', ...pub, h(async (req, res) => {
  const { cliente_id } = req.body;
  if (cliente_id && !isUUID(cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  for (const it of Array.isArray(req.body.itens) ? req.body.itens : []) {
    if (!it || !isUUID(it.produto_id)) return res.status(400).json({ erro: 'produto_id inválido em item do pedido' });
  }
  res.status(201).json(await svc.criarPedidoRestaurante({ ...req.body, tenantId: req.tenantId }));
}));

router.post('/pedido-hospedagem', ...pub, h(async (req, res) => {
  if (req.body.cliente_id && !isUUID(req.body.cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  res.status(201).json(await svc.criarPedidoHospedagem({ ...req.body, tenantId: req.tenantId }));
}));

/**
 * @openapi
 * /api/cliente/solicitacao:
 *   post:
 *     tags: [Portal cliente]
 *     summary: Solicitação de hospedagem, serviço ou evento (chega ao POS em tempo real)
 *     security: []
 *     requestBody: { content: { application/json: { schema: { type: object, required: [tipo, nome_servico, nome, telefone], properties: { tipo: { type: string, enum: [HOSPEDAGEM, SERVICO, EVENTO] }, nome_servico: { type: string }, nome: { type: string }, telefone: { type: string }, observacoes: { type: string } } } } } }
 *     responses: { 201: { description: Solicitação registada }, 400: { description: Dados inválidos } }
 */
router.post('/solicitacao', ...pub, h(async (req, res) => {
  const { tipo, nome_servico, nome, telefone, observacoes } = req.body;
  res.status(201).json(await solicitacoes.criar({ tenantId: req.tenantId, tipo, nome_servico, nome, telefone, observacoes }));
}));

router.post('/perfil', ...pub, h(async (req, res) => res.json(await svc.perfil({ ...req.body, tenantId: req.tenantId }))));

/**
 * @openapi
 * /api/cliente/nukcoin/carregar:
 *   post:
 *     tags: [Portal cliente]
 *     summary: Carregar Nuk-Coin (feito por um operador, no balcão). Valores 5000–50000
 *     requestBody: { content: { application/json: { schema: { type: object, required: [cliente_id, valor] } } } }
 *     responses: { 200: { description: Novo saldo }, 400: { description: Valor inválido }, 404: { description: Cliente não encontrado } }
 */
router.post('/nukcoin/carregar', clienteLimiter, authMiddleware, h(async (req, res) => {
  if (!isUUID(req.body.cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  res.json(await svc.carregar({ tenantId: req.tenantId, clienteId: req.body.cliente_id, valor: req.body.valor, operadorId: req.user && req.user.id }));
}));

/**
 * @openapi
 * /api/cliente/nukcoin/historico:
 *   get:
 *     tags: [Portal cliente]
 *     summary: Últimos movimentos da carteira (cabeçalho X-Cliente-Pin obrigatório)
 *     security: []
 *     responses: { 200: { description: Movimentos }, 401: { description: PIN inválido } }
 */
router.get('/nukcoin/historico', ...pub, h(async (req, res) => {
  if (!isUUID(req.query.cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  res.json(await svc.historico({ tenantId: req.tenantId, clienteId: req.query.cliente_id, pin: req.headers['x-cliente-pin'] }));
}));

module.exports = { router, clienteLimiter };
