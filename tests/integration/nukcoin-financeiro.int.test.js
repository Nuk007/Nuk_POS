'use strict';
/**
 * Integração (PostgreSQL real) — dinheiro: Nuk-Coin, estornos, facturas e resumo financeiro.
 * Cada defeito aqui foi encontrado em teste manual com clientes virtuais; ficam como regressão.
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, ipN = 1;
const ip = () => `10.9.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const pub = (m, url, body, extra = {}) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug).set(extra).send(body);
const op = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${A.token}`).send(body);
const saldoDe = async c => Number((await pool.query('SELECT nukcoin_saldo FROM clientes WHERE id=$1', [c.id])).rows[0].nukcoin_saldo);

let cuca, picanha;
async function novoCliente(sufixo, pin = '1234') {
  const tel = '92' + String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 7);
  const r = await pub('post', '/api/cliente/cadastrar', { nome: 'Cliente ' + sufixo, telefone: tel, pin, provincia: 'Luanda' });
  expect(r.status).toBe(201);
  return { ...r.body.cliente, telefone: tel, pin };
}
const carregar = (c, v) => op('post', '/api/cliente/nukcoin/carregar', { cliente_id: c.id, valor: v });
const pagar = (c, itens, extra = {}) => pub('post', '/api/cliente/pedido-restaurante', { itens, cliente_id: c.id, metodo_pagamento: 'NUKCOIN', pin: c.pin, ...extra });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-money' });
  const ins = async (nome, preco, cat) => (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat])).rows[0].id;
  cuca = await ins('Cuca 33cl', 600, 'BEBIDA');
  picanha = await ins('Picanha', 4500, 'CHURRASCO');
}, 60000);

describe('Carteira Nuk-Coin', () => {
  test('10 carregamentos simultâneos não perdem dinheiro (saldo = soma do livro-razão)', async () => {
    const c = await novoCliente('race');
    await Promise.all(Array.from({ length: 10 }, () => carregar(c, 5000)));
    expect(await saldoDe(c)).toBe(50000);
    const soma = (await pool.query(`SELECT SUM(valor) s FROM movimentos_nukcoin WHERE cliente_id=$1`, [c.id])).rows[0].s;
    expect(Number(soma)).toBe(50000);
  });

  test('só um operador autenticado carrega; valores fora da lista são recusados', async () => {
    const c = await novoCliente('valores');
    expect((await pub('post', '/api/cliente/nukcoin/carregar', { cliente_id: c.id, valor: 5000 })).status).toBe(401);
    expect((await carregar(c, 1234)).status).toBe(400);
  });

  test('pagar exige o PIN: sem PIN ou com PIN errado → 401 e nada é debitado', async () => {
    const c = await novoCliente('pin'); await carregar(c, 10000);
    const item = [{ produto_id: cuca, quantidade: 1 }];
    expect((await pub('post', '/api/cliente/pedido-restaurante', { itens: item, cliente_id: c.id, metodo_pagamento: 'NUKCOIN' })).status).toBe(401);
    expect((await pagar({ ...c, pin: '9999' }, item)).status).toBe(401);
    expect(await saldoDe(c)).toBe(10000);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM pedidos WHERE cliente_id=$1`, [c.id])).rows[0].count)).toBe(0);
  });

  test('definir-pin nunca substitui um PIN existente (sem tomada de conta)', async () => {
    const c = await novoCliente('takeover');
    expect((await pub('post', '/api/cliente/definir-pin', { telefone: c.telefone, pin: '0000' })).status).toBe(403);
    expect((await pub('post', '/api/cliente/login', { telefone: c.telefone, pin: '1234' })).status).toBe(200);
  });

  test('reposição do PIN só por operador; depois o cliente define um novo', async () => {
    const c = await novoCliente('reset');
    expect((await pub('post', '/api/cliente/reset-pin', { cliente_id: c.id })).status).toBe(401);
    expect((await op('post', '/api/cliente/reset-pin', { cliente_id: c.id })).status).toBe(200);
    expect((await pub('post', '/api/cliente/definir-pin', { telefone: c.telefone, pin: '4321' })).status).toBe(200);
    expect((await pub('post', '/api/cliente/login', { telefone: c.telefone, pin: '1234' })).status).toBe(401);
  });

  test('perfil e histórico exigem o PIN', async () => {
    const c = await novoCliente('privado');
    expect((await pub('post', '/api/cliente/perfil', { telefone: c.telefone })).status).toBeGreaterThanOrEqual(400);
    expect((await pub('post', '/api/cliente/perfil', { telefone: c.telefone, pin: c.pin })).status).toBe(200);
    expect((await pub('get', `/api/cliente/nukcoin/historico?cliente_id=${c.id}`)).status).toBe(401);
    expect((await pub('get', `/api/cliente/nukcoin/historico?cliente_id=${c.id}`, undefined, { 'X-Cliente-Pin': c.pin })).status).toBe(200);
  });

  test('duplo gasto: 8 pedidos simultâneos nunca deixam o saldo negativo e o livro-razão fecha', async () => {
    const c = await novoCliente('duplo'); await carregar(c, 50000);
    const rs = await Promise.all(Array.from({ length: 8 }, () => pagar(c, [{ produto_id: picanha, quantidade: 2 }]))); // 9000 − 10% = 8100
    const ok = rs.filter(r => r.status === 201).length;
    expect(ok).toBe(6);
    expect(await saldoDe(c)).toBe(50000 - ok * 8100);
    const mov = (await pool.query(`SELECT tipo, SUM(valor) s FROM movimentos_nukcoin WHERE cliente_id=$1 GROUP BY tipo`, [c.id])).rows;
    const por = Object.fromEntries(mov.map(m => [m.tipo, Number(m.s)]));
    expect(por.CARREGAMENTO - por.CONSUMO).toBe(await saldoDe(c));
  });

  test('o pedido e o débito são atómicos: produto inválido rejeita tudo (nada cobrado)', async () => {
    const c = await novoCliente('atomico'); await carregar(c, 10000);
    const r = await pagar(c, [{ produto_id: cuca, quantidade: 1 }, { produto_id: '00000000-0000-4000-8000-000000000000', quantidade: 1 }]);
    expect(r.status).toBe(400);
    expect(await saldoDe(c)).toBe(10000);
  });

  test('desconto de estrelas consome as estrelas usadas', async () => {
    const c = await novoCliente('estrelas'); await carregar(c, 25000);
    await pool.query(`UPDATE clientes SET estrelas = 5 WHERE id=$1`, [c.id]);
    const r = await pagar(c, [{ produto_id: picanha, quantidade: 2 }]); // 9000 − 20% = 7200
    expect(r.status).toBe(201);
    expect(Math.round(r.body.total_final)).toBe(7200);
    expect((await pool.query(`SELECT estrelas FROM clientes WHERE id=$1`, [c.id])).rows[0].estrelas).toBe(0);
  });
});

describe('Desconto de estrelas em dinheiro vivo', () => {
  test('CASH com PIN aplica 20% e consome as estrelas; sem PIN cobra o preço cheio e não toca nas estrelas', async () => {
    const c = await novoCliente('estrelas-cash');
    await pool.query(`UPDATE clientes SET estrelas = 5 WHERE id=$1`, [c.id]);
    const item = [{ produto_id: picanha, quantidade: 2 }]; // 9000
    const semPin = await pub('post', '/api/cliente/pedido-restaurante', { itens: item, cliente_id: c.id, metodo_pagamento: 'CASH' });
    expect(Math.round(semPin.body.total_final)).toBe(9000);
    expect((await pool.query(`SELECT estrelas FROM clientes WHERE id=$1`, [c.id])).rows[0].estrelas).toBe(5);
    const comPin = await pub('post', '/api/cliente/pedido-restaurante', { itens: item, cliente_id: c.id, metodo_pagamento: 'CASH', pin: c.pin });
    expect(Math.round(comPin.body.total_final)).toBe(7200);
    expect((await pool.query(`SELECT estrelas FROM clientes WHERE id=$1`, [c.id])).rows[0].estrelas).toBe(0);
  });
});

describe('Cancelamento e ciclo de vida do pedido', () => {
  test('cancelar um pedido pago com Nuk-Coin estorna uma única vez', async () => {
    const c = await novoCliente('estorno'); await carregar(c, 10000);
    const p = await pagar(c, [{ produto_id: cuca, quantidade: 2 }]); // 1080
    expect(await saldoDe(c)).toBe(10000 - 1080);
    expect((await op('patch', `/api/pedidos/${p.body.pedido_id}/status`, { status: 'CANCELADO' })).status).toBe(200);
    expect(await saldoDe(c)).toBe(10000);
    expect((await op('patch', `/api/pedidos/${p.body.pedido_id}/status`, { status: 'CANCELADO' })).status).toBe(200); // idempotente
    expect(await saldoDe(c)).toBe(10000);
    const est = await pool.query(`SELECT COUNT(*) FROM movimentos_nukcoin WHERE pedido_id=$1 AND tipo='ESTORNO'`, [p.body.pedido_id]);
    expect(Number(est.rows[0].count)).toBe(1);
  });

  test('FECHADO e CANCELADO são estados finais (409)', async () => {
    const c = await novoCliente('final');
    const p = await pub('post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cuca, quantidade: 1 }], cliente_id: c.id, metodo_pagamento: 'CASH' });
    await op('patch', `/api/pedidos/${p.body.pedido_id}/status`, { status: 'FECHADO' });
    expect((await op('patch', `/api/pedidos/${p.body.pedido_id}/status`, { status: 'ABERTO' })).status).toBe(409);
  });
});

describe('Facturas e resumo financeiro', () => {
  let fechado, cancelado;
  beforeAll(async () => {
    const c = await novoCliente('fin');
    const mk = async qtd => (await pub('post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cuca, quantidade: qtd }], cliente_id: c.id, metodo_pagamento: 'CASH' })).body.pedido_id;
    fechado = await mk(3); cancelado = await mk(5);
    await op('patch', `/api/pedidos/${fechado}/status`, { status: 'FECHADO' });
    await op('patch', `/api/pedidos/${cancelado}/status`, { status: 'CANCELADO' });
  });

  test('receita só conta pedidos FECHADOS e "itens vendidos" são unidades', async () => {
    const r = await op('get', '/api/financeiro/resumo');
    const ped = (await pool.query(`SELECT COALESCE(SUM(total) FILTER (WHERE status='FECHADO'),0) t FROM pedidos WHERE tenant_id=$1`, [A.tenantId])).rows[0].t;
    expect(Number(r.body.pedidos.receita_total)).toBe(Number(ped));
    expect(Number(r.body.pedidos.pedidos_cancelados)).toBeGreaterThanOrEqual(1);
    const bebida = r.body.por_categoria.find(x => x.categoria === 'BEBIDA');
    const esperado = (await pool.query(
      `SELECT COALESCE(SUM(ip.quantidade),0) q FROM itens_pedido ip JOIN pedidos p ON p.id=ip.pedido_id JOIN produtos pr ON pr.id=ip.produto_id
       WHERE p.tenant_id=$1 AND p.status='FECHADO' AND pr.categoria='BEBIDA'`, [A.tenantId])).rows[0].q;
    expect(Number(bebida.itens_vendidos)).toBe(Number(esperado)); // unidades (3 numa só linha), nunca linhas; cancelados fora
    expect(Number(esperado)).toBeGreaterThanOrEqual(3);
  });

  test('o "dia" do resumo é o de Luanda (UTC+1), não o UTC', async () => {
    const hojeLuanda = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
    expect((await op('get', '/api/financeiro/resumo')).body.data).toBe(hojeLuanda);
  });

  test('factura: só pedido FECHADO, uma por pedido', async () => {
    expect((await op('post', '/api/financeiro/faturas', { pedido_id: cancelado })).status).toBe(409);
    expect((await op('post', '/api/financeiro/faturas', { pedido_id: fechado })).status).toBe(201);
    expect((await op('post', '/api/financeiro/faturas', { pedido_id: fechado })).status).toBe(409);
  });

  test('8 facturas simultâneas: numeração única e sem buracos', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => op('post', '/api/financeiro/faturas', { total_manual: 1000 })));
    expect(rs.every(r => r.status === 201)).toBe(true);
    const seq = (await pool.query(`SELECT sequencial FROM faturas WHERE tenant_id=$1 ORDER BY sequencial`, [A.tenantId])).rows.map(r => r.sequencial);
    expect(seq).toEqual(seq.map((_, i) => i + 1));
  });
});
