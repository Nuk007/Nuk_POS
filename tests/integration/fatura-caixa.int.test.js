'use strict';
/**
 * Integração (PostgreSQL real) — factura-recibo emitida no Caixa: um documento para a conta inteira da mesa.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, OP, prodA, prodA2, n = 1;
const ip = () => `10.9.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, metodo, url, corpo) => request(app)[metodo](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);

async function pedido(T, itens, { pago = true, status = 'FECHADO' } = {}) {
  const tot = itens.reduce((s, [, q, p]) => s + q * p, 0);
  const id = (await pool.query(
    `INSERT INTO pedidos (tenant_id, status, total, metodo_pagamento, pago_em) VALUES ($1,$2,$3,'TPA',$4) RETURNING id`,
    [T.tenantId, status, tot, pago ? new Date() : null])).rows[0].id;
  for (const [prod, q, p] of itens) {
    await pool.query(`INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES ($1,$2,$3,$4)`, [id, prod, q, p]);
  }
  return id;
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-fatcx-a' });
  B = await criarTenantFixture({ slug: 'it-fatcx-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(
    `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Operador','op@it-fatcx-a.ao',$2,'Caixa','OPERADOR') RETURNING id`,
    [A.tenantId, hash])).rows[0].id;
  OP = { token: gerarToken({ id: op, email: 'op@it-fatcx-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
  const ins = (t, nome, preco) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,'CHURRASCO',true,true) RETURNING id`, [t, nome, preco]);
  prodA = (await ins(A.tenantId, 'Picanha', 4500)).rows[0].id;
  prodA2 = (await ins(A.tenantId, 'Cerveja', 800)).rows[0].id;
}, 60000);

test('uma FR para dois pedidos da mesma mesa: linhas juntas por produto, total = soma, ligação aos dois', async () => {
  const p1 = await pedido(A, [[prodA, 1, 4500], [prodA2, 2, 800]]);
  const p2 = await pedido(A, [[prodA2, 3, 800]]);
  const r = await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: [p1, p2], nif_cliente: '5417000000', nome_cliente: 'Mesa 3' });
  expect(r.status).toBe(201);
  expect(r.body.tipo_documento).toBe('FR');
  expect(Number(r.body.total)).toBe(4500 + 1600 + 2400);
  const cerveja = r.body.linhas.find(l => l.descricao === 'Cerveja');
  expect(Number(cerveja.quantidade)).toBe(5);
  expect(r.body.linhas).toHaveLength(2);
  const lig = (await pool.query(`SELECT pedido_id FROM fatura_pedidos WHERE fatura_id = $1`, [r.body.id])).rows.map(x => x.pedido_id).sort();
  expect(lig).toEqual([p1, p2].sort());

  // nenhum dos dois volta a facturar-se, nem pela via antiga de Finanças
  const de = await call(A, 'post', '/api/financeiro/faturas', { pedido_id: p2 });
  expect(de.status).toBe(409);
  // e a conta facturada já não se divide
  const it = (await pool.query(`SELECT id FROM itens_pedido WHERE pedido_id = $1`, [p2])).rows[0].id;
  await pool.query(`UPDATE pedidos SET pago_em = NULL WHERE id = $1`, [p2]);
  const dv = await call(OP, 'post', '/api/caixa/dividir', { pedido_id: p2, itens: [{ item_id: it, quantidade: 1 }] });
  expect(dv.status).toBe(409);

  const pdf = await call(OP, 'get', `/api/caixa/faturas/${r.body.id}/pdf`);
  expect(pdf.status).toBe(200);
  expect(pdf.headers['content-type']).toMatch(/pdf/);
});

test('depois da nota de crédito, a conta pode facturar-se de novo (ex.: NIF corrigido)', async () => {
  const p1 = await pedido(A, [[prodA, 1, 4500]]);
  const p2 = await pedido(A, [[prodA2, 1, 800]]);
  const r = await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: [p1, p2] });
  expect(r.status).toBe(201);
  const nc = await call(A, 'post', `/api/financeiro/faturas/${r.body.id}/nota-credito`, { motivo: 'NIF do cliente errado' });
  expect(nc.status).toBe(201);
  const de = await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: [p1, p2], nif_cliente: '5417000001' });
  expect(de.status).toBe(201);
});

test('recusas: conta por receber, pedido aberto, pedido de outro estabelecimento, lista vazia ou inválida', async () => {
  const porReceber = await pedido(A, [[prodA, 1, 4500]], { pago: false });
  expect((await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: [porReceber] })).status).toBe(409);
  const aberto = await pedido(A, [[prodA, 1, 4500]], { status: 'ABERTO', pago: false });
  expect((await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: [aberto] })).status).toBe(409);
  const doA = await pedido(A, [[prodA, 1, 4500]]);
  expect((await call(B, 'post', '/api/caixa/faturar', { pedido_ids: [doA] })).status).toBe(404);
  expect((await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: [] })).status).toBe(400);
  expect((await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: ['x'] })).status).toBe(400);
  expect((await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: [doA], nif_cliente: '!!' })).status).toBe(400);
  // nada ficou gravado pelas recusas
  const docs = (await pool.query(`SELECT COUNT(*)::int AS n FROM fatura_pedidos WHERE pedido_id = ANY($1::uuid[])`, [[porReceber, aberto, doA]])).rows[0].n;
  expect(docs).toBe(0);
});

test('a ligação documento–pedidos é imutável', async () => {
  const p = await pedido(A, [[prodA, 1, 4500]]);
  const r = await call(OP, 'post', '/api/caixa/faturar', { pedido_ids: [p] });
  expect(r.status).toBe(201);
  await expect(pool.query(`DELETE FROM fatura_pedidos WHERE fatura_id = $1`, [r.body.id])).rejects.toThrow();
});
