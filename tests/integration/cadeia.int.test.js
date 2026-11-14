'use strict';
/**
 * Integração (PostgreSQL real) — cadeia de estabelecimentos: login com o mesmo email em vários, troca com a
 * palavra-passe da conta de destino e consolidado só da mesma cadeia e só onde se é ADMIN.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, C, n = 1;
const EMAIL = 'dono@cadeia-it.ao';
const ip = () => `10.16.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const com = (token, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${token}`).send(body);
const sa = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Superadmin-Key', process.env.SUPERADMIN_KEY).send(body);
const ONTEM = new Date(Date.now() - 86400e3 + 3600e3).toISOString().slice(0, 10);

async function dono(T, senha, nivel = 'ADMIN') {
  const id = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Dono',$2,$3,'Dono',$4) RETURNING id`,
    [T.tenantId, EMAIL, await bcrypt.hash(senha, 4), nivel])).rows[0].id;
  return gerarToken({ id, email: EMAIL, nivel_acesso: nivel, tenantId: T.tenantId });
}
async function venda(T, total) {
  await pool.query(`INSERT INTO pedidos (tenant_id, status, total, pago_em, criado_em) VALUES ($1,'FECHADO',$2,$3,$3)`, [T.tenantId, total, `${ONTEM}T12:00:00+01:00`]);
}

let tA, tB, tC;
beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-cad-a' });
  B = await criarTenantFixture({ slug: 'it-cad-b' });
  C = await criarTenantFixture({ slug: 'it-cad-c' });
  tA = await dono(A, '111111');
  tB = await dono(B, '222222');
  tC = await dono(C, '333333', 'GERENTE');
  await venda(A, 10000); await venda(B, 7000); await venda(C, 999);
}, 60000);

test('login: o mesmo email entra no estabelecimento cuja palavra-passe confere (antes só via a primeira conta)', async () => {
  const b = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip()).send({ email: EMAIL, password: '222222' });
  expect(b.status).toBe(200);
  expect(b.body.funcionario.tenant_slug).toBe('it-cad-b');
  const a = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip()).send({ email: EMAIL.toUpperCase(), password: '111111' });
  expect(a.body.funcionario.tenant_slug).toBe('it-cad-a');
  expect((await request(app).post('/api/auth/login').set('X-Forwarded-For', ip()).send({ email: EMAIL, password: '999999' })).status).toBe(401);
});

test('lista e troca: palavra-passe da conta de destino; errada → 403 (não 401)', async () => {
  const l = (await com(tA, 'get', '/api/cadeia/estabelecimentos')).body;
  expect(l.estabelecimentos.map(e => e.slug).sort()).toEqual(['it-cad-a', 'it-cad-b', 'it-cad-c']);
  expect(l.estabelecimentos.find(e => e.actual).slug).toBe('it-cad-a');
  expect((await com(tA, 'post', '/api/cadeia/trocar', { tenant_id: B.tenantId, palavra_passe: '111111' })).status).toBe(403);
  const ok = await com(tA, 'post', '/api/cadeia/trocar', { tenant_id: B.tenantId, palavra_passe: '222222' });
  expect(ok.status).toBe(200);
  expect(ok.body.funcionario.tenant_slug).toBe('it-cad-b');
  // o token novo serve no estabelecimento B
  expect((await com(ok.body.token, 'get', '/api/cadeia/estabelecimentos')).body.actual).toBe(B.tenantId);
  // estabelecimento onde não tem conta → 404
  expect((await com(A.token, 'post', '/api/cadeia/trocar', { tenant_id: B.tenantId, palavra_passe: 'Senha@123' })).status).toBe(404);
});

test('consolidado: só com cadeia, só ADMIN, só estabelecimentos da cadeia onde também é ADMIN', async () => {
  expect((await com(tA, 'get', `/api/cadeia/consolidado?de=${ONTEM}&ate=${ONTEM}`)).status).toBe(409);
  for (const T of [A, B, C]) expect((await sa('put', `/api/saas/tenants/${T.tenantId}/cadeia`, { nome: 'Grupo Teste IT' })).status).toBe(200);
  const cad = (await sa('get', '/api/saas/cadeias')).body.find(g => g.nome === 'Grupo Teste IT');
  expect(cad.estabelecimentos).toBe(3);
  const r = await com(tA, 'get', `/api/cadeia/consolidado?de=${ONTEM}&ate=${ONTEM}`);
  expect(r.status).toBe(200);
  expect(r.body.estabelecimentos.map(e => e.receita).sort((x, y) => x - y)).toEqual([7000, 10000]); // C fica de fora (é GERENTE lá)
  expect(r.body.total.receita).toBe(17000);
  expect((await com(tC, 'get', `/api/cadeia/consolidado?de=${ONTEM}&ate=${ONTEM}`)).status).toBe(403);
  // tirar B da cadeia tira-o do consolidado
  await sa('put', `/api/saas/tenants/${B.tenantId}/cadeia`, { nome: '' });
  expect((await com(tA, 'get', `/api/cadeia/consolidado?de=${ONTEM}&ate=${ONTEM}`)).body.total.receita).toBe(10000);
});
