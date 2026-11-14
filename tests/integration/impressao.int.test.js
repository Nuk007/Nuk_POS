'use strict';
/** Integração (PostgreSQL real) — documentos para impressão directa: talões de cozinha/bar (uma só vez) e recibo. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, cuca, picanha, mesa, n = 1;
const ip = () => `10.16.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const textos = d => d.linhas.map(l => l.t || '').join('\n');

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-imp-a' });
  B = await criarTenantFixture({ slug: 'it-imp-b' });
  await pool.query(`INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,'nome_estabelecimento','Clube Teste'),($1,'nif_empresa','5417000000')`, [A.tenantId]);
  const ins = (nome, preco, cat) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat]);
  cuca = (await ins('Cuca', 600, 'BEBIDA')).rows[0].id;
  picanha = (await ins('Picanha à moda', 4500, 'CHURRASCO')).rows[0].id;
  mesa = (await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,'M03',4) RETURNING id`, [A.tenantId])).rows[0].id;
  expect((await call(A, 'post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
}, 60000);

test('talão de cozinha sai uma só vez, só com os itens do posto; o bar tem o seu', async () => {
  const p = (await call(A, 'post', '/api/pedidos', { origem: 'MESA', mesa_id: mesa, observacoes: 'Sem sal', itens: [{ produto_id: picanha, quantidade: 2 }, { produto_id: cuca, quantidade: 3 }] })).body;
  const r1 = await call(A, 'post', '/api/impressao/preparacao/reclamar', { posto: 'COZINHA', colunas: 32 });
  expect(r1.status).toBe(200);
  const doc = r1.body.find(d => d.pedido_id === p.id);
  expect(textos(doc)).toContain('Mesa M03');
  expect(textos(doc)).toContain('2x Picanha');
  expect(textos(doc)).not.toContain('Cuca');
  expect(textos(doc)).toContain('Obs.: Sem sal');
  expect(doc.linhas.filter(l => !l.g && l.t).every(l => l.t.length <= 32)).toBe(true);
  expect((await call(A, 'post', '/api/impressao/preparacao/reclamar', { posto: 'COZINHA' })).body.find(d => d.pedido_id === p.id)).toBeUndefined();
  const bar = (await call(A, 'post', '/api/impressao/preparacao/reclamar', { posto: 'BAR' })).body.find(d => d.pedido_id === p.id);
  expect(textos(bar)).toContain('3x Cuca');
  const re = await call(A, 'get', `/api/impressao/preparacao/${p.id}?posto=COZINHA&colunas=48`);
  expect(textos(re.body)).toContain('REIMPRESSÃO');
  expect((await call(B, 'get', `/api/impressao/preparacao/${p.id}?posto=COZINHA`)).status).toBe(404);
  expect((await call(A, 'post', '/api/impressao/preparacao/reclamar', { posto: 'SALA' })).status).toBe(400);
});

test('dois dispositivos ao mesmo tempo: cada talão sai num só', async () => {
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await call(A, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: picanha, quantidade: 1 }] })).body.id);
  const [d1, d2] = await Promise.all([1, 2].map(() => call(A, 'post', '/api/impressao/preparacao/reclamar', { posto: 'COZINHA' })));
  const todos = [...d1.body, ...d2.body].map(d => d.pedido_id).filter(id => ids.includes(id));
  expect(todos.sort()).toEqual([...ids].sort());
});

test('remoto por validar não imprime até ser aceite', async () => {
  const r = await request(app).post('/api/cliente/pedido-restaurante').set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug).send({ itens: [{ produto_id: picanha, quantidade: 1 }], metodo_pagamento: 'CASH' });
  expect((await call(A, 'post', '/api/impressao/preparacao/reclamar', { posto: 'COZINHA' })).body.find(d => d.pedido_id === r.body.pedido_id)).toBeUndefined();
  await call(A, 'patch', `/api/pedidos/${r.body.pedido_id}/status`, { status: 'EM_PREPARO' });
  expect((await call(A, 'post', '/api/impressao/preparacao/reclamar', { posto: 'COZINHA' })).body.find(d => d.pedido_id === r.body.pedido_id)).toBeTruthy();
});

test('recibo: cabeçalho, itens, total, formas de pagamento e gaveta só com dinheiro', async () => {
  const p = (await call(A, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: picanha, quantidade: 1 }, { produto_id: cuca, quantidade: 2 }] })).body;
  await call(A, 'patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' });
  let r = await call(A, 'post', '/api/impressao/recibo', { pedido_ids: [p.id] });
  expect(textos(r.body)).toContain('CONTA POR PAGAR');
  expect(r.body.gaveta).toBe(false);
  await call(A, 'post', '/api/caixa/receber', { pedido_ids: [p.id], pagamentos: [{ metodo: 'CASH', valor: 2000 }, { metodo: 'TPA', valor: 3700 }] });
  r = await call(A, 'post', '/api/impressao/recibo', { pedido_ids: [p.id], colunas: 42 });
  const t = textos(r.body);
  ['Clube Teste', 'NIF 5417000000', '1x Picanha à moda', '2x Cuca', 'TOTAL', 'Dinheiro', 'TPA', 'Documento sem validade fiscal'].forEach(x => expect(t).toContain(x));
  expect(r.body.gaveta).toBe(true);
  expect(r.body.colunas).toBe(42);
  expect((await call(B, 'post', '/api/impressao/recibo', { pedido_ids: [p.id] })).status).toBe(404);
  expect((await call(A, 'post', '/api/impressao/recibo', { pedido_ids: ['x'] })).status).toBe(400);
});
