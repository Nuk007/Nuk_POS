'use strict';
/**
 * Testes de integração — /api/produtos
 * Cobre: GET / (lista), POST / (criação), PUT /:id (actualização)
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server/app');

const TENANT_ID  = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const PRODUTO_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ADMIN_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeToken(nivel = 'ADMIN') {
  return jwt.sign(
    { id: ADMIN_ID, email: 'admin@nukpos.ao', nivel_acesso: nivel, tenantId: TENANT_ID },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const adminToken    = makeToken('ADMIN');
const gerenteToken  = makeToken('GERENTE');
const operadorToken = makeToken('OPERADOR');

function produtoRow(overrides = {}) {
  return {
    id:           PRODUTO_ID,
    tenant_id:    TENANT_ID,
    nome:         'Frango no Churrasco',
    descricao:    'Frango inteiro grelhado',
    preco:        '3200.00',
    categoria:    'GRELHADOS',
    disponivel:   true,
    ativo:        true,
    criado_em:    new Date().toISOString(),
    atualizado_em:new Date().toISOString(),
    ...overrides,
  };
}

// ─── GET /api/produtos ───────────────────────────────────────────────────────

describe('GET /api/produtos', () => {
  it('retorna lista de produtos autenticado', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [produtoRow(), produtoRow({ nome: 'Costela' })] });

    const res = await request(app)
      .get('/api/produtos')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/produtos');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/produtos ──────────────────────────────────────────────────────

describe('POST /api/produtos', () => {
  const payload = {
    nome:      'Costeleta de Porco',
    preco:     2500,
    categoria: 'GRELHADOS',
  };

  it('cria produto como ADMIN', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [produtoRow({ ...payload })] });

    const res = await request(app)
      .post('/api/produtos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('cria produto como GERENTE', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [produtoRow()] });

    const res = await request(app)
      .post('/api/produtos')
      .set('Authorization', `Bearer ${gerenteToken}`)
      .send(payload);

    expect(res.status).toBe(201);
  });

  it('retorna 403 para OPERADOR', async () => {
    const res = await request(app)
      .post('/api/produtos')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send(payload);

    expect(res.status).toBe(403);
  });

  it('retorna 400 quando falta nome', async () => {
    const res = await request(app)
      .post('/api/produtos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ preco: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/nome/i);
  });

  it('retorna 400 com preco inválido', async () => {
    const res = await request(app)
      .post('/api/produtos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Teste', preco: -50 });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/preco/i);
  });
});

// ─── PUT /api/produtos/:id ───────────────────────────────────────────────────

describe('PUT /api/produtos/:id', () => {
  it('actualiza produto existente', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [produtoRow({ preco: '3500.00' })] });

    const res = await request(app)
      .put(`/api/produtos/${PRODUTO_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ preco: 3500 });

    expect(res.status).toBe(200);
    expect(res.body.preco).toBe('3500.00');
  });

  it('retorna 404 quando produto não existe', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/produtos/${PRODUTO_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Novo nome' });

    expect(res.status).toBe(404);
  });

  it('retorna 400 com UUID inválido', async () => {
    const res = await request(app)
      .put('/api/produtos/nao-e-uuid')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(400);
  });
});
