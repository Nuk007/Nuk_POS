'use strict';
/**
 * Testes de integração — /api/pedidos
 * Cobre: GET / (lista), POST / (criação com itens), PATCH /:id/status
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server/app');

const TENANT_ID  = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const PEDIDO_ID  = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MESA_ID    = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
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
const operadorToken = makeToken('OPERADOR');

function pedidoRow(overrides = {}) {
  return {
    id:               PEDIDO_ID,
    tenant_id:        TENANT_ID,
    mesa_id:          MESA_ID,
    mesa_numero:      'M01',
    funcionario_id:   ADMIN_ID,
    status:           'ABERTO',
    total:            '3200.00',
    desconto:         '0.00',
    observacoes:      null,
    itens:            [{ produto_nome: 'Frango no Churrasco', quantidade: 1, preco_unitario: '3200.00', status_cozinha: 'AGUARDANDO' }],
    criado_em:        new Date().toISOString(),
    atualizado_em:    new Date().toISOString(),
    ...overrides,
  };
}

// ─── GET /api/pedidos ────────────────────────────────────────────────────────

describe('GET /api/pedidos', () => {
  it('retorna lista paginada de pedidos', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [pedidoRow(), pedidoRow({ id: 'outro-id' })] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const res = await request(app)
      .get('/api/pedidos')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('retorna 401 sem autenticação', async () => {
    const res = await request(app).get('/api/pedidos');
    expect(res.status).toBe(401);
  });

  it('filtra por status na query string', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [pedidoRow({ status: 'EM_PREPARO' })] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .get('/api/pedidos?status=EM_PREPARO')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('EM_PREPARO');
  });
});

// ─── POST /api/pedidos ───────────────────────────────────────────────────────

describe('POST /api/pedidos', () => {
  const payload = {
    mesa_id: MESA_ID,
    itens: [{ produto_id: PRODUTO_ID, quantidade: 1 }],
  };

  it('cria pedido com sucesso', async () => {
    // Transacção: BEGIN, SELECT produto, INSERT pedido, INSERT item, UPDATE mesa, COMMIT
    // Depois pool.query para SELECT pedido completo
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ preco: '3200.00' }] })     // SELECT produto
      .mockResolvedValueOnce({ rows: [{ id: PEDIDO_ID, total: '3200.00', status: 'ABERTO' }] }) // INSERT pedido
      .mockResolvedValueOnce({ rows: [] })                          // INSERT item
      .mockResolvedValueOnce({ rows: [] })                          // UPDATE mesa
      .mockResolvedValueOnce({ rows: [] });                         // COMMIT
    mockPool.query.mockResolvedValueOnce({ rows: [pedidoRow()] });  // SELECT completo final

    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', PEDIDO_ID);
    expect(res.body).toHaveProperty('status', 'ABERTO');
  });

  it('retorna 400 quando pedido não tem itens', async () => {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mesa_id: MESA_ID, itens: [] });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/sem itens/i);
  });

  it('retorna 400 quando produto não existe ou não está disponível', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })   // BEGIN
      .mockResolvedValueOnce({ rows: [] })   // SELECT produto — não encontrado
      .mockResolvedValueOnce({ rows: [] });  // ROLLBACK

    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mesa_id: MESA_ID, itens: [{ produto_id: PRODUTO_ID, quantidade: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/produto/i);
  });

  it('também cria pedido como OPERADOR', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ preco: '800.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: PEDIDO_ID, total: '800.00', status: 'ABERTO' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [pedidoRow({ total: '800.00' })] });

    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send(payload);

    expect(res.status).toBe(201);
  });
});

// ─── PATCH /api/pedidos/:id/status ──────────────────────────────────────────

describe('PATCH /api/pedidos/:id/status', () => {
  it('actualiza status do pedido para EM_PREPARO', async () => {
    // transacção: BEGIN, SELECT … FOR UPDATE, UPDATE
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pedidoRow({ status: 'ABERTO', nukcoin_pago: '0' })] })
      .mockResolvedValueOnce({ rows: [pedidoRow({ status: 'EM_PREPARO' })] });

    const res = await request(app)
      .patch(`/api/pedidos/${PEDIDO_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'EM_PREPARO' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EM_PREPARO');
  });

  it('retorna 409 ao reabrir um pedido FECHADO', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pedidoRow({ status: 'FECHADO' })] });
    const res = await request(app).patch(`/api/pedidos/${PEDIDO_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'ABERTO' });
    expect(res.status).toBe(409);
  });

  it('cancelar um pedido pago com Nuk-Coin estorna o valor ao cliente', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                                        // BEGIN
      .mockResolvedValueOnce({ rows: [pedidoRow({ status: 'ABERTO', cliente_id: 'c1', nukcoin_pago: '1080.00', mesa_id: null })] })
      .mockResolvedValueOnce({ rows: [pedidoRow({ status: 'CANCELADO', cliente_id: 'c1', mesa_id: null })] }) // UPDATE status
      .mockResolvedValueOnce({ rows: [{ nukcoin_saldo: '1000.00' }] })                            // saldo (FOR UPDATE)
      .mockResolvedValueOnce({ rows: [] })                                                        // UPDATE saldo
      .mockResolvedValueOnce({ rows: [] })                                                        // INSERT ESTORNO
      .mockResolvedValueOnce({ rows: [] })                                                        // nukcoin_pago = 0
      .mockResolvedValueOnce({ rows: [] })                                                        // stock: já estornado?
      .mockResolvedValueOnce({ rows: [] });                                                       // stock: nada vendido a devolver
    const res = await request(app).patch(`/api/pedidos/${PEDIDO_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'CANCELADO' });
    expect(res.status).toBe(200);
    const sqls = mockClient.query.mock.calls.map(c => String(c[0]));
    expect(sqls.some(q => /UPDATE clientes SET nukcoin_saldo/.test(q))).toBe(true);
    const estorno = mockClient.query.mock.calls.find(c => /ESTORNO/.test(String(c[0])));
    expect(estorno[1][1]).toBe(1080);                          // valor estornado
    expect(estorno[1][3]).toBe(2080);                          // saldo depois = 1000 + 1080
  });

  it('retorna 400 com UUID inválido', async () => {
    const res = await request(app)
      .patch('/api/pedidos/uuid-invalido/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'EM_PREPARO' });

    expect(res.status).toBe(400);
  });
});
