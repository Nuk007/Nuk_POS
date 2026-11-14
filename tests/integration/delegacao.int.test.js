'use strict';
/** Integração — o titular define os acessos dos outros administradores; estes atribuem aos restantes dentro desse limite. */
const request = require('supertest');
const { app } = require('../../server/app');
const { limparCache } = require('../../server/middleware/modulos');

let T, ipN = 1, adm2, g1;
const ip = () => `10.15.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const com = (tok, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${tok}`).send(body);
const entrar = async (email, password = '12345678') => (await request(app).post('/api/auth/login').set('X-Forwarded-For', ip()).send({ email, password })).body;
const novo = (n, extra = {}) => ({ nome: n, email: `${n.toLowerCase().replace(/\W/g, '')}@it-del.ao`, password: '12345678', nivel_acesso: 'OPERADOR', ...extra });

beforeAll(async () => {
  T = await criarTenantFixture({ slug: 'it-del' });
  await pool.query(`UPDATE funcionarios SET titular = true WHERE id = $1`, [T.userId]); // como na activação real
}, 60000);

describe('Titular define os acessos de outro administrador', () => {
  test('cria administrador com limite (funcionários, pedidos, mesas, vender quartos)', async () => {
    const r = await com(T.token, 'post', '/api/funcionarios', novo('Admin Dois', { nivel_acesso: 'ADMIN', permissoes: ['funcionarios', 'pedidos', 'mesas', 'vender_quartos'] }));
    expect(r.status).toBe(201);
    expect(r.body.acessos.sort()).toEqual(['funcionarios', 'mesas', 'pedidos', 'vender_quartos']);
    adm2 = await entrar('admindois@it-del.ao');
    expect(adm2.token).toBeTruthy();
    expect(adm2.funcionario.permissoes).toEqual(expect.arrayContaining(['funcionarios', 'pedidos']));
    expect(adm2.funcionario.permissoes).not.toContain('financeiro');
  });
  test('lista de acessos inválida → 400; o titular tem sempre tudo', async () => {
    expect((await com(T.token, 'post', '/api/funcionarios', novo('Mau', { nivel_acesso: 'ADMIN', permissoes: ['voar'] }))).status).toBe(400);
    const l = await com(T.token, 'get', '/api/funcionarios');
    const titular = l.body.find(f => f.titular);
    expect(titular.acessos).toEqual(expect.arrayContaining(['financeiro', 'configuracoes', 'funcionarios']));
  });
});

describe('Administrador não titular: limites da delegação', () => {
  test('metadados mostram o limite e que não é titular', async () => {
    const m = await com(adm2.token, 'get', '/api/funcionarios/acessos');
    expect(m.status).toBe(200);
    expect(m.body.sou_titular).toBe(false);
    expect(m.body.meu_limite).not.toContain('stock');
  });
  test('atribui acessos dentro do limite e recusa o que não tem', async () => {
    const ok = await com(adm2.token, 'post', '/api/funcionarios', novo('Ana Caixa', { permissoes: ['pedidos'] }));
    expect(ok.status).toBe(201);
    expect(ok.body.acessos).toEqual(['pedidos']);
    const mal = await com(adm2.token, 'post', '/api/funcionarios', novo('Rui Fin', { permissoes: ['pedidos', 'financeiro'] }));
    expect(mal.status).toBe(403);
    expect(mal.body.erro).toMatch(/Financeiro/);
  });
  test('sem lista explícita grava a predefinição do nível cortada pelo limite', async () => {
    const r = await com(adm2.token, 'post', '/api/funcionarios', novo('Bia Mesas'));
    expect(r.status).toBe(201);
    expect(r.body.acessos.sort()).toEqual(['mesas', 'pedidos', 'vender_quartos']);
  });
  test('perfis de quartos só se atribuem se o titular os delegou', async () => {
    expect((await com(adm2.token, 'post', '/api/funcionarios', novo('Cai Vende', { pode_vender_quartos: true }))).status).toBe(201);
    const r = await com(adm2.token, 'post', '/api/funcionarios', novo('Dai Arruma', { arruma_quartos: true }));
    expect(r.status).toBe(403);
  });
  test('não cria nem altera administradores, nem o titular, nem a si próprio', async () => {
    expect((await com(adm2.token, 'post', '/api/funcionarios', novo('Outro Adm', { nivel_acesso: 'ADMIN' }))).status).toBe(403);
    const l = (await com(T.token, 'get', '/api/funcionarios')).body;
    const titular = l.find(f => f.titular), eu = l.find(f => f.email === 'admindois@it-del.ao');
    expect((await com(adm2.token, 'put', `/api/funcionarios/${titular.id}`, { nome: 'X' })).status).toBe(403);
    expect((await com(adm2.token, 'put', `/api/funcionarios/${eu.id}`, { permissoes: ['funcionarios', 'stock'] })).status).toBe(403);
  });
  test('não altera quem tem acessos acima do seu limite, mas pode editar o resto da ficha', async () => {
    g1 = (await com(T.token, 'post', '/api/funcionarios', novo('Gil Gerente', { nivel_acesso: 'GERENTE', permissoes: ['pedidos', 'financeiro'] }))).body;
    expect((await com(adm2.token, 'put', `/api/funcionarios/${g1.id}`, { permissoes: ['pedidos'] })).status).toBe(403);
    const r = await com(adm2.token, 'put', `/api/funcionarios/${g1.id}`, { cargo: 'Chefe de sala' });
    expect(r.status).toBe(200);
    expect(r.body.acessos).toEqual(['pedidos', 'financeiro']);
  });
  test('muda de nível sem lista: predefinição do novo nível dentro do limite', async () => {
    const o = (await com(adm2.token, 'post', '/api/funcionarios', novo('Eva Op', { permissoes: ['mesas'] }))).body;
    const r = await com(adm2.token, 'put', `/api/funcionarios/${o.id}`, { nivel_acesso: 'GERENTE' });
    expect(r.status).toBe(200);
    expect(r.body.acessos.sort()).toEqual(['funcionarios', 'mesas', 'pedidos', 'vender_quartos']);
  });
  test('isolamento: não mexe em funcionários de outro estabelecimento', async () => {
    const B = await criarTenantFixture({ slug: 'it-del-b' });
    const fb = (await com(B.token, 'post', '/api/funcionarios', novo('Zé de B', { email: 'ze@it-del-b.ao' }))).body;
    expect((await com(adm2.token, 'put', `/api/funcionarios/${fb.id}`, { nome: 'Hack' })).status).toBe(404);
  });
});

