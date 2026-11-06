'use strict';
/** Integração (PostgreSQL real) — morada, NIF e telefone do estabelecimento nas Configurações. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, n = 1;
const auth = (T, m, url) => request(app)[m](url).set('X-Forwarded-For', `10.9.0.${n++}`).set('Authorization', `Bearer ${T.token}`);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-cfgc-a' });
  B = await criarTenantFixture({ slug: 'it-cfgc-b' });
}, 60000);

describe('Configurações — contactos do estabelecimento', () => {
  test('guarda morada, NIF e telefone e devolve-os só ao próprio estabelecimento', async () => {
    const corpo = { morada: 'Rua da Missão 12, Maianga, Luanda', nif_empresa: '5417000000', telefone: '+244 923 125 060' };
    expect((await auth(A, 'put', '/api/configuracoes').send(corpo)).status).toBe(200);
    const a = await auth(A, 'get', '/api/configuracoes');
    expect(a.body).toMatchObject(corpo);
    const b = await auth(B, 'get', '/api/configuracoes');
    expect(b.body.nif_empresa).toBeUndefined();
  });
  test('espaços à volta são cortados e vazio apaga o valor', async () => {
    await auth(A, 'put', '/api/configuracoes').send({ morada: '  Rua X  ', telefone: '' });
    const a = await auth(A, 'get', '/api/configuracoes');
    expect(a.body.morada).toBe('Rua X');
    expect(a.body.telefone).toBe('');
  });
  test('NIF, telefone e morada inválidos → 400 com mensagem clara', async () => {
    const nif = await auth(A, 'put', '/api/configuracoes').send({ nif_empresa: '12 3' });
    expect(nif.status).toBe(400);
    expect(nif.body.erro).toMatch(/NIF/);
    const tel = await auth(A, 'put', '/api/configuracoes').send({ telefone: 'abc' });
    expect(tel.status).toBe(400);
    expect(tel.body.erro).toMatch(/Telefone/);
    const mor = await auth(A, 'put', '/api/configuracoes').send({ morada: 'x'.repeat(201) });
    expect(mor.status).toBe(400);
  });
  test('o talão passa a usar estes dados (prioridade sobre o registo)', async () => {
    const { tenantInfo } = require('../../server/services/documentos.service');
    await auth(A, 'put', '/api/configuracoes').send({ morada: 'Rua da Missão 12', nif_empresa: '5417000000', telefone: '+244 923 125 060' });
    const t = await tenantInfo(A.tenantId);
    expect(t).toMatchObject({ morada: 'Rua da Missão 12', nif: '5417000000', telefone: '+244 923 125 060' });
  });
});
