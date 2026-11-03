'use strict';
/** Integração — licença por módulos: o superadmin escolhe-os e o servidor/menu só dão o que foi contratado. */
const request = require('supertest');
const { app } = require('../../server/app');
const { limparCache } = require('../../server/middleware/modulos');

let T, ipN = 1;
const ip = () => `10.33.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const sa = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Superadmin-Key', process.env.SUPERADMIN_KEY).send(body);
const entrar = async () => (await request(app).post('/api/auth/login').set('X-Forwarded-For', ip()).send({ email: T.email, password: T.password })).body;
const com = (tok, url) => request(app).get(url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  T = await criarTenantFixture({ slug: 'it-lic' });
  await pool.query(`UPDATE funcionarios SET titular = true WHERE id = $1`, [T.userId]);
}, 60000);

describe('Superadmin escolhe os módulos', () => {
  test('catálogo e predefinições dos planos', async () => {
    const r = await sa('get', '/api/saas/modulos');
    expect(r.status).toBe(200);
    expect(r.body.modulos.map(m => m.chave)).toEqual(expect.arrayContaining(['restauracao', 'hospedagem', 'caixa', 'compras', 'rh', 'financas']));
    expect(r.body.planos.BASICO).toEqual(expect.arrayContaining(['restauracao']));
    expect(r.body.planos.BASICO).not.toContain('hospedagem');
  });
  test('rejeita lista vazia, desconhecida e módulo ainda não construído', async () => {
    expect((await sa('put', `/api/saas/tenants/${T.tenantId}/modulos`, { modulos: [] })).status).toBe(400);
    expect((await sa('put', `/api/saas/tenants/${T.tenantId}/modulos`, { modulos: ['voar'] })).status).toBe(400);
    expect((await sa('put', `/api/saas/tenants/${T.tenantId}/modulos`, { modulos: ['lazer'] })).status).toBe(400);
  });
  test('sem chave de superadmin → 401', async () => {
    expect((await request(app).put(`/api/saas/tenants/${T.tenantId}/modulos`).send({ modulos: ['rh'] })).status).toBe(401);
  });
  test('tenant inexistente → 404', async () => {
    expect((await sa('put', '/api/saas/tenants/00000000-0000-0000-0000-000000000000/modulos', { modulos: ['rh'] })).status).toBe(404);
  });
});

describe('O estabelecimento só recebe o que contratou', () => {
  test('só restauração: login devolve módulos e acessos filtrados; hospedagem → 403', async () => {
    expect((await sa('put', `/api/saas/tenants/${T.tenantId}/modulos`, { modulos: ['restauracao'] })).status).toBe(200);
    limparCache();
    const l = await entrar();
    expect(l.funcionario.modulos).toEqual(['restauracao']);
    expect(l.funcionario.permissoes).toEqual(expect.arrayContaining(['dashboard', 'pedidos', 'mesas', 'produtos', 'configuracoes']));
    expect(l.funcionario.permissoes).not.toContain('quartos');
    expect(l.funcionario.permissoes).not.toContain('financeiro');
    expect((await com(l.token, '/api/quartos')).status).toBe(403);
    expect((await com(l.token, '/api/financeiro/resumo')).status).toBe(403);
    expect((await com(l.token, '/api/mesas')).status).toBe(200);
  });
  test('acrescentar hospedagem abre os quartos; /auth/me reflecte a licença', async () => {
    await sa('put', `/api/saas/tenants/${T.tenantId}/modulos`, { modulos: ['restauracao', 'hospedagem'] });
    limparCache();
    const l = await entrar();
    expect((await com(l.token, '/api/quartos')).status).toBe(200);
    const me = await com(l.token, '/api/auth/me');
    expect((me.body.funcionario || me.body).modulos).toEqual(['restauracao', 'hospedagem']);
  });
  test('tenant sem lista (conta antiga) mantém tudo', async () => {
    await pool.query(`UPDATE tenants SET modulos = NULL WHERE id = $1`, [T.tenantId]);
    limparCache();
    const l = await entrar();
    expect((await com(l.token, '/api/quartos')).status).toBe(200);
    expect((await com(l.token, '/api/clientes')).status).not.toBe(403);
  });
});
