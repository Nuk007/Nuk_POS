'use strict';
/** Integração (PostgreSQL real) — ecrã de cozinha e bar: postos por categoria, avanço de itens e estado do pedido. */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');
const { broadcast } = require('../../server/middleware/broadcast');

let A, B, OP, cuca, picanha, cigarro, mesa, n = 1;
const ip = () => `10.15.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const estado = async id => (await pool.query(`SELECT status FROM pedidos WHERE id=$1`, [id])).rows[0].status;

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-kds-a' });
  B = await criarTenantFixture({ slug: 'it-kds-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Cozinheira','c@it-kds-a.ao',$2,'Cozinha','OPERADOR') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  OP = { token: gerarToken({ id: op, email: 'c@it-kds-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
  const ins = (nome, preco, cat) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat]);
  cuca = (await ins('Cuca', 600, 'BEBIDA')).rows[0].id;
  picanha = (await ins('Picanha', 4500, 'CHURRASCO')).rows[0].id;
  cigarro = (await ins('Maço', 1500, 'CIGARROS')).rows[0].id;
  mesa = (await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,'M09',4) RETURNING id`, [A.tenantId])).rows[0].id;
}, 60000);

test('cada item vai para o seu posto; cigarros não aparecem; outro estabelecimento não vê', async () => {
  const p = await call(OP, 'post', '/api/pedidos', { origem: 'MESA', mesa_id: mesa, itens: [{ produto_id: picanha, quantidade: 2 }, { produto_id: cuca, quantidade: 3 }, { produto_id: cigarro, quantidade: 1 }] });
  expect(p.status).toBe(201);
  const coz = (await call(OP, 'get', '/api/cozinha?posto=COZINHA')).body.find(x => x.id === p.body.id);
  expect(coz).toMatchObject({ mesa: 'M09', estado: 'AGUARDANDO' });
  expect(coz.itens.map(i => i.produto)).toEqual(['Picanha']);
  const bar = (await call(OP, 'get', '/api/cozinha?posto=BAR')).body.find(x => x.id === p.body.id);
  expect(bar.itens.map(i => i.produto)).toEqual(['Cuca']);
  expect((await call(B, 'get', '/api/cozinha?posto=COZINHA')).body).toEqual([]);
  expect((await call(OP, 'get', '/api/cozinha?posto=SALA')).status).toBe(400);
});

test('avançar: pedido passa a EM_PREPARO; tudo pronto → PRONTO e aviso à sala; entregue sai do ecrã', async () => {
  broadcast.mockClear();
  const p = (await call(OP, 'post', '/api/pedidos', { origem: 'MESA', mesa_id: mesa, itens: [{ produto_id: picanha, quantidade: 1 }, { produto_id: cuca, quantidade: 1 }] })).body;
  let r = await call(OP, 'post', `/api/cozinha/pedidos/${p.id}/avancar`, { posto: 'COZINHA' });
  expect(r.body.estado).toBe('PREPARANDO');
  expect(await estado(p.id)).toBe('EM_PREPARO');
  r = await call(OP, 'post', `/api/cozinha/pedidos/${p.id}/avancar`, { posto: 'COZINHA' });
  expect(r.body.estado).toBe('PRONTO');
  expect(await estado(p.id)).toBe('EM_PREPARO'); // o bar ainda não acabou
  expect(broadcast).toHaveBeenCalledWith('pedido_pronto', expect.objectContaining({ id: p.id, posto: 'COZINHA', mesa: 'M09' }), A.tenantId);
  // bar: item a item
  const itemBar = (await call(OP, 'get', '/api/cozinha?posto=BAR')).body.find(x => x.id === p.id).itens[0].id;
  await call(OP, 'post', `/api/cozinha/pedidos/${p.id}/itens/${itemBar}/avancar`, {});
  await call(OP, 'post', `/api/cozinha/pedidos/${p.id}/itens/${itemBar}/avancar`, {});
  expect(await estado(p.id)).toBe('PRONTO');
  // entregar tudo na cozinha → desaparece do ecrã da cozinha
  await call(OP, 'post', `/api/cozinha/pedidos/${p.id}/avancar`, { posto: 'COZINHA' });
  expect((await call(OP, 'get', '/api/cozinha?posto=COZINHA')).body.find(x => x.id === p.id)).toBeUndefined();
  expect((await call(OP, 'post', `/api/cozinha/pedidos/${p.id}/avancar`, { posto: 'COZINHA' })).status).toBe(409);
});

test('pedido cancelado e remoto por validar não aparecem; FECHADO nunca muda de estado pela cozinha', async () => {
  const c = (await call(OP, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: picanha, quantidade: 1 }] })).body;
  await call(OP, 'patch', `/api/pedidos/${c.id}/status`, { status: 'CANCELADO' });
  expect((await call(OP, 'get', '/api/cozinha?posto=COZINHA')).body.find(x => x.id === c.id)).toBeUndefined();
  expect((await call(OP, 'post', `/api/cozinha/pedidos/${c.id}/avancar`, { posto: 'COZINHA' })).status).toBe(409);
  const rem = await request(app).post('/api/cliente/pedido-restaurante').set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug).send({ itens: [{ produto_id: picanha, quantidade: 1 }], metodo_pagamento: 'CASH' });
  expect((await call(OP, 'get', '/api/cozinha?posto=COZINHA')).body.find(x => x.id === rem.body.pedido_id)).toBeUndefined();
  const f = (await call(OP, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: picanha, quantidade: 1 }] })).body;
  await call(OP, 'patch', `/api/pedidos/${f.id}/status`, { status: 'FECHADO' });
  await call(OP, 'post', `/api/cozinha/pedidos/${f.id}/avancar`, { posto: 'COZINHA' });
  await call(OP, 'post', `/api/cozinha/pedidos/${f.id}/avancar`, { posto: 'COZINHA' });
  expect(await estado(f.id)).toBe('FECHADO');
});

test('postos configuráveis (só ADMIN): bebidas para a cozinha muda o ecrã', async () => {
  expect((await call(OP, 'put', '/api/cozinha/postos', { postos: { BEBIDA: 'COZINHA' } })).status).toBe(403);
  expect((await call(A, 'put', '/api/cozinha/postos', { postos: { BEBIDA: 'SALA' } })).status).toBe(400);
  expect((await call(A, 'put', '/api/cozinha/postos', { postos: { BEBIDA: 'COZINHA' } })).status).toBe(200);
  const p = (await call(OP, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: cuca, quantidade: 1 }] })).body;
  expect((await call(OP, 'get', '/api/cozinha?posto=COZINHA')).body.find(x => x.id === p.id).itens[0].produto).toBe('Cuca');
  expect((await call(OP, 'get', '/api/cozinha/postos')).body.postos.BEBIDA).toBe('COZINHA');
});
