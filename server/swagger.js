'use strict';
/**
 * Configuração OpenAPI 3.0 — gerada a partir das anotações @openapi nos ficheiros de rotas.
 * UI disponível em /api/docs; especificação JSON em /api/docs.json
 */
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Nuk_POS API',
      version: '1.0.0',
      description:
        'API do sistema de ponto de venda multi-tenant Nuk_POS (restaurantes, bares e hotelaria).\n\n' +
        'Todas as rotas autenticadas requerem o cabeçalho `Authorization: Bearer <token>`; ' +
        'o `tenant_id` é extraído do JWT e aplicado automaticamente a todas as operações.',
      contact: { name: 'Nuk_POS', email: 'suporte@nukpos.ao' },
    },
    servers: [
      { url: '/', description: 'Servidor actual' },
    ],
    tags: [
      { name: 'Auth',    description: 'Autenticação e perfil do utilizador' },
      { name: 'Pedidos', description: 'Pedidos de mesa / balcão e respectivos itens' },
      { name: 'Stock',   description: 'Inventário e movimentos de stock' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Erro: {
          type: 'object',
          properties: { erro: { type: 'string', example: 'Descrição do erro' } },
        },
        Funcionario: {
          type: 'object',
          properties: {
            id:           { type: 'string', format: 'uuid' },
            tenant_id:    { type: 'string', format: 'uuid' },
            nome:         { type: 'string', example: 'Ana Silva' },
            email:        { type: 'string', format: 'email' },
            nivel_acesso: { type: 'string', enum: ['ADMIN', 'GERENTE', 'CAIXA', 'GARCOM', 'COZINHA', 'RECEPCAO'] },
            ativo:        { type: 'boolean' },
            criado_em:    { type: 'string', format: 'date-time' },
          },
        },
        ItemPedido: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            produto_id:     { type: 'string', format: 'uuid' },
            produto_nome:   { type: 'string' },
            quantidade:     { type: 'integer', minimum: 1 },
            preco_unitario: { type: 'number', format: 'float' },
            observacoes:    { type: 'string', nullable: true },
            status:         { type: 'string', enum: ['PENDENTE', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO'] },
          },
        },
        Pedido: {
          type: 'object',
          properties: {
            id:          { type: 'string', format: 'uuid' },
            tenant_id:   { type: 'string', format: 'uuid' },
            numero:      { type: 'integer', example: 42 },
            mesa_id:     { type: 'string', format: 'uuid', nullable: true },
            mesa_numero: { type: 'integer', nullable: true },
            tipo:        { type: 'string', enum: ['MESA', 'BALCAO', 'DELIVERY', 'QUARTO'] },
            status:      { type: 'string', enum: ['ABERTO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'FECHADO', 'CANCELADO'] },
            total:       { type: 'number', format: 'float' },
            observacoes: { type: 'string', nullable: true },
            itens:       { type: 'array', items: { $ref: '#/components/schemas/ItemPedido' } },
            criado_em:   { type: 'string', format: 'date-time' },
          },
        },
        StockItem: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            tenant_id:      { type: 'string', format: 'uuid' },
            nome:           { type: 'string', example: 'Cerveja Cuca 33cl' },
            categoria:      { type: 'string', example: 'Bebidas' },
            stock_atual:    { type: 'number', format: 'float' },
            stock_minimo:   { type: 'number', format: 'float' },
            stock_ideal:    { type: 'number', format: 'float' },
            unidade:        { type: 'string', example: 'un' },
            custo_unitario: { type: 'number', format: 'float' },
            fornecedor:     { type: 'string', nullable: true },
            ativo:          { type: 'boolean' },
          },
        },
      },
      responses: {
        BadRequest:   { description: 'Pedido inválido', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
        Unauthorized: { description: 'Token ausente ou inválido', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
        Forbidden:    { description: 'Sem permissão para esta operação', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
        NotFound:     { description: 'Recurso não encontrado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
        TooManyRequests: { description: 'Limite de pedidos excedido', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
      },
    },
  },
  apis: [path.join(__dirname, 'routes', '*.js')],
};

module.exports = swaggerJsdoc(options);
