'use strict';
/**
 * /api/caixa — Caixa do dia (rotas finas; lógica em services/caixa.service.js).
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const svc = require('../services/caixa.service');
const cc = require('../services/conta-corrente.service');

const h = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message, ...(e.codigo ? { codigo: e.codigo } : {}), ...(e.disponivel !== undefined ? { disponivel: e.disponivel } : {}), ...(e.divida !== undefined ? { divida: e.divida } : {}), ...(e.saldo_atual !== undefined ? { saldo_atual: e.saldo_atual, total_necessario: e.total_necessario } : {}) });
    next(e);
  }
};
const base = req => ({ tenantId: req.tenantId, userId: req.user && req.user.id });

/**
 * @openapi
 * /api/caixa:
 *   get:
 *     summary: Estado do caixa do dia (sessão aberta, resumo por forma de pagamento e últimos movimentos)
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ aberta, sessao, resumo, movimentos }" } }
 */
router.get('/', authMiddleware, h(async (req, res) => res.json(await svc.estado(base(req)))));

/**
 * @openapi
 * /api/caixa/abrir:
 *   post:
 *     summary: Abre o caixa do dia com um fundo inicial
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { fundo_inicial: { type: number } } } } } }
 *     responses: { 201: { description: Sessão aberta }, 409: { description: Já está aberto } }
 */
router.post('/abrir', authMiddleware, h(async (req, res) => res.status(201).json(await svc.abrir({ fundo_inicial: req.body.fundo_inicial, ...base(req) }))));

/**
 * @openapi
 * /api/caixa/fechar:
 *   post:
 *     summary: Fecha o caixa com a contagem do dinheiro (calcula a diferença para o esperado)
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [contado] } } } }
 *     responses: { 200: { description: Sessão fechada com esperado, contado e diferença }, 409: { description: Já está fechado } }
 */
router.post('/fechar', authMiddleware, h(async (req, res) => res.json(await svc.fechar({ contado: req.body.contado, observacoes: req.body.observacoes, ...base(req) }))));

/**
 * @openapi
 * /api/caixa/sessoes:
 *   get:
 *     summary: Histórico dos últimos 30 caixas
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista } }
 */
router.get('/sessoes', authMiddleware, h(async (req, res) => res.json(await svc.sessoes(base(req)))));

/**
 * @openapi
 * /api/caixa/nukcoin:
 *   post:
 *     summary: Carrega Nuk-Coin a um cliente cadastrado (exige o caixa aberto; regista a forma de pagamento)
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [cliente_id, valor] } } } }
 *     responses: { 200: { description: Novo saldo }, 409: { description: Caixa fechado } }
 */
