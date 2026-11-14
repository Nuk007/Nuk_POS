'use strict';
/**
 * Integração (PostgreSQL real) — rotas antigas passadas para a camada de serviço:
 * reservas, clientes, mesas e chamadas (isolamento, transacção e regras).
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, n = 1;
const ip = () => `10.11.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, metodo, url, corpo) => request(app)[metodo](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-svc-a' });
  B = await criarTenantFixture({ slug: 'it-svc-b' });
}, 60000);

describe('Reservas', () => {
  let q, rv;
  beforeAll(async () => {
    q = (await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria, status) VALUES ($1,'201','STANDARD',8000,25000,40000,'OCUPADO') RETURNING id`, [A.tenantId])).rows[0].id;
    rv = (await pool.query(
      `INSERT INTO reservas (tenant_id, quarto_id, nome_hospede, fracao, checkin, checkout, status, valor_total)
       VALUES ($1,$2,'Hóspede','PERNOITE',NOW(),NOW()+INTERVAL '12 hours','CHECKIN',25000) RETURNING id`, [A.tenantId, q])).rows[0].id;
  });
  test('lista só as do estabelecimento', async () => {
    expect((await call(A, 'get', '/api/reservas')).body.map(r => r.id)).toContain(rv);
    expect((await call(B, 'get', '/api/reservas')).body.map(r => r.id)).not.toContain(rv);
  });
  test('outro estabelecimento não muda a reserva (404); estado inválido 400', async () => {
    expect((await call(B, 'patch', `/api/reservas/${rv}/status`, { status: 'CHECKOUT' })).status).toBe(404);
    expect((await call(A, 'patch', `/api/reservas/${rv}/status`, { status: 'DORMIU' })).status).toBe(400);
  });
  test('CHECKOUT manda o quarto para arrumação', async () => {
    const r = await call(A, 'patch', `/api/reservas/${rv}/status`, { status: 'CHECKOUT' });
    expect(r.status).toBe(200);
    expect(r.body.status_anterior).toBe('CHECKIN');
    expect((await pool.query(`SELECT status FROM quartos WHERE id=$1`, [q])).rows[0].status).toBe('LIMPEZA');
  });
});

describe('Clientes', () => {
  test('cadastro normaliza o telefone; duplicado 409; inválido 400', async () => {
    const r = await call(A, 'post', '/api/clientes', { nome: ' Ana 100% ', telefone: '+244 923 000 111' });
    expect(r.status).toBe(201);
    expect(r.body.telefone).toBe('923000111');
    expect((await call(A, 'post', '/api/clientes', { nome: 'Outra', telefone: '923000111' })).status).toBe(409);
    expect((await call(A, 'post', '/api/clientes', { nome: 'X', telefone: '12' })).status).toBe(400);
    expect((await call(A, 'post', '/api/clientes', { nome: '  ' })).status).toBe(400);
  });
  test('pesquisa literal (% não é curinga), paginada e isolada', async () => {
    await call(A, 'post', '/api/clientes', { nome: 'Bruno' });
    const pct = (await call(A, 'get', '/api/clientes?q=%25')).body;
    expect(pct.data.map(c => c.nome)).toEqual(['Ana 100%']);
    const pag = (await call(A, 'get', '/api/clientes?limit=1&page=2')).body;
    expect([pag.page, pag.limit, pag.data.length]).toEqual([2, 1, 1]);
    expect(pag.total).toBeGreaterThanOrEqual(2);
    expect((await call(B, 'get', '/api/clientes?q=Ana')).body.total).toBe(0);
  });
});

describe('Mesas e chamadas', () => {
  let m;
  beforeAll(async () => {
    m = (await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,'S01',4) RETURNING id`, [A.tenantId])).rows[0].id;
  });
  test('estado da mesa: muda, isolado, e não fica LIVRE com conta por pagar', async () => {
    expect((await call(A, 'patch', `/api/mesas/${m}/status`, { status: 'OCUPADA' })).body.status).toBe('OCUPADA');
    expect((await call(B, 'patch', `/api/mesas/${m}/status`, { status: 'LIVRE' })).status).toBe(404);
    await pool.query(`INSERT INTO pedidos (tenant_id, mesa_id, status, total) VALUES ($1,$2,'FECHADO',1000)`, [A.tenantId, m]);
    const r = await call(A, 'patch', `/api/mesas/${m}/status`, { status: 'LIVRE' });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('CONTA_POR_PAGAR');
    expect((await call(A, 'get', '/api/mesas')).body.find(x => x.id === m)).toBeTruthy();
    expect((await call(B, 'get', '/api/mesas')).body.find(x => x.id === m)).toBeFalsy();
  });
  test('chamar e atender; outro estabelecimento não vê a mesa nem atende', async () => {
    expect((await call(B, 'post', '/api/chamadas', { mesa_id: m })).status).toBe(404);
    const c = await call(A, 'post', '/api/chamadas', { mesa_id: m, motivo: 'Conta' });
    expect(c.status).toBe(201);
    expect((await call(B, 'patch', `/api/chamadas/${c.body.id}/atender`)).status).toBe(404);
    const at = await call(A, 'patch', `/api/chamadas/${c.body.id}/atender`);
    expect(at.status).toBe(200);
    expect(at.body.atendido_em).toBeTruthy();
  });
});
