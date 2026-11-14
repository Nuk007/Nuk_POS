'use strict';
/** Integração (PostgreSQL real) — chave de idempotência: reenvios não criam pedidos nem cobranças repetidas. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, prod, n = 1;
const ip = () => `10.17.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const portal = (T, corpo) => request(app).post('/api/cliente/pedido-restaurante').set('X-Forwarded-For', ip()).set('X-Tenant-Slug', T.slug).send(corpo);
const contar = async t => Number((await pool.query(`SELECT COUNT(*) n FROM pedidos WHERE tenant_id=$1`, [t])).rows[0].n);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-idem-a' });
  B = await criarTenantFixture({ slug: 'it-idem-b' });
  prod = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',600,'BEBIDA',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
}, 60000);

test('POS: o mesmo envio duas vezes devolve o mesmo pedido (200) e não abate stock duas vezes', async () => {
  const antes = await contar(A.tenantId);
  const corpo = { origem: 'BALCAO', itens: [{ produto_id: prod, quantidade: 2 }], chave_idempotencia: 'pos-chave-0001' };
  const r1 = await call(A, 'post', '/api/pedidos', corpo);
  const r2 = await call(A, 'post', '/api/pedidos', corpo);
  expect(r1.status).toBe(201);
  expect(r2.status).toBe(200);
  expect(r2.body.id).toBe(r1.body.id);
  expect(r2.body.repetido).toBe(true);
  expect(await contar(A.tenantId)).toBe(antes + 1);
  expect((await call(A, 'post', '/api/pedidos', { ...corpo, chave_idempotencia: 'curta' })).status).toBe(400);
});

test('POS: cinco envios simultâneos com a mesma chave criam um só pedido', async () => {
  const antes = await contar(A.tenantId);
  const corpo = { origem: 'BALCAO', itens: [{ produto_id: prod, quantidade: 1 }], chave_idempotencia: 'pos-concorrente-01' };
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => call(A, 'post', '/api/pedidos', corpo)));
  expect(rs.every(r => [200, 201].includes(r.status))).toBe(true);
  expect(new Set(rs.map(r => r.body.id)).size).toBe(1);
  expect(await contar(A.tenantId)).toBe(antes + 1);
});

test('portal: reenvio devolve o mesmo pedido e código; outra casa com a mesma chave é independente', async () => {
  const corpo = { itens: [{ produto_id: prod, quantidade: 1 }], metodo_pagamento: 'CASH', chave_idempotencia: 'portal-chave-0001' };
  const r1 = await portal(A, corpo);
  const r2 = await portal(A, corpo);
  expect(r1.status).toBe(201);
  expect(r2.status).toBe(200);
  expect(r2.body).toMatchObject({ pedido_id: r1.body.pedido_id, codigo: r1.body.codigo, repetido: true, total_final: r1.body.total_final });
  const rs = await Promise.all([1, 2, 3].map(() => portal(A, { ...corpo, chave_idempotencia: 'portal-conc-0001' })));
  expect(new Set(rs.map(r => r.body.pedido_id)).size).toBe(1);
  // a chave é por estabelecimento
  const pB = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',600,'BEBIDA',true,true) RETURNING id`, [B.tenantId])).rows[0].id;
  const rB = await portal(B, { ...corpo, itens: [{ produto_id: pB, quantidade: 1 }] });
  expect(rB.status).toBe(201);
  expect(rB.body.pedido_id).not.toBe(r1.body.pedido_id);
});

describe('Pedido feito sem internet (registado_em)', () => {
  test('guarda a hora real, usa os preços dessa hora e a sincronização repetida não duplica', async () => {
    const T = await criarTenantFixture({ slug: 'it-offline' });
    const prod = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',1000,'BEBIDA',true,true) RETURNING id`, [T.tenantId])).rows[0].id;
    // tabela «happy hour» só das 03:00 às 03:30 de Luanda, preço 500
    const tab = (await pool.query(`INSERT INTO tabelas_preco (tenant_id, nome, dias, hora_inicio, hora_fim, prioridade, ativa) VALUES ($1,'Madrugada','{0,1,2,3,4,5,6}','03:00','03:30',50,true) RETURNING id`, [T.tenantId])).rows[0].id;
    await pool.query(`INSERT INTO precos_tabela (tabela_id, produto_id, preco) VALUES ($1,$2,500)`, [tab, prod]);
    const ontem3h = new Date(Date.now() - 86400e3);
    const iso = new Date(`${ontem3h.toISOString().slice(0, 10)}T03:10:00+01:00`);
    if (Date.now() - iso.getTime() > 47 * 3600e3) iso.setTime(iso.getTime() + 86400e3);
    const req = () => request(app).post('/api/pedidos').set('Authorization', `Bearer ${T.token}`).set('X-Forwarded-For', `10.18.0.${Math.floor(Math.random() * 200) + 1}`)
      .send({ origem: 'BALCAO', itens: [{ produto_id: prod, quantidade: 2 }], chave_idempotencia: 'offline-chave-0001', registado_em: iso.toISOString() });
    const a = await req();
    expect(a.status).toBe(201);
    expect(Number(a.body.total)).toBe(1000); // 2 × 500 (preço da hora da venda)
    const b = await req();
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    const linha = (await pool.query(`SELECT registado_offline_em FROM pedidos WHERE id = $1`, [a.body.id])).rows[0];
    expect(new Date(linha.registado_offline_em).toISOString()).toBe(iso.toISOString());
  });
  test('recusa hora futura, com mais de 48 h e sem chave', async () => {
    const T = await criarTenantFixture({ slug: 'it-offline-2' });
    const prod = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',1000,'BEBIDA',true,true) RETURNING id`, [T.tenantId])).rows[0].id;
    const envia = (extra) => request(app).post('/api/pedidos').set('Authorization', `Bearer ${T.token}`).set('X-Forwarded-For', '10.18.1.1')
      .send({ origem: 'BALCAO', itens: [{ produto_id: prod, quantidade: 1 }], ...extra });
    expect((await envia({ chave_idempotencia: 'offline-fut-0001', registado_em: new Date(Date.now() + 3600e3).toISOString() })).status).toBe(400);
    expect((await envia({ chave_idempotencia: 'offline-old-0001', registado_em: new Date(Date.now() - 49 * 3600e3).toISOString() })).status).toBe(400);
    expect((await envia({ registado_em: new Date().toISOString() })).status).toBe(400);
  });
});
