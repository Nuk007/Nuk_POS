'use strict';
/** Integração — fluxos de venda: número de mesas, Mesa/Balcão, Take Away, Remota (validação do caixa). */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, ipN = 1, cuca, shisha, pedra;
const ip = () => `10.55.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const pub = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug).send(body);
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const mesasDe = async T => (await pool.query(`SELECT numero, status FROM mesas WHERE tenant_id=$1 ORDER BY numero`, [T.tenantId])).rows;
async function novoCliente(sufixo) {
  const tel = '93' + String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 7);
  const r = await pub('post', '/api/cliente/cadastrar', { nome: 'Cli ' + sufixo, telefone: tel, pin: '1234', provincia: 'Luanda' });
  expect(r.status).toBe(201);
  return { ...r.body.cliente, telefone: tel, pin: '1234' };
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-fluxos' });
  B = await criarTenantFixture({ slug: 'it-fluxos-b' });
  await pool.query(`DELETE FROM mesas WHERE tenant_id = ANY($1)`, [[A.tenantId, B.tenantId]]);
  const ins = async (nome, preco, cat) => (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat])).rows[0].id;
  cuca = await ins('Cuca', 600, 'BEBIDA'); shisha = await ins('Shisha', 5000, 'SHISHA'); pedra = await ins('Maço', 1500, 'CIGARROS');
}, 60000);

describe('Número de mesas (Configurações)', () => {
  test('cria M01…M05 e depois M06 sem repetir nomes', async () => {
    expect((await a('put', '/api/mesas/quantidade', { quantidade: 5 })).body).toMatchObject({ quantidade: 5, criadas: 5, removidas: 0 });
    expect((await mesasDe(A)).map(m => m.numero)).toEqual(['M01', 'M02', 'M03', 'M04', 'M05']);
    expect((await a('put', '/api/mesas/quantidade', { quantidade: 6 })).body.criadas).toBe(1);
    expect((await a('get', '/api/mesas/quantidade')).body.quantidade).toBe(6);
  });
  test('valores inválidos → 400; sem ser ADMIN → 403; isolamento entre estabelecimentos', async () => {
    expect((await a('put', '/api/mesas/quantidade', { quantidade: -1 })).status).toBe(400);
    expect((await a('put', '/api/mesas/quantidade', { quantidade: 'x' })).status).toBe(400);
    expect((await a('put', '/api/mesas/quantidade', { quantidade: 999 })).status).toBe(400);
    const g = await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, nivel_acesso, ativo) VALUES ($1,'Op','op-fluxos@x.ao','x','OPERADOR',true) RETURNING id`, [A.tenantId]);
    const tok = require('jsonwebtoken').sign({ id: g.rows[0].id, tenant_id: A.tenantId, nivel_acesso: 'OPERADOR' }, process.env.JWT_SECRET);
    expect((await op({ token: tok }, 'put', '/api/mesas/quantidade', { quantidade: 2 })).status).toBe(403);
    expect(await mesasDe(B)).toHaveLength(0);
  });
  test('reduzir retira as mais altas; recusa (409) se uma estiver em uso ou com pedidos, sem mudar nada', async () => {
    const m6 = (await pool.query(`SELECT id FROM mesas WHERE tenant_id=$1 AND numero='M06'`, [A.tenantId])).rows[0].id;
    const p = await a('post', '/api/pedidos', { origem: 'MESA', mesa_id: m6, itens: [{ produto_id: cuca, quantidade: 1 }] });
    expect(p.status).toBe(201);
    const r = await a('put', '/api/mesas/quantidade', { quantidade: 4 });
    expect(r.status).toBe(409); expect(r.body.mesas).toContain('M06');
    expect(await mesasDe(A)).toHaveLength(6);
    await a('patch', `/api/pedidos/${p.body.id}/status`, { status: 'CANCELADO' });
    expect((await a('put', '/api/mesas/quantidade', { quantidade: 4 })).status).toBe(409); // M06 tem histórico
    await pool.query(`DELETE FROM itens_pedido WHERE pedido_id=$1`, [p.body.id]);
    await pool.query(`DELETE FROM movimentos_stock WHERE pedido_id=$1`, [p.body.id]);
    await pool.query(`DELETE FROM pedidos WHERE id=$1`, [p.body.id]);
    expect((await a('put', '/api/mesas/quantidade', { quantidade: 4 })).body).toMatchObject({ removidas: 2 });
    expect((await mesasDe(A)).map(m => m.numero)).toEqual(['M01', 'M02', 'M03', 'M04']);
  });
});

