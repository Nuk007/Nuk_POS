'use strict';
/** Integração — Compras pontuais pagas com o dinheiro do caixa. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, ipN = 1, farinha;
const ip = () => `10.77.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].v);
const stockDe = id => num(`SELECT stock_atual AS v FROM stock_items WHERE id=$1`, [id]);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-compras' });
  B = await criarTenantFixture({ slug: 'it-compras-b' });
  farinha = (await pool.query(`INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, stock_minimo, unidade) VALUES ($1,'Farinha','OUTRO',10,2,'kg') RETURNING id`, [A.tenantId])).rows[0].id;
});

describe('Compras pontuais', () => {
  test('com o caixa fechado recusa (409 CAIXA_FECHADO)', async () => {
    const r = await a('post', '/api/compras', { stock_item_id: farinha, quantidade: 5, valor_total: 1000 });
    expect(r.status).toBe(409); expect(r.body.codigo).toBe('CAIXA_FECHADO');
  });
  test('só produtos cadastrados, só do próprio estabelecimento; valida quantidade e valor', async () => {
    await a('post', '/api/caixa/abrir', { fundo_inicial: 5000 });
    expect((await a('post', '/api/compras', { quantidade: 1, valor_total: 100 })).status).toBe(400);
    expect((await a('post', '/api/compras', { stock_item_id: '00000000-0000-0000-0000-000000000000', quantidade: 1, valor_total: 100 })).status).toBe(404);
    expect((await a('post', '/api/compras', { stock_item_id: farinha, quantidade: 0, valor_total: 100 })).status).toBe(400);
    expect((await a('post', '/api/compras', { stock_item_id: farinha, quantidade: 1, valor_total: -5 })).status).toBe(400);
    await op(B, 'post', '/api/caixa/abrir', { fundo_inicial: 5000 });
    expect((await op(B, 'post', '/api/compras', { stock_item_id: farinha, quantidade: 1, valor_total: 100 })).status).toBe(404);
  });
  test('compra sai da gaveta, entra no stock e actualiza o custo; não passa do dinheiro disponível', async () => {
    const r = await a('post', '/api/compras', { stock_item_id: farinha, quantidade: 5, valor_total: 2000, fornecedor: 'Mercado' });
    expect(r.status).toBe(201); expect(r.body.dinheiro_na_gaveta).toBe(3000);
    expect(await stockDe(farinha)).toBe(15);
    expect(await num(`SELECT custo_unitario AS v FROM stock_items WHERE id=$1`, [farinha])).toBe(400);
    const cx = (await a('get', '/api/caixa')).body;
    expect(cx.resumo.dinheiro_esperado).toBe(3000);
    expect(cx.movimentos.find(m => m.tipo === 'COMPRA').valor).toBe('-2000.00');
    const sem = await a('post', '/api/compras', { stock_item_id: farinha, quantidade: 1, valor_total: 3500 });
    expect(sem.status).toBe(409); expect(sem.body.disponivel).toBe(3000);
    expect(await stockDe(farinha)).toBe(15);
  });
  test('anular devolve o dinheiro e retira do stock; não anula duas vezes nem stock já consumido', async () => {
    const lista = (await a('get', '/api/compras')).body;
    const id = lista[0].id;
    expect((await a('post', '/api/compras/abc/anular')).status).toBe(400);
    await pool.query(`UPDATE stock_items SET stock_atual = 3 WHERE id=$1`, [farinha]); // já gastaram parte
    const r1 = await a('post', `/api/compras/${id}/anular`);
    expect(r1.status).toBe(409);
    await pool.query(`UPDATE stock_items SET stock_atual = 15 WHERE id=$1`, [farinha]);
    expect((await a('post', `/api/compras/${id}/anular`)).status).toBe(200);
    expect(await stockDe(farinha)).toBe(10);
    expect((await a('get', '/api/caixa')).body.resumo.dinheiro_esperado).toBe(5000);
    expect((await a('post', `/api/compras/${id}/anular`)).status).toBe(409);
    expect((await a('get', '/api/compras')).body[0].anulada_em).toBeTruthy();
  });
  test('compra de um caixa já fechado não se anula', async () => {
    const c = await a('post', '/api/compras', { stock_item_id: farinha, quantidade: 1, valor_total: 100 });
    await a('post', '/api/caixa/fechar', { contado: 4900 });
    await a('post', '/api/caixa/abrir', { fundo_inicial: 4900 });
    expect((await a('post', `/api/compras/${c.body.compra.id}/anular`)).status).toBe(409);
  });
});
