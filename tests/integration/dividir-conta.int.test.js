'use strict';
/** Integração (PostgreSQL real) — dividir a conta de uma mesa e receber cada parte à parte. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, cuca, picanha, mesa, n = 1;
const ip = () => `10.14.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);

async function contaFechada(itens) {
  const p = await call(A, 'post', '/api/pedidos', { origem: 'MESA', mesa_id: mesa, itens });
  expect(p.status).toBe(201);
  expect((await call(A, 'patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' })).status).toBe(200);
  const r = await pool.query(`SELECT id, quantidade, produto_id FROM itens_pedido WHERE pedido_id=$1`, [p.body.id]);
  return { id: p.body.id, itens: r.rows };
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-div-a' });
  B = await criarTenantFixture({ slug: 'it-div-b' });
  const ins = (nome, preco, cat) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat]);
  cuca = (await ins('Cuca', 600, 'BEBIDA')).rows[0].id;
  picanha = (await ins('Picanha', 4500, 'CHURRASCO')).rows[0].id;
  mesa = (await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,'M07',4) RETURNING id`, [A.tenantId])).rows[0].id;
  expect((await call(A, 'post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
}, 60000);

test('separa parte das quantidades; totais certos; cada parte recebe-se à parte; mesa só fica livre no fim', async () => {
  const c = await contaFechada([{ produto_id: picanha, quantidade: 2 }, { produto_id: cuca, quantidade: 4 }]); // 9000 + 2400
  const iPic = c.itens.find(x => x.produto_id === picanha).id, iCuca = c.itens.find(x => x.produto_id === cuca).id;
  const d = await call(A, 'post', '/api/caixa/dividir', { pedido_id: c.id, itens: [{ item_id: iPic, quantidade: 1 }, { item_id: iCuca, quantidade: 4 }] });
  expect(d.status).toBe(200);
  expect(d.body.original.total).toBe(4500);
  expect(d.body.nova.total).toBe(4500 + 2400);
  const lista = (await call(A, 'get', '/api/caixa/por-receber')).body.filter(p => p.mesa_numero === 'M07');
  expect(lista.map(p => Number(p.total)).sort((a, b) => a - b)).toEqual([4500, 6900]);
  // stock não muda e a soma das duas contas é a conta original
  expect((await call(A, 'post', '/api/caixa/receber', { pedido_ids: [d.body.nova.id], metodo: 'TPA' })).status).toBe(200);
  expect((await pool.query(`SELECT status FROM mesas WHERE id=$1`, [mesa])).rows[0].status).toBe('OCUPADA');
  expect((await call(A, 'post', '/api/caixa/receber', { pedido_ids: [c.id], metodo: 'CASH' })).status).toBe(200);
  expect((await pool.query(`SELECT status FROM mesas WHERE id=$1`, [mesa])).rows[0].status).toBe('LIVRE');
});

test('recusas: tudo passado, quantidade a mais, item alheio, conta paga, outro estabelecimento', async () => {
  const c = await contaFechada([{ produto_id: cuca, quantidade: 2 }]);
  const it = c.itens[0].id;
  expect((await call(A, 'post', '/api/caixa/dividir', { pedido_id: c.id, itens: [{ item_id: it, quantidade: 2 }] })).status).toBe(400);
  expect((await call(A, 'post', '/api/caixa/dividir', { pedido_id: c.id, itens: [{ item_id: it, quantidade: 3 }] })).status).toBe(400);
  const outra = await contaFechada([{ produto_id: cuca, quantidade: 1 }]);
  expect((await call(A, 'post', '/api/caixa/dividir', { pedido_id: c.id, itens: [{ item_id: outra.itens[0].id, quantidade: 1 }] })).status).toBe(404);
  expect((await call(B, 'post', '/api/caixa/dividir', { pedido_id: c.id, itens: [{ item_id: it, quantidade: 1 }] })).status).toBe(404);
  expect((await call(A, 'post', '/api/caixa/receber', { pedido_ids: [c.id, outra.id], metodo: 'CASH' })).status).toBe(200);
  expect((await call(A, 'post', '/api/caixa/dividir', { pedido_id: c.id, itens: [{ item_id: it, quantidade: 1 }] })).status).toBe(409);
});

test('conta já facturada não se divide', async () => {
  const c = await contaFechada([{ produto_id: cuca, quantidade: 2 }]);
  expect((await call(A, 'post', '/api/financeiro/faturas', { pedido_id: c.id })).status).toBe(201);
  expect((await call(A, 'post', '/api/caixa/dividir', { pedido_id: c.id, itens: [{ item_id: c.itens[0].id, quantidade: 1 }] })).status).toBe(409);
});
