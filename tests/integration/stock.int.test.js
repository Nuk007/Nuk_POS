'use strict';
/**
 * Integração — stock.service contra PostgreSQL real.
 * Verifica o que os mocks não conseguem: transacção + FOR UPDATE,
 * ROLLBACK efectivo, constraints CHECK e isolamento multi-tenant.
 */
const request = require('supertest');
const { app } = require('../../server/app');
const svc = require('../../server/services/stock.service');

let A, B; // dois tenants para testar isolamento

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-stock-a' });
  B = await criarTenantFixture({ slug: 'it-stock-b' });
});

beforeEach(async () => { await limparOperacionais(); });

async function novoItem(tenantId, over = {}) {
  return svc.criarItemStock({
    tenantId, nome: 'Carvão 5kg', categoria: 'CARVAO', unidade: 'kg',
    stock_atual: 10, stock_minimo: 2, stock_ideal: 20, custo_unitario: 1500, ...over,
  });
}

describe('stock.service — movimentos (transacção real)', () => {
  test('COMPRA incrementa e regista quantidade_antes', async () => {
    const item = await novoItem(A.tenantId);
    await svc.registarMovimento({ tenantId: A.tenantId, userId: A.userId, itemId: item.id, tipo: 'COMPRA', quantidade: 5 });

    const r = await pool.query(`SELECT stock_atual FROM stock_items WHERE id=$1`, [item.id]);
    expect(Number(r.rows[0].stock_atual)).toBe(15);

    const m = await pool.query(`SELECT tipo, quantidade, quantidade_antes FROM movimentos_stock WHERE stock_item_id=$1`, [item.id]);
    expect(m.rows).toHaveLength(1);
    expect(Number(m.rows[0].quantidade_antes)).toBe(10);
  });

  test('VENDA acima do disponível → 409 e NADA é persistido (rollback)', async () => {
    const item = await novoItem(A.tenantId, { stock_atual: 3 });

    await expect(
      svc.registarMovimento({ tenantId: A.tenantId, userId: A.userId, itemId: item.id, tipo: 'VENDA', quantidade: 10 })
    ).rejects.toMatchObject({ statusCode: 409, disponivel: 3 });

    const r = await pool.query(`SELECT stock_atual FROM stock_items WHERE id=$1`, [item.id]);
    expect(Number(r.rows[0].stock_atual)).toBe(3);
    const m = await pool.query(`SELECT COUNT(*)::int AS n FROM movimentos_stock WHERE stock_item_id=$1`, [item.id]);
    expect(m.rows[0].n).toBe(0);
  });

  test('tipo inválido rejeitado pelo serviço antes de tocar na DB', async () => {
    const item = await novoItem(A.tenantId);
    await expect(
      svc.registarMovimento({ tenantId: A.tenantId, userId: A.userId, itemId: item.id, tipo: 'ROUBO', quantidade: 1 })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('movimentos concorrentes com FOR UPDATE não perdem actualizações', async () => {
    const item = await novoItem(A.tenantId, { stock_atual: 0 });
    // 10 compras de 1 em paralelo (metade do pool, max=20) — sem FOR UPDATE o resultado seria < 10
    await Promise.all(Array.from({ length: 10 }, () =>
      svc.registarMovimento({ tenantId: A.tenantId, userId: A.userId, itemId: item.id, tipo: 'COMPRA', quantidade: 1 })
    ));
    const r = await pool.query(`SELECT stock_atual FROM stock_items WHERE id=$1`, [item.id]);
    expect(Number(r.rows[0].stock_atual)).toBe(10);
    const m = await pool.query(`SELECT COUNT(*)::int AS n FROM movimentos_stock WHERE stock_item_id=$1`, [item.id]);
    expect(m.rows[0].n).toBe(10);
  });
});

describe('stock.service — isolamento multi-tenant', () => {
  test('tenant B não vê nem movimenta itens do tenant A', async () => {
    const item = await novoItem(A.tenantId);

    const listaB = await svc.listarStock({ tenantId: B.tenantId, page: 1, limit: 50 });
    expect(listaB.total).toBe(0);

    await expect(
      svc.registarMovimento({ tenantId: B.tenantId, userId: B.userId, itemId: item.id, tipo: 'COMPRA', quantidade: 1 })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('constraint CHECK da categoria é aplicada pela DB', async () => {
    await expect(novoItem(A.tenantId, { categoria: 'INEXISTENTE' })).rejects.toMatchObject({ code: '23514' });
  });
});

describe('HTTP /api/stock — fluxo completo com JWT real', () => {
  test('POST item → POST movimento → GET lista reflecte o stock', async () => {
    const auth = { Authorization: `Bearer ${A.token}` };

    const c = await request(app).post('/api/stock').set(auth)
      .send({ nome: 'Cerveja Cuca', categoria: 'BEBIDA', unidade: 'un', stock_atual: 24, stock_minimo: 6 });
    expect(c.status).toBe(201);

    const mv = await request(app).post(`/api/stock/${c.body.id}/movimento`).set(auth)
      .send({ tipo: 'VENDA', quantidade: 4 });
    expect(mv.status).toBe(201);

    const g = await request(app).get('/api/stock').set(auth);
    expect(g.status).toBe(200);
    expect(g.body.total).toBe(1);
    expect(Number(g.body.data[0].stock_atual)).toBe(20);
  });

  test('sem token → 401; token de outro tenant → lista vazia', async () => {
    await novoItem(A.tenantId);
    expect((await request(app).get('/api/stock')).status).toBe(401);
    const g = await request(app).get('/api/stock').set('Authorization', `Bearer ${B.token}`);
    expect(g.body.total).toBe(0);
  });
});