describe('Os limites valem nos módulos (servidor)', () => {
  test('administrador sem Clientes/Stock/Financeiro/Configurações é recusado; o titular passa', async () => {
    for (const u of ['/api/clientes', '/api/stock', '/api/financeiro/resumo']) {
      const r = await com(adm2.token, 'get', u);
      expect(r.status).toBe(403);
      expect(r.body.erro).toMatch(/Não tem acesso/);
    }
    expect((await com(T.token, 'get', '/api/clientes')).status).toBe(200);
    expect((await com(adm2.token, 'put', '/api/configuracoes', { moeda: 'Kz' })).status).toBe(403);
    expect((await com(T.token, 'put', '/api/configuracoes', { moeda: 'Kz' })).status).toBe(200);
  });
  test('funcionário com acessos restritos só entra onde lhe foi dado', async () => {
    const c = await entrar('anacaixa@it-del.ao');
    expect(c.funcionario.permissoes).toEqual(['pedidos']);
    expect((await com(c.token, 'get', '/api/clientes')).status).toBe(403);
    expect((await com(c.token, 'get', '/api/funcionarios')).status).toBe(403);
    expect((await com(c.token, 'get', '/api/pedidos')).status).toBe(200);
  });
  test('o titular retira «funcionários» ao administrador e o efeito é imediato', async () => {
    const eu = (await com(T.token, 'get', '/api/funcionarios')).body.find(f => f.email === 'admindois@it-del.ao');
    expect((await com(adm2.token, 'get', '/api/funcionarios')).status).toBe(200);
    expect((await com(T.token, 'put', `/api/funcionarios/${eu.id}`, { permissoes: ['pedidos'] })).status).toBe(200);
    limparCache(); // o cache de 15 s só existe para poupar consultas
    expect((await com(adm2.token, 'get', '/api/funcionarios')).status).toBe(403);
    expect((await com(adm2.token, 'post', '/api/funcionarios', novo('Fim'))).status).toBe(403);
  });
  test('quem é desactivado perde o acesso mesmo com o token ainda válido', async () => {
    const c = await entrar('anacaixa@it-del.ao');
    const id = (await com(T.token, 'get', '/api/funcionarios')).body.find(f => f.email === 'anacaixa@it-del.ao').id;
    await com(T.token, 'put', `/api/funcionarios/${id}`, { ativo: false });
    limparCache();
    expect((await com(c.token, 'get', '/api/clientes')).status).toBe(403);
  });
});
