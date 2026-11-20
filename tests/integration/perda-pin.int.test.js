'use strict';
/**
 * Integração — (1) conta não paga registada pela chefia (cliente saiu sem pagar) e (2) bloqueio do PIN do portal
 * gravado por cliente (20/11/2026).
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');

let A, OP, ipN = 1, cuca, mesa;
const ip = () => `10.70.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const pub = (m, url, body, h = {}) => { let r = request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug); for (const [k, v] of Object.entries(h)) r = r.set(k, v); return r.send(body); };

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-perda-pin' });
  const { gerarToken } = require('../../server/middleware/auth');
  const f = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso, ativo) VALUES ($1,'Operador','op-perda@x.ao','x','Caixa','OPERADOR',true) RETURNING id, email, nivel_acesso`, [A.tenantId])).rows[0];
  OP = { token: gerarToken({ id: f.id, email: f.email, nivel_acesso: f.nivel_acesso, tenantId: A.tenantId }) };
  cuca = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',600,'BEBIDA',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
  mesa = (await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,'M01',4) RETURNING id`, [A.tenantId])).rows[0].id;
  expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
}, 60000);

describe('Cliente saiu sem pagar', () => {
  let pid;
  test('só a chefia, com motivo; a conta deixa de estar por pagar, a mesa fica livre e o caixa fecha', async () => {
    pid = (await a('post', '/api/pedidos', { origem: 'MESA', mesa_id: mesa, itens: [{ produto_id: cuca, quantidade: 3 }] })).body.id;
    expect((await a('get', '/api/caixa')).body.pendencias.n).toBe(1);
    expect((await op(OP, 'post', '/api/caixa/perdas', { pedido_ids: [pid], motivo: 'Saiu sem pagar a mesa' })).status).toBe(403);
    expect((await a('post', '/api/caixa/perdas', { pedido_ids: [pid], motivo: 'curto' })).status).toBe(400);
    const r = await a('post', '/api/caixa/perdas', { pedido_ids: [pid], motivo: 'Cliente da mesa 1 saiu sem pagar' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ contas: 1, total: 1800 });
    const p = (await pool.query(`SELECT status, perda_em, perda_motivo, pago_em FROM pedidos WHERE id = $1`, [pid])).rows[0];
    expect(p.status).toBe('FECHADO'); expect(p.perda_em).toBeTruthy(); expect(p.pago_em).toBeNull();
    expect((await pool.query(`SELECT status FROM mesas WHERE id = $1`, [mesa])).rows[0].status).toBe('LIVRE');
    expect((await a('get', '/api/caixa')).body.pendencias.n).toBe(0);
    expect((await a('get', '/api/caixa/por-receber')).body.find(x => x.id === pid)).toBeUndefined();
  });
  test('selada: não se regista duas vezes, não se recebe, não se cancela, nem por fora do sistema', async () => {
    expect((await a('post', '/api/caixa/perdas', { pedido_ids: [pid], motivo: 'Outra vez a mesma conta' })).status).toBe(409);
    const rr = await a('post', '/api/caixa/receber', { pedido_ids: [pid], metodo: 'TPA' });
    expect(rr.status).toBe(409); expect(rr.body.codigo).toBe('CONTA_NAO_PAGA');
    await expect(pool.query(`UPDATE pedidos SET pago_em = NOW() WHERE id = $1`, [pid])).rejects.toThrow(/não paga/);
    await expect(pool.query(`UPDATE pedidos SET perda_motivo = 'mudado' WHERE id = $1`, [pid])).rejects.toThrow(/não paga/);
  });
  test('aparece nos Relatórios como conta não paga, com quem registou e o motivo', async () => {
    const r = await a('get', '/api/relatorios/vendas');
    expect(r.status).toBe(200);
    expect(r.body.valor_perdas).toBe(1800);
    expect(r.body.perdas[0]).toMatchObject({ perda_motivo: 'Cliente da mesa 1 saiu sem pagar', mesa: 'M01' });
    expect(r.body.totais.por_receber).toBe(0);
  });
  test('o caixa fecha sem contas por pagar', async () => {
    expect((await a('post', '/api/caixa/fechar', { contado: 0 })).status).toBe(200);
    expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
  });
});

describe('PIN do portal: bloqueio gravado no cliente', () => {
  let cli;
  const tel = '923456781';
  beforeAll(async () => {
    cli = (await pool.query(`INSERT INTO clientes (tenant_id, nome, telefone, provincia, ativo, pin_hash, nukcoin_saldo) VALUES ($1,'Cliente PIN',$2,'Luanda',true,$3,10000) RETURNING id`, [A.tenantId, tel, await bcrypt.hash('1234', 4)])).rows[0];
  });
  test('5 falhas (de IPs diferentes) bloqueiam o PIN 15 min; nem o PIN certo entra; a chefia desbloqueia ao repor', async () => {
    for (let i = 0; i < 4; i++) expect((await pub('post', '/api/cliente/login', { telefone: tel, pin: '0000' })).status).toBe(401);
    const quinta = await pub('post', '/api/cliente/login', { telefone: tel, pin: '0000' });
    expect(quinta.status).toBe(401); expect(quinta.body.codigo).toBe('PIN_BLOQUEADO'); expect(quinta.body.pinFalhou).toBeUndefined();
    const certo = await pub('post', '/api/cliente/login', { telefone: tel, pin: '1234' });
    expect(certo.status).toBe(423); expect(certo.body.codigo).toBe('PIN_BLOQUEADO');
    // histórico e Nuk-Coin também respeitam o bloqueio
    expect((await pub('get', `/api/cliente/nukcoin/historico?cliente_id=${cli.id}`, undefined, { 'X-Cliente-Pin': '1234' })).status).toBe(423);
    expect((await pub('post', '/api/cliente/pedido-restaurante', { cliente_id: cli.id, pin: '1234', metodo_pagamento: 'NUKCOIN', itens: [{ produto_id: cuca, quantidade: 1 }] })).status).toBe(423);
    const b = (await pool.query(`SELECT pin_bloqueios, pin_bloqueado_ate FROM clientes WHERE id = $1`, [cli.id])).rows[0];
    expect(b.pin_bloqueios).toBe(1);
    const min = (new Date(b.pin_bloqueado_ate) - Date.now()) / 60000;
    expect(min).toBeGreaterThan(14); expect(min).toBeLessThanOrEqual(15.1);
    expect((await a('post', '/api/cliente/reset-pin', { cliente_id: cli.id })).status).toBe(200);
    const d = (await pool.query(`SELECT pin_falhas, pin_bloqueios, pin_bloqueado_ate, pin_hash FROM clientes WHERE id = $1`, [cli.id])).rows[0];
    expect(d).toMatchObject({ pin_falhas: 0, pin_bloqueios: 0, pin_bloqueado_ate: null, pin_hash: null });
  });
  test('Nuk-Coin com PIN errado no portal e no Caixa conta (a transacção é desfeita mas a falha fica); PIN certo limpa', async () => {
    await pool.query(`UPDATE clientes SET pin_hash = $2 WHERE id = $1`, [cli.id, await bcrypt.hash('1234', 4)]);
    const rp = await pub('post', '/api/cliente/pedido-restaurante', { cliente_id: cli.id, pin: '9999', metodo_pagamento: 'NUKCOIN', itens: [{ produto_id: cuca, quantidade: 1 }] });
    expect(rp.status).toBe(401);
    const p = (await a('post', '/api/pedidos', { origem: 'BALCAO', cliente_id: cli.id, itens: [{ produto_id: cuca, quantidade: 1 }] })).body;
    await a('patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' });
    const rc = await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'NUKCOIN', pin: '9999' });
    expect(rc.status).toBe(403); expect(rc.body.pinFalhou).toBeUndefined();
    expect((await pool.query(`SELECT pin_falhas FROM clientes WHERE id = $1`, [cli.id])).rows[0].pin_falhas).toBe(2);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'NUKCOIN', pin: '1234' })).status).toBe(200);
    expect((await pool.query(`SELECT pin_falhas FROM clientes WHERE id = $1`, [cli.id])).rows[0].pin_falhas).toBe(0);
  });
  test('o segundo bloqueio dura o dobro (30 min)', async () => {
    await pool.query(`UPDATE clientes SET pin_bloqueios = 1, pin_falhas = 4 WHERE id = $1`, [cli.id]);
    await pub('post', '/api/cliente/login', { telefone: tel, pin: '0000' });
    const b = (await pool.query(`SELECT pin_bloqueado_ate FROM clientes WHERE id = $1`, [cli.id])).rows[0];
    const min = (new Date(b.pin_bloqueado_ate) - Date.now()) / 60000;
    expect(min).toBeGreaterThan(29); expect(min).toBeLessThanOrEqual(30.1);
  });
});
