'use strict';
/**
 * Integração — 21/11/2026 (pedido do dono): o resumo do dia e o relatório de vendas contam o mesmo que as Finanças
 * (vendas pagas, pela data do pagamento). Antes contavam os pedidos FECHADOS e os números não batiam certo.
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, ipN = 1, prod;
const ip = () => `10.73.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const a = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${A.token}`).send(body);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });

async function pedidoFechado(valor) {
  const p = (await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: prod, quantidade: valor / 1000 }] })).body;
  expect((await a('patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' })).status).toBe(200);
  return p;
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-rel-pago' });
  prod = (await a('post', '/api/produtos', { nome: 'Prato', preco: 1000, categoria: 'CHURRASCO' })).body.id;
  expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
}, 60000);

test('só as contas pagas entram; o relatório, o resumo do dia e as Finanças dão os mesmos números', async () => {
  const pago1 = await pedidoFechado(3000);
  const pago2 = await pedidoFechado(5000);
  await pedidoFechado(7000); // fechado, ainda por pagar
  expect((await a('post', '/api/caixa/receber', { pedido_ids: [pago1.id], metodo: 'CASH', valor_entregue: 3000 })).status).toBe(200);
  expect((await a('post', '/api/caixa/receber', { pedido_ids: [pago2.id], metodo: 'TPA' })).status).toBe(200);
  // pedido de ontem pago hoje conta hoje
  const ontem = await pedidoFechado(2000);
  await pool.query(`UPDATE pedidos SET criado_em = criado_em - interval '1 day' WHERE id = $1`, [ontem.id]);
  expect((await a('post', '/api/caixa/receber', { pedido_ids: [ontem.id], metodo: 'CASH', valor_entregue: 2000 })).status).toBe(200);

  const d = hoje();
  const rel = (await a('get', `/api/relatorios/vendas?de=${d}&ate=${d}`)).body;
  const fin = (await a('get', `/api/financeiro/resultado?de=${d}&ate=${d}`)).body;
  const res = (await a('get', `/api/financeiro/resumo?data=${d}`)).body;

  expect(rel.totais.valor).toBe(10000);
  expect(rel.totais.pedidos).toBe(3);
  expect(rel.totais.por_receber).toBe(7000);
  expect(fin.receita.vendas).toBe(rel.totais.valor);
  expect(fin.receita.pedidos).toBe(rel.totais.pedidos);
  expect(fin.por_receber.valor).toBe(rel.totais.por_receber);
  expect(Number(res.pedidos.receita_total)).toBe(rel.totais.valor);
  expect(Number(res.pedidos.pedidos_pagos)).toBe(3);
  // as divisões por funcionário, produto e hora somam o mesmo total
  const soma = l => l.reduce((s, x) => s + Number(x.valor), 0);
  expect(soma(rel.por_funcionario)).toBe(10000);
  expect(soma(rel.por_produto)).toBe(10000);
  expect(soma(rel.por_hora)).toBe(10000);
  expect(res.por_categoria.reduce((s, x) => s + Number(x.total), 0)).toBe(10000);
});

test('uma conta registada como não paga e um cancelamento não contam como venda', async () => {
  const d = hoje();
  const antes = (await a('get', `/api/relatorios/vendas?de=${d}&ate=${d}`)).body.totais;
  const naoPaga = await pedidoFechado(4000);
  expect((await a('post', '/api/caixa/perdas', { pedido_ids: [naoPaga.id], motivo: 'Cliente saiu sem pagar a conta' })).status).toBe(200);
  const p = (await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: prod, quantidade: 1 }] })).body;
  expect((await a('patch', `/api/pedidos/${p.id}/status`, { status: 'CANCELADO', motivo: 'Engano' })).status).toBe(200);
  const depois = (await a('get', `/api/relatorios/vendas?de=${d}&ate=${d}`)).body.totais;
  expect(depois.valor).toBe(antes.valor);
  expect(depois.cancelados).toBe(antes.cancelados + 1);
});
