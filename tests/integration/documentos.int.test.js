'use strict';
/** Integração (PostgreSQL real) — talão (80 mm) e factura (A4) em PDF. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, pedidoId, faturaId, n = 1;
const get = (T, url) => request(app).get(url).set('X-Forwarded-For', `10.7.0.${n++}`).set('Authorization', `Bearer ${T.token}`).buffer().parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-docs-a' });
  B = await criarTenantFixture({ slug: 'it-docs-b' });
  const prod = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Picanha à moda',4500,'CHURRASCO',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
  pedidoId = (await pool.query(`INSERT INTO pedidos (tenant_id, status, total, desconto, metodo_pagamento) VALUES ($1,'FECHADO',8100,900,'TPA') RETURNING id`, [A.tenantId])).rows[0].id;
  await pool.query(`INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES ($1,$2,2,4500)`, [pedidoId, prod]);
  const f = await request(app).post('/api/financeiro/faturas').set('X-Forwarded-For', '10.7.1.1').set('Authorization', `Bearer ${A.token}`).send({ pedido_id: pedidoId, nome_cliente: 'Cliente Teste', nif_cliente: '5417000000' });
  expect(f.status).toBe(201);
  faturaId = f.body.id;
}, 60000);

describe('Talão do pedido', () => {
  test('devolve um PDF válido', async () => {
    const r = await get(A, `/api/pedidos/${pedidoId}/talao.pdf`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/pdf/);
    expect(r.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(r.body.length).toBeGreaterThan(5000); // inclui o logótipo
  });
  test('não é acessível por outro estabelecimento nem sem sessão', async () => {
    expect((await get(B, `/api/pedidos/${pedidoId}/talao.pdf`)).status).toBe(404);
    expect((await request(app).get(`/api/pedidos/${pedidoId}/talao.pdf`).set('X-Forwarded-For', '10.7.2.1')).status).toBe(401);
  });
  test('id inválido → 400', async () => {
    expect((await get(A, '/api/pedidos/nao-e-uuid/talao.pdf')).status).toBe(400);
  });
});

describe('Factura A4', () => {
  test('devolve um PDF válido', async () => {
    const r = await get(A, `/api/financeiro/faturas/${faturaId}/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/pdf/);
    expect(r.body.slice(0, 5).toString()).toBe('%PDF-');
  });
  test('isolamento: outro estabelecimento não vê a factura', async () => {
    expect((await get(B, `/api/financeiro/faturas/${faturaId}/pdf`)).status).toBe(404);
  });
  test('id inválido → 400', async () => {
    expect((await get(A, '/api/financeiro/faturas/xyz/pdf')).status).toBe(400);
  });
});
