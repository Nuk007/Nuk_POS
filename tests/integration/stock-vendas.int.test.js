'use strict';
/**
 * Integração (PostgreSQL real) — as vendas abatem o stock.
 * Receita por produto, abate atómico com o pedido, 409 sem stock (nada é cobrado), devolução no cancelamento,
 * concorrência sem stock negativo e isolamento entre estabelecimentos.
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, ipN = 1, cuca, picanha, stockCuca, stockCarne, stockTempero;
const ip = () => `10.8.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const pub = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug).send(body);
const stockDe = async id => Number((await pool.query('SELECT stock_atual FROM stock_items WHERE id=$1', [id])).rows[0].stock_atual);
const defStock = (id, q) => pool.query('UPDATE stock_items SET stock_atual=$1 WHERE id=$2', [q, id]);
const novoPedido = (itens) => op(A, 'post', '/api/pedidos', { itens });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-stock-a' });
  B = await criarTenantFixture({ slug: 'it-stock-b' });
  const prod = async (nome, preco) => (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,'OUTRO',true,true) RETURNING id`, [A.tenantId, nome, preco])).rows[0].id;
  const item = async (t, nome, un, q, min = 0) => (await pool.query(`INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, stock_minimo, unidade) VALUES ($1,$2,'OUTRO',$3,$4,$5) RETURNING id`, [t, nome, q, min, un])).rows[0].id;
  cuca = await prod('Cuca 33cl', 600); picanha = await prod('Picanha', 4500);
  stockCuca = await item(A.tenantId, 'Cuca (garrafas)', 'un', 24, 6);
  stockCarne = await item(A.tenantId, 'Carne de vaca', 'g', 2000);
  stockTempero = await item(A.tenantId, 'Tempero', 'g', 100);
  expect((await op(A, 'put', `/api/produtos/${cuca}/ingredientes`, { ingredientes: [{ stock_item_id: stockCuca, quantidade: 1 }] })).status).toBe(200);
  expect((await op(A, 'put', `/api/produtos/${picanha}/ingredientes`, { ingredientes: [{ stock_item_id: stockCarne, quantidade: 300 }, { stock_item_id: stockTempero, quantidade: 20 }] })).status).toBe(200);
}, 60000);

describe('Receita (ingredientes)', () => {
  test('lê-se de volta e valida entradas', async () => {
    const r = await op(A, 'get', `/api/produtos/${picanha}/ingredientes`);
    expect(r.status).toBe(200);
    expect(r.body.map(i => Number(i.quantidade)).sort((a, b) => a - b)).toEqual([20, 300]);
    expect((await op(A, 'put', `/api/produtos/${cuca}/ingredientes`, { ingredientes: [{ stock_item_id: stockCuca, quantidade: 0 }] })).status).toBe(400);
    expect((await op(A, 'put', `/api/produtos/${cuca}/ingredientes`, { ingredientes: [{ stock_item_id: stockCuca, quantidade: 1 }, { stock_item_id: stockCuca, quantidade: 2 }] })).status).toBe(400);
    expect((await op(A, 'put', `/api/produtos/${cuca}/ingredientes`, { ingredientes: 'x' })).status).toBe(400);
  });
  test('isolamento: outro estabelecimento não vê nem altera a receita', async () => {
    expect((await op(B, 'get', `/api/produtos/${picanha}/ingredientes`)).status).toBe(404);
    expect((await op(B, 'put', `/api/produtos/${picanha}/ingredientes`, { ingredientes: [] })).status).toBe(404);
  });
});

describe('Abate nas vendas', () => {
  test('pedido do operador abate cada ingrediente e regista o movimento VENDA', async () => {
    const antesC = await stockDe(stockCarne), antesT = await stockDe(stockTempero);
    const r = await novoPedido([{ produto_id: picanha, quantidade: 2 }]);
    expect(r.status).toBe(201);
    expect(await stockDe(stockCarne)).toBe(antesC - 600);
    expect(await stockDe(stockTempero)).toBe(antesT - 40);
    const mv = await pool.query(`SELECT tipo, quantidade FROM movimentos_stock WHERE pedido_id=$1 ORDER BY quantidade`, [r.body.id]);
    expect(mv.rows.map(m => m.tipo)).toEqual(['VENDA', 'VENDA']);
  });

  test('pedido do portal também abate (e produto sem receita não mexe no stock)', async () => {
    await defStock(stockCuca, 24);
    const semReceita = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Água',200,'OUTRO',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
    const r = await pub('post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cuca, quantidade: 3 }, { produto_id: semReceita, quantidade: 5 }], metodo_pagamento: 'CASH' });
    expect(r.status).toBe(201);
    expect(await stockDe(stockCuca)).toBe(21);
  });

  test('sem stock → 409 e NADA é gravado nem cobrado (pedido, stock e Nuk-Coin intactos)', async () => {
    await defStock(stockCarne, 400); // dá para 1 picanha (300 g), não para 2
    const pedidosAntes = Number((await pool.query('SELECT COUNT(*) FROM pedidos WHERE tenant_id=$1', [A.tenantId])).rows[0].count);
    const r = await novoPedido([{ produto_id: picanha, quantidade: 2 }]);
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/Carne de vaca/);
    expect(await stockDe(stockCarne)).toBe(400);
    expect(await stockDe(stockTempero)).toBeGreaterThan(0);
    expect(Number((await pool.query('SELECT COUNT(*) FROM pedidos WHERE tenant_id=$1', [A.tenantId])).rows[0].count)).toBe(pedidosAntes);
  });

  test('pedido de portal pago com Nuk-Coin sem stock: 409 e o saldo não é debitado', async () => {
    await defStock(stockCuca, 1);
    const cli = await pub('post', '/api/cliente/cadastrar', { nome: 'Cliente Stock', telefone: '923000111', pin: '1234', provincia: 'Luanda' });
    expect(cli.status).toBe(201);
    const id = cli.body.cliente.id;
    expect((await op(A, 'post', '/api/cliente/nukcoin/carregar', { cliente_id: id, valor: 5000 })).status).toBe(200);
    const r = await pub('post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cuca, quantidade: 2 }], cliente_id: id, metodo_pagamento: 'NUKCOIN', pin: '1234' });
    expect(r.status).toBe(409);
    expect(Number((await pool.query('SELECT nukcoin_saldo FROM clientes WHERE id=$1', [id])).rows[0].nukcoin_saldo)).toBe(5000);
    expect(await stockDe(stockCuca)).toBe(1);
  });

  test('cancelar devolve o stock — uma só vez', async () => {
    await defStock(stockCuca, 10);
    const r = await novoPedido([{ produto_id: cuca, quantidade: 4 }]);
    expect(r.status).toBe(201);
    expect(await stockDe(stockCuca)).toBe(6);
    expect((await op(A, 'patch', `/api/pedidos/${r.body.id}/status`, { status: 'CANCELADO' })).status).toBe(200);
    expect(await stockDe(stockCuca)).toBe(10);
    await op(A, 'patch', `/api/pedidos/${r.body.id}/status`, { status: 'CANCELADO' }); // repetido: idempotente
    expect(await stockDe(stockCuca)).toBe(10);
    const est = await pool.query(`SELECT COUNT(*) FROM movimentos_stock WHERE pedido_id=$1 AND tipo='ESTORNO'`, [r.body.id]);
    expect(Number(est.rows[0].count)).toBe(1);
  });

  test('fechar um pedido NÃO devolve nem abate de novo', async () => {
    await defStock(stockCuca, 10);
    const r = await novoPedido([{ produto_id: cuca, quantidade: 2 }]);
    for (const s of ['EM_PREPARO', 'PRONTO', 'FECHADO']) await op(A, 'patch', `/api/pedidos/${r.body.id}/status`, { status: s });
    expect(await stockDe(stockCuca)).toBe(8);
  });

  test('10 pedidos simultâneos de 1 garrafa com 6 em stock: 6 passam, 4 recebem 409, stock = 0 (nunca negativo)', async () => {
    await defStock(stockCuca, 6);
    const rs = await Promise.all(Array.from({ length: 10 }, () => novoPedido([{ produto_id: cuca, quantidade: 1 }])));
    expect(rs.filter(r => r.status === 201).length).toBe(6);
    expect(rs.filter(r => r.status === 409).length).toBe(4);
    expect(await stockDe(stockCuca)).toBe(0);
  });
});
