'use strict';
/**
 * Integração — limites de pedidos (revisão de 20/11/2026): vários aparelhos do mesmo estabelecimento saem pelo mesmo IP
 * e não se podem bloquear uns aos outros; o que protege contra adivinhar palavras-passe/PINs continua apertado.
 * Este ficheiro usa sempre o MESMO IP (os outros testes variam o IP de propósito).
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B;
const IP = '10.99.0.1';
const com = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', IP).set('Authorization', `Bearer ${T.token}`).send(body);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-limites-a' });
  B = await criarTenantFixture({ slug: 'it-limites-b' });
}, 60000);

test('400 leituras de duas contas pelo mesmo IP passam (antes o limite era 200 por IP em 15 min)', async () => {
  for (let i = 0; i < 200; i++) {
    const [ra, rb] = await Promise.all([com(A, 'get', '/api/caixa'), com(B, 'get', '/api/caixa')]);
    if (ra.status === 429 || rb.status === 429) throw new Error(`bloqueado ao pedido ${i}`);
  }
}, 120000);

test('um token inventado não abre um balde novo: conta pelo IP', async () => {
  const r = await request(app).get('/api/caixa').set('X-Forwarded-For', '10.99.0.2').set('Authorization', 'Bearer inventado.xx.yy');
  expect(r.status).toBe(401);
  expect(Number(r.headers['ratelimit-limit'])).toBe(1500);
  const ok = await com(A, 'get', '/api/caixa');
  expect(Number(ok.headers['ratelimit-limit'])).toBe(3000);
});

test('login: 10 falhas na mesma conta bloqueiam essa conta, não os colegas da mesma rede', async () => {
  const login = (email, password) => request(app).post('/api/auth/login').set('X-Forwarded-For', '10.99.0.3').send({ email, password });
  for (let i = 0; i < 10; i++) expect((await login(A.email, '000000')).status).toBe(401);
  expect((await login(A.email, '000000')).status).toBe(429);
  const colega = await login(B.email, B.password);
  expect(colega.status).toBe(200);
});

test('portal: as falhas de PIN de um cliente não bloqueiam os outros clientes do mesmo Wi-Fi', async () => {
  const pub = (url, body) => request(app).post(url).set('X-Forwarded-For', '10.99.0.4').set('X-Tenant-Slug', A.slug).send(body);
  for (let i = 0; i < 10; i++) await pub('/api/cliente/login', { telefone: '923000001', pin: '0000' });
  expect((await pub('/api/cliente/login', { telefone: '923000001', pin: '0000' })).status).toBe(429);
  expect((await pub('/api/cliente/login', { telefone: '923000002', pin: '0000' })).status).not.toBe(429);
  const r = await request(app).get('/api/cliente/cardapio').set('X-Forwarded-For', '10.99.0.4').set('X-Tenant-Slug', A.slug);
  expect(r.status).toBe(200);
});