describe('Mesa e Balcão', () => {
  test('Mesa exige mesa_id e ocupa a mesa; Balcão ignora a mesa; origem REMOTA recusada ao operador', async () => {
    const item = [{ produto_id: cuca, quantidade: 2 }];
    expect((await a('post', '/api/pedidos', { origem: 'MESA', itens: item })).status).toBe(400);
    const m1 = (await pool.query(`SELECT id FROM mesas WHERE tenant_id=$1 AND numero='M01'`, [A.tenantId])).rows[0].id;
    const pm = await a('post', '/api/pedidos', { origem: 'MESA', mesa_id: m1, itens: item });
    expect(pm.status).toBe(201); expect(pm.body.origem).toBe('MESA'); expect(pm.body.validado_em).toBeTruthy();
    expect((await mesasDe(A)).find(m => m.numero === 'M01').status).toBe('OCUPADA');
    const pb = await a('post', '/api/pedidos', { origem: 'BALCAO', mesa_id: m1, itens: item });
    expect(pb.body.origem).toBe('BALCAO'); expect(pb.body.mesa_id).toBeNull();
    expect((await a('post', '/api/pedidos', { origem: 'REMOTA', itens: item })).status).toBe(400);
  });
});

describe('Take Away', () => {
  test('só cadastrados que já usaram o espaço; só comidas e bebidas', async () => {
    const item = [{ produto_id: cuca, quantidade: 1 }];
    expect((await a('post', '/api/pedidos', { origem: 'TAKEAWAY', itens: item })).status).toBe(400); // sem cliente
    const c = await novoCliente('ta');
    expect((await a('get', `/api/pedidos/takeaway/elegivel?cliente_id=${c.id}`)).body.elegivel).toBe(false);
    const nega = await a('post', '/api/pedidos', { origem: 'TAKEAWAY', cliente_id: c.id, itens: item });
    expect(nega.status).toBe(403);
    // passa a ter usado o espaço quando fecha um pedido
    const p = await pub('post', '/api/cliente/pedido-restaurante', { itens: item, cliente_id: c.id, metodo_pagamento: 'CASH' });
    await a('patch', `/api/pedidos/${p.body.pedido_id}/status`, { status: 'FECHADO' });
    expect((await a('get', `/api/pedidos/takeaway/elegivel?cliente_id=${c.id}`)).body.elegivel).toBe(true);
    const ok = await a('post', '/api/pedidos', { origem: 'TAKEAWAY', cliente_id: c.id, itens: item });
    expect(ok.status).toBe(201); expect(ok.body.origem).toBe('TAKEAWAY'); expect(ok.body.mesa_id).toBeNull();
    expect((await a('post', '/api/pedidos', { origem: 'TAKEAWAY', cliente_id: c.id, itens: [{ produto_id: shisha, quantidade: 1 }] })).status).toBe(400);
    expect((await a('post', '/api/pedidos', { origem: 'TAKEAWAY', cliente_id: c.id, itens: [{ produto_id: pedra, quantidade: 1 }] })).status).toBe(400);
  });
  test('cliente de outro estabelecimento não é elegível nem encontrado', async () => {
    const c = await novoCliente('ta-outro');
    expect((await op(B, 'get', `/api/pedidos/takeaway/elegivel?cliente_id=${c.id}`)).body.elegivel).toBe(false);
    expect((await op(B, 'post', '/api/pedidos', { origem: 'TAKEAWAY', cliente_id: c.id, itens: [{ produto_id: cuca, quantidade: 1 }] })).status).toBe(400);
  });
});

describe('Remota: o caixa valida os pedidos do QR', () => {
  test('pedido do portal chega por validar; validar tira-o da fila; recusar estorna o Nuk-Coin', async () => {
    const item = [{ produto_id: cuca, quantidade: 1 }];
    const guest = await pub('post', '/api/cliente/pedido-restaurante', { itens: item, metodo_pagamento: 'CASH' });
    expect(guest.status).toBe(201);
    let fila = (await a('get', '/api/pedidos/por-validar')).body;
    expect(fila.map(p => p.id)).toContain(guest.body.pedido_id);
    expect(fila.find(p => p.id === guest.body.pedido_id).origem).toBe('REMOTA');
    expect((await op(B, 'get', '/api/pedidos/por-validar')).body).toEqual([]);
    expect((await a('patch', `/api/pedidos/${guest.body.pedido_id}/status`, { status: 'EM_PREPARO' })).status).toBe(200);
    fila = (await a('get', '/api/pedidos/por-validar')).body;
    expect(fila.map(p => p.id)).not.toContain(guest.body.pedido_id);

    const c = await novoCliente('remota-coin');
    await a('post', '/api/cliente/nukcoin/carregar', { cliente_id: c.id, valor: 10000 });
    const pago = await pub('post', '/api/cliente/pedido-restaurante', { itens: item, cliente_id: c.id, metodo_pagamento: 'NUKCOIN', pin: c.pin });
    expect(pago.status).toBe(201);
    const saldoPago = Number((await pool.query('SELECT nukcoin_saldo FROM clientes WHERE id=$1', [c.id])).rows[0].nukcoin_saldo);
    expect(saldoPago).toBeLessThan(10000);
    expect((await a('patch', `/api/pedidos/${pago.body.pedido_id}/status`, { status: 'CANCELADO' })).status).toBe(200);
    expect(Number((await pool.query('SELECT nukcoin_saldo FROM clientes WHERE id=$1', [c.id])).rows[0].nukcoin_saldo)).toBe(10000);
    expect((await a('get', '/api/pedidos/por-validar')).body.map(p => p.id)).not.toContain(pago.body.pedido_id);
  });
});
