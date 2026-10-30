'use strict';
/**
 * Testes de integração — /api/stock
 * Cobre: GET / (lista), POST / (criação), PUT /:id/ajuste (ajuste de stock)
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server/app');

const TENANT_ID  = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const STOCK_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ADMIN_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Token de admin com tenant
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

// Mock de item de stock
function stockRow(overrides = {}) {
  return {
    id:            STOCK_ID,
    tenant_id:     TENANT_ID,
    nome:          'Frango',
    categoria:     'CARNE',
    stock_atual:   10.000,
    stock_minimo:  2.000,
    stock_ideal:   20.000,
    unidade:       'kg',
    custo_unitario:'850.0000',
    fornecedor:    'Aviário Bom Jesus',
    ativo:         true,
    alerta_stock:  false,
    criado_em:     new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    ...overrides,
  };
}

// ─── GET /api/stock ──────────────────────────────────────────────────────────

describe('GET /api/stock', () => {
  it('retorna lista de itens para utilizador autenticado', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [stockRow(), stockRow({ nome: 'Carvão', categoria: 'CARVAO' })] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const res = await request(app)
      .get('/api/stock')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/stock');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/stock ─────────────────────────────────────────────────────────

describe('POST /api/stock', () => {
  const payload = {
    nome:          'Costela de Vaca',
    categoria:     'CARNE',
    stock_atual:   5,
    stock_minimo:  1,
    stock_ideal:   15,
    unidade:       'kg',
    custo_unitario:1200,
    fornecedor:    'Talho Central',
  };

  it('cria item de stock como ADMIN', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [stockRow({ ...payload, id: STOCK_ID })] });

    const res = await request(app)
      .post('/api/stock')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.nome).toBe('Costela de Vaca');
  });

  it('cria item de stock como GERENTE', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [stockRow({ ...payload })] });

    const res = await request(app)
      .post('/api/stock')
      .set('Authorization', `Bearer ${gerenteToken}`)
      .send(payload);

    expect(res.status).toBe(201);
  });

  it('retorna 403 para OPERADOR', async () => {
    const res = await request(app)
      .post('/api/stock')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send(payload);

    expect(res.status).toBe(403);
  });

  it('retorna 400 quando faltam campos obrigatórios', async () => {
    const res = await request(app)
      .post('/api/stock')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Só nome' }); // sem categoria nem unidade

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/stock/:id/movimento ──────────────────────────────────────────

describe('POST /api/stock/:id/movimento', () => {
  it('regista movimento de COMPRA com sucesso (ADMIN)', async () => {
    // mockClient usado via pool.connect() para transacção
    // BEGIN, SELECT FOR UPDATE, UPDATE, INSERT, COMMIT, depois pool.query SELECT final
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                            // BEGIN
      .mockResolvedValueOnce({ rows: [{ stock_atual: '10.000' }] })  // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] })                            // UPDATE stock_atual
      .mockResolvedValueOnce({ rows: [{ id: 'mov-id', tipo: 'COMPRA', quantidade: 5 }] }) // INSERT mov
      .mockResolvedValueOnce({ rows: [] });                           // COMMIT
    mockPool.query.mockResolvedValueOnce({ rows: [stockRow({ stock_atual: 15.000 })] }); // SELECT final

    const res = await request(app)
      .post(`/api/stock/${STOCK_ID}/movimento`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantidade: 5, tipo: 'COMPRA', motivo: 'Reposição semanal' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('tipo', 'COMPRA');
  });

  it('retorna 400 com UUID inválido', async () => {
    const res = await request(app)
      .post('/api/stock/nao-e-uuid/movimento')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantidade: 5, tipo: 'COMPRA' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 com tipo de movimento inválido', async () => {
    const res = await request(app)
      .post(`/api/stock/${STOCK_ID}/movimento`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantidade: 5, tipo: 'TIPO_INVALIDO' });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/tipo/i);
  });

  it('retorna 409 quando o stock é insuficiente para VENDA', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ stock_atual: '1.000' }] }) // SELECT (stock=1)
      .mockResolvedValueOnce({ rows: [] });                         // ROLLBACK

    const res = await request(app)
      .post(`/api/stock/${STOCK_ID}/movimento`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantidade: 10, tipo: 'VENDA' }); // 10 > 1

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('erro');
  });
});
