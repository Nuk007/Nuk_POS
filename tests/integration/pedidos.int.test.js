'use strict';
/**
 * Integração — pedidos.service contra PostgreSQL real.
 * Cobre: transacção de criação (atomicidade), cálculo de total na DB,
 * ocupação/libertação de mesa, filtros dinâmicos (buildWhere) e isolamento.
 */
const request = require('supertest');
const { app } = require('../../server/app');
const svc = require('../../server/services/pedidos.service');

let A, B;

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-ped-a' });
  B = await criarTenantFixture({ slug: 'it-ped-b' });
});

beforeEach(async () => { await limparOperacionais(); });

async function fixtures(tenantId) {
  const mesa = (await pool.query(
    `INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1, 'M1', 4) RETURNING id`, [tenantId]
  )).rows[0];
  const prod = (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, categoria, preco) VALUES ($1, 'Picanha', 'CHURRASCO', 2500) RETURNING id`, [tenantId]
  )).rows[0];
  const bebida = (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, categoria, preco) VALUES ($1, 'Cuca', 'BEBIDA', 500) RETURNING id`, [tenantId]
  )).rows[0];
  const indisponivel = (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, categoria, preco, disponivel) VALUES ($1, 'Esgotado', 'PEIXE', 100, false) RETURNING id`, [tenantId]
  )).rows[0];
  return { mesaId: mesa.id, prodId: prod.id, bebidaId: bebida.id, indisponivelId: indisponivel.id };
}

describe('pedidos.service — criarPedido (transacção)', () => {
  test('calcula total, insere itens e ocupa a mesa', async () => {
    const f = await fixtures(A.tenantId);
    const p = await svc.criarPedido({
      tenantId: A.tenantId, userId: A.userId, mesa_id: f.mesaId,
      itens: [{ produto_id: f.prodId, quantidade: 2 }, { produto_id: f.bebidaId, quantidade: 3 }],
    });

    expect(Number(p.total)).toBe(2 * 2500 + 3 * 500);
    expect(p.itens).toHaveLength(2);
    expect(p.mesa_numero).toBe('M1');

    const mesa = await pool.query(`SELECT status FROM mesas WHERE id=$1`, [f.mesaId]);
    expect(mesa.rows[0].status).toBe('OCUPADA');
  });

  test('produto indisponível a meio → ROLLBACK total: sem pedido, sem itens, mesa LIVRE', async () => {
    const f = await fixtures(A.tenantId);
    await expect(svc.criarPedido({
      tenantId: A.tenantId, userId: A.userId, mesa_id: f.mesaId,
      itens: [{ produto_id: f.prodId, quantidade: 1 }, { produto_id: f.indisponivelId, quantidade: 1 }],
    })).rejects.toMatchObject({ statusCode: 400 });

    const n = await pool.query(`SELECT (SELECT COUNT(*) FROM pedidos)::int AS p, (SELECT COUNT(*) FROM itens_pedido)::int AS i`);
    expect(n.rows[0]).toEqual({ p: 0, i: 0 });
    const mesa = await pool.query(`SELECT status FROM mesas WHERE id=$1`, [f.mesaId]);
    expect(mesa.rows[0].status).toBe('LIVRE');
  });

  test('produto de OUTRO tenant é tratado como indisponível', async () => {
    const fA = await fixtures(A.tenantId);
    await expect(svc.criarPedido({
      tenantId: B.tenantId, userId: B.userId,
      itens: [{ produto_id: fA.prodId, quantidade: 1 }],
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('pedidos.service — ciclo de vida e mesa', () => {
  test('FECHADO liberta a mesa só quando não há outros pedidos abertos', async () => {
    const f = await fixtures(A.tenantId);
    const p1 = await svc.criarPedido({ tenantId: A.tenantId, userId: A.userId, mesa_id: f.mesaId, itens: [{ produto_id: f.prodId, quantidade: 1 }] });
    const p2 = await svc.criarPedido({ tenantId: A.tenantId, userId: A.userId, mesa_id: f.mesaId, itens: [{ produto_id: f.bebidaId, quantidade: 1 }] });

    await svc.actualizarStatusPedido({ tenantId: A.tenantId, pedidoId: p1.id, status: 'FECHADO' });
    let mesa = await pool.query(`SELECT status FROM mesas WHERE id=$1`, [f.mesaId]);
    expect(mesa.rows[0].status).toBe('OCUPADA'); // p2 ainda aberto

    await svc.actualizarStatusPedido({ tenantId: A.tenantId, pedidoId: p2.id, status: 'FECHADO' });
    mesa = await pool.query(`SELECT status FROM mesas WHERE id=$1`, [f.mesaId]);
    expect(mesa.rows[0].status).toBe('LIVRE');
  });

  test('status fora do CHECK é bloqueado no serviço; pedido de outro tenant → 404', async () => {
    const f = await fixtures(A.tenantId);
    const p = await svc.criarPedido({ tenantId: A.tenantId, userId: A.userId, itens: [{ produto_id: f.prodId, quantidade: 1 }] });

    await expect(svc.actualizarStatusPedido({ tenantId: A.tenantId, pedidoId: p.id, status: 'VOOU' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.actualizarStatusPedido({ tenantId: B.tenantId, pedidoId: p.id, status: 'FECHADO' })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('actualizarStatusItem só actua em itens do tenant certo', async () => {
    const f = await fixtures(A.tenantId);
    const p = await svc.criarPedido({ tenantId: A.tenantId, userId: A.userId, itens: [{ produto_id: f.prodId, quantidade: 1 }] });
    const itemId = p.itens[0].id;

    const ok = await svc.actualizarStatusItem({ tenantId: A.tenantId, pedidoId: p.id, itemId, status_cozinha: 'PRONTO' });
    expect(ok.status_cozinha).toBe('PRONTO');
    await expect(svc.actualizarStatusItem({ tenantId: B.tenantId, pedidoId: p.id, itemId, status_cozinha: 'ENTREGUE' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('pedidos.service — listarPedidos com buildWhere (SQL parametrizado real)', () => {
  test('filtra por status e mesa_id, pagina e conta correctamente', async () => {
    const f = await fixtures(A.tenantId);
    const outraMesa = (await pool.query(`INSERT INTO mesas (tenant_id, numero) VALUES ($1, 'M2') RETURNING id`, [A.tenantId])).rows[0].id;

    for (let i = 0; i < 3; i++) await svc.criarPedido({ tenantId: A.tenantId, userId: A.userId, mesa_id: f.mesaId, itens: [{ produto_id: f.prodId, quantidade: 1 }] });
    const pOutra = await svc.criarPedido({ tenantId: A.tenantId, userId: A.userId, mesa_id: outraMesa, itens: [{ produto_id: f.prodId, quantidade: 1 }] });
    await svc.actualizarStatusPedido({ tenantId: A.tenantId, pedidoId: pOutra.id, status: 'FECHADO' });
    // ruído de outro tenant
    const fB = await fixtures(B.tenantId);
    await svc.criarPedido({ tenantId: B.tenantId, userId: B.userId, itens: [{ produto_id: fB.prodId, quantidade: 1 }] });

    const todos = await svc.listarPedidos({ tenantId: A.tenantId });
    expect(todos.total).toBe(4);

    const abertos = await svc.listarPedidos({ tenantId: A.tenantId, status: 'ABERTO' });
    expect(abertos.total).toBe(3);

    const mesaM1 = await svc.listarPedidos({ tenantId: A.tenantId, mesa_id: f.mesaId, status: 'ABERTO' });
    expect(mesaM1.total).toBe(3);

    const pag = await svc.listarPedidos({ tenantId: A.tenantId, page: 2, limit: 3 });
    expect(pag.data).toHaveLength(1);
    expect(pag.total).toBe(4);

    const deB = await svc.listarPedidos({ tenantId: B.tenantId });
    expect(deB.total).toBe(1);
  });

  test('valor de filtro com SQL injection é tratado como literal', async () => {
    const f = await fixtures(A.tenantId);
    await svc.criarPedido({ tenantId: A.tenantId, userId: A.userId, itens: [{ produto_id: f.prodId, quantidade: 1 }] });
    const r = await svc.listarPedidos({ tenantId: A.tenantId, status: `ABERTO' OR '1'='1` });
    expect(r.total).toBe(0);
  });
});

describe('HTTP /api/pedidos — ponta a ponta', () => {
  test('POST cria, GET lista, PATCH fecha', async () => {
    const f = await fixtures(A.tenantId);
    const auth = { Authorization: `Bearer ${A.token}` };

    const c = await request(app).post('/api/pedidos').set(auth)
      .send({ mesa_id: f.mesaId, itens: [{ produto_id: f.prodId, quantidade: 2 }] });
    expect(c.status).toBe(201);
    expect(Number(c.body.total)).toBe(5000);

    const g = await request(app).get('/api/pedidos?status=ABERTO').set(auth);
    expect(g.status).toBe(200);
    expect(g.body.total).toBe(1);

    const u = await request(app).patch(`/api/pedidos/${c.body.id}/status`).set(auth).send({ status: 'FECHADO' });
    expect(u.status).toBe(200);
    expect(u.body.status).toBe('FECHADO');
  });
});
