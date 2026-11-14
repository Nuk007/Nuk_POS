'use strict';
/** Integração (PostgreSQL real) — conta corrente de clientes: autorização, limite, consumo a crédito e liquidação. */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, OP, prod, empresa, semConta, n = 1;
const ip = () => `10.9.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].v);

async function pedidoFechado(T, qtd, cliente) {
  const p = await call(T, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: prod, quantidade: qtd }], ...(cliente ? { cliente_id: cliente } : {}) });
  expect(p.status).toBe(201);
  expect((await call(T, 'patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' })).status).toBe(200);
  return p.body;
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-cc-a' });
  B = await criarTenantFixture({ slug: 'it-cc-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Op','op@it-cc-a.ao',$2,'Caixa','OPERADOR') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  OP = { token: gerarToken({ id: op, email: 'op@it-cc-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
  prod = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Prato do dia',5000,'CHURRASCO',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
  const cli = nome => pool.query(`INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1,$2,$3) RETURNING id`, [A.tenantId, nome, '+2449' + String(Math.random()).slice(2, 10)]);
  empresa = (await cli('Empresa Lda')).rows[0].id;
  semConta = (await cli('Sem conta')).rows[0].id;
  expect((await call(A, 'post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
}, 60000);

describe('Autorização (só ADMIN)', () => {
  test('OPERADOR não autoriza (403); ADMIN autoriza com limite; outro estabelecimento não vê o cliente (404)', async () => {
    expect((await call(OP, 'put', `/api/caixa/conta-corrente/${empresa}`, { ativa: true, limite: 20000 })).status).toBe(403);
    expect((await call(A, 'put', `/api/caixa/conta-corrente/${empresa}`, { ativa: true, limite: -1 })).status).toBe(400);
    const r = await call(A, 'put', `/api/caixa/conta-corrente/${empresa}`, { ativa: true, limite: 20000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ conta_corrente_ativa: true, limite_credito: 20000 });
    expect((await call(B, 'put', `/api/caixa/conta-corrente/${empresa}`, { ativa: true, limite: 1 })).status).toBe(404);
    const lista = await call(OP, 'get', '/api/caixa/conta-corrente');
    expect(lista.body.find(c => c.id === empresa)).toMatchObject({ saldo: 0, disponivel: 20000 });
  });
});

describe('Consumo a crédito no Caixa', () => {
  test('cliente sem conta é recusado (409) e nada é gravado', async () => {
    const p = await pedidoFechado(A, 1, semConta);
    const r = await call(OP, 'post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CONTA' });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('SEM_CONTA_CORRENTE');
    expect((await pool.query(`SELECT pago_em FROM pedidos WHERE id=$1`, [p.id])).rows[0].pago_em).toBeNull();
  });

  test('conta corrente liberta o pedido, gera débito e não mexe no dinheiro da gaveta', async () => {
    const antes = (await call(A, 'get', '/api/caixa')).body.resumo.dinheiro_esperado;
    const p = await pedidoFechado(A, 2, empresa); // 10 000
    const r = await call(OP, 'post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CONTA' });
    expect(r.status).toBe(200);
    expect(r.body.metodo).toBe('CONTA');
    expect((await pool.query(`SELECT pago_metodo FROM pedidos WHERE id=$1`, [p.id])).rows[0].pago_metodo).toBe('CONTA');
    expect(await num(`SELECT COALESCE(SUM(valor),0) v FROM caixa_movimentos WHERE pedido_id=$1`, [p.id])).toBe(0);
    expect((await call(A, 'get', '/api/caixa')).body.resumo.dinheiro_esperado).toBe(antes);
    const x = await call(A, 'get', `/api/caixa/conta-corrente/${empresa}`);
    expect(x.body.cliente.saldo).toBe(10000);
    expect(x.body.movimentos[0]).toMatchObject({ tipo: 'DEBITO', valor: 10000, pedido_id: p.id, saldo_apos: 10000 });
  });

  test('limite: acima do disponível é recusado; misto (dinheiro + conta) cabe no limite', async () => {
    const p = await pedidoFechado(A, 3, empresa); // 15 000; disponível 10 000
    const r = await call(OP, 'post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CONTA' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ codigo: 'LIMITE_CREDITO', disponivel: 10000 });
    const m = await call(OP, 'post', '/api/caixa/receber', { pedido_ids: [p.id], pagamentos: [{ metodo: 'CASH', valor: 5000 }, { metodo: 'CONTA', valor: 10000, cliente_id: empresa }] });
    expect(m.status).toBe(200);
    expect(m.body.metodo).toBe('MISTO');
    expect(await num(`SELECT SUM(valor) v FROM caixa_movimentos WHERE pedido_id=$1`, [p.id])).toBe(5000);
    const l = (await call(A, 'get', '/api/caixa/conta-corrente')).body.find(c => c.id === empresa);
    expect(l).toMatchObject({ saldo: 20000, disponivel: 0 });
  });
});

describe('Liquidação', () => {
  test('pagamento parcial entra no caixa; não se paga mais do que a dívida; com caixa fechado → 409', async () => {
    const antes = (await call(A, 'get', '/api/caixa')).body.resumo.dinheiro_esperado;
    expect((await call(OP, 'post', `/api/caixa/conta-corrente/${empresa}/pagamentos`, { valor: 25000, metodo: 'CASH' })).status).toBe(409);
    expect((await call(OP, 'post', `/api/caixa/conta-corrente/${empresa}/pagamentos`, { valor: 1000, metodo: 'NUKCOIN' })).status).toBe(400);
    const r = await call(OP, 'post', `/api/caixa/conta-corrente/${empresa}/pagamentos`, { valor: 8000, metodo: 'CASH', observacoes: 'por conta' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ pago: 8000, saldo: 12000 });
    expect((await call(A, 'get', '/api/caixa')).body.resumo.dinheiro_esperado).toBe(antes + 8000);
    const t = await call(OP, 'post', `/api/caixa/conta-corrente/${empresa}/pagamentos`, { valor: 12000, metodo: 'TRANSFERENCIA' });
    expect(t.body.saldo).toBe(0);
    expect((await call(OP, 'post', `/api/caixa/conta-corrente/${empresa}/pagamentos`, { valor: 1, metodo: 'CASH' })).status).toBe(409);
    expect((await call(B, 'post', `/api/caixa/conta-corrente/${empresa}/pagamentos`, { valor: 1, metodo: 'CASH' })).status).toBe(409); // B tem o caixa fechado
  });

  test('retirar a conta mantém a dívida e bloqueia novos consumos a crédito', async () => {
    const p = await pedidoFechado(A, 1, empresa);
    expect((await call(OP, 'post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CONTA' })).status).toBe(200);
    expect((await call(A, 'put', `/api/caixa/conta-corrente/${empresa}`, { ativa: false })).status).toBe(200);
    const l = (await call(A, 'get', '/api/caixa/conta-corrente')).body.find(c => c.id === empresa);
    expect(l).toMatchObject({ conta_corrente_ativa: false, saldo: 5000, disponivel: 0 });
    const p2 = await pedidoFechado(A, 1, empresa);
    expect((await call(OP, 'post', '/api/caixa/receber', { pedido_ids: [p2.id], metodo: 'CONTA' })).status).toBe(409);
  });
});