router.post('/nukcoin', authMiddleware, h(async (req, res) => {
  if (!isUUID(req.body.cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  res.json(await svc.carregarNukcoin({ clienteId: req.body.cliente_id, valor: req.body.valor, metodo: req.body.metodo, ...base(req) }));
}));

/**
 * @openapi
 * /api/caixa/cartoes:
 *   get:
 *     summary: Últimos cartões de consumo vendidos
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista } }
 *   post:
 *     summary: Vende um cartão de consumo pré-pago (exige o caixa aberto)
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [valor] } } } }
 *     responses: { 201: { description: Cartão com código e saldo }, 409: { description: Caixa fechado } }
 */
router.get('/cartoes', authMiddleware, h(async (req, res) => res.json(await svc.listarCartoes(base(req)))));
router.post('/cartoes', authMiddleware, h(async (req, res) => res.status(201).json(await svc.venderCartao({ valor: req.body.valor, metodo: req.body.metodo, ...base(req) }))));

/**
 * @openapi
 * /api/caixa/cartoes/{codigo}:
 *   get:
 *     summary: Consulta o saldo de um cartão de consumo pelo código
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: codigo, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Cartão }, 404: { description: Não encontrado } }
 */
router.get('/cartoes/:codigo', authMiddleware, h(async (req, res) => res.json(await svc.consultarCartao({ codigo: req.params.codigo, ...base(req) }))));

/**
 * @openapi
 * /api/caixa/por-receber:
 *   get:
 *     summary: Pedidos já fechados (mesa, balcão, take away, remota) ainda por receber
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista, mais antigos primeiro } }
 */
router.get('/por-receber', authMiddleware, h(async (req, res) => res.json(await svc.porReceber(base(req)))));

/**
 * @openapi
 * /api/caixa/receber:
 *   post:
 *     summary: Recebe o pagamento de um ou mais pedidos fechados, com uma forma ou várias (pagamento misto)
 *     description: "Uma forma: `metodo` (+ pin/cliente_id, codigo_cartao ou valor_entregue). Várias: `pagamentos` = [{ metodo, valor, pin?, cliente_id?, codigo_cartao?, valor_entregue? }], até 4, soma igual ao total, Dinheiro/Nuk-Coin/Cartão no máximo uma vez cada."
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [pedido_ids] } } } }
 *     responses: { 200: { description: "{ total, metodo (MISTO se várias), pagamentos, pedidos, troco, saldo_restante }" }, 400: { description: Dados ou saldo inválidos }, 403: { description: PIN inválido }, 409: { description: Caixa fechado ou pedido já recebido } }
 */
router.post('/receber', authMiddleware, h(async (req, res) => {
  const ids = Array.isArray(req.body.pedido_ids) ? req.body.pedido_ids : [];
  if (ids.some(i => !isUUID(i))) return res.status(400).json({ erro: 'pedido_ids inválidos' });
  if (req.body.cliente_id && !isUUID(req.body.cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  const { metodo, pin, cliente_id, codigo_cartao, valor_entregue, pagamentos } = req.body;
  if (Array.isArray(pagamentos) && pagamentos.some(x => x && x.cliente_id && !isUUID(x.cliente_id))) return res.status(400).json({ erro: 'cliente_id inválido' });
  res.json(await svc.receber({ pedido_ids: ids, metodo, pin, cliente_id, codigo_cartao, valor_entregue, pagamentos, ...base(req) }));
}));

/**
 * @openapi
 * /api/caixa/dividir:
 *   post:
 *     summary: Separa itens (ou parte das quantidades) de uma conta fechada por receber numa conta nova
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [pedido_id, itens], properties: { pedido_id: { type: string, format: uuid }, itens: { type: array, items: { type: object, properties: { item_id: { type: string, format: uuid }, quantidade: { type: number } } } } } } } } }
 *     responses: { 200: { description: "{ original, nova } com os totais" }, 409: { description: Conta paga, facturada, com desconto ou Nuk-Coin } }
 */
router.post('/dividir', authMiddleware, h(async (req, res) => {
  const { pedido_id, itens } = req.body || {};
  if (!isUUID(pedido_id)) return res.status(400).json({ erro: 'pedido_id inválido' });
  if (Array.isArray(itens) && itens.some(x => !x || !isUUID(x.item_id))) return res.status(400).json({ erro: 'item_id inválido' });
  res.json(await svc.dividirConta({ pedido_id, itens, ...base(req) }));
}));

/**
 * @openapi
 * /api/caixa/conta-corrente:
 *   get:
 *     summary: Clientes com conta corrente autorizada ou em dívida (saldo, limite, disponível)
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Lista } }
 * /api/caixa/conta-corrente/{clienteId}:
 *   get:
 *     summary: Extracto da conta corrente (até 200 movimentos, com saldo acumulado)
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: clienteId, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: "{ cliente, movimentos }" }, 404: { description: Cliente não encontrado } }
 *   put:
 *     summary: Autorizar/retirar conta corrente e fixar o limite de crédito (só ADMIN; ecrã em Configurações)
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { ativa: { type: boolean }, limite: { type: number } } } } } }
 *     responses: { 200: { description: Cliente actualizado }, 403: { description: Só ADMIN } }
 * /api/caixa/conta-corrente/{clienteId}/pagamentos:
 *   post:
 *     summary: Liquidação (total ou parcial) da dívida; entra no caixa do dia como CONTA_PAGAMENTO
 *     tags: [Caixa]
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [valor, metodo], properties: { valor: { type: number }, metodo: { type: string, enum: [CASH, TPA, TRANSFERENCIA, EXPRESS] }, observacoes: { type: string } } } } } }
 *     responses: { 201: { description: "{ pago, metodo, saldo }" }, 409: { description: Caixa fechado, sem dívida ou valor acima da dívida } }
 */
router.get('/conta-corrente', authMiddleware, h(async (req, res) => res.json(await cc.listar(base(req)))));
router.get('/conta-corrente/:clienteId', authMiddleware, h(async (req, res) => {
  if (!isUUID(req.params.clienteId)) return res.status(400).json({ erro: 'clienteId inválido' });
  res.json(await cc.extracto({ clienteId: req.params.clienteId, ...base(req) }));
}));
router.put('/conta-corrente/:clienteId', authMiddleware, requerNivel(['ADMIN']), h(async (req, res) => {
  if (!isUUID(req.params.clienteId)) return res.status(400).json({ erro: 'clienteId inválido' });
  res.json(await cc.configurar({ ativa: req.body.ativa, limite: req.body.limite, clienteId: req.params.clienteId, ...base(req) }));
}));
router.post('/conta-corrente/:clienteId/pagamentos', authMiddleware, h(async (req, res) => {
  if (!isUUID(req.params.clienteId)) return res.status(400).json({ erro: 'clienteId inválido' });
  res.status(201).json(await cc.pagar({ valor: req.body.valor, metodo: req.body.metodo, observacoes: req.body.observacoes, clienteId: req.params.clienteId, ...base(req) }));
}));

module.exports = router;
