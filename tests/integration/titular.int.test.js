'use strict';
/** Integração — titular do estabelecimento: não se desactiva, não se despromove, só transfere a titularidade. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, ipN = 1, titularId, outroId;
const ip = () => `10.11.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-titular-a' });
  B = await criarTenantFixture({ slug: 'it-titular-b' });
  titularId = A.userId;
  await pool.query(`UPDATE funcionarios SET titular = true WHERE id = $1`, [titularId]);
  const r = await op(A, 'post', '/api/funcionarios', { nome: 'Gerente Um', email: 'g1@it-titular-a.ao', password: 'Outra@1234', nivel_acesso: 'GERENTE', pode_vender_quartos: true });
  expect(r.status).toBe(201);
  outroId = r.body.id;
}, 60000);

describe('Titular do estabelecimento', () => {
  test('lista mostra o titular e os perfis de quartos', async () => {
    const l = await op(A, 'get', '/api/funcionarios');
    expect(l.body.find(f => f.id === titularId).titular).toBe(true);
    const g = l.body.find(f => f.id === outroId);
    expect(g.titular).toBe(false);
    expect(g.pode_vender_quartos).toBe(true);
    expect(g.arruma_quartos).toBe(false);
  });
  test('o titular não se desactiva nem se despromove', async () => {
    expect((await op(A, 'put', `/api/funcionarios/${titularId}`, { ativo: false })).status).toBe(403);
    expect((await op(A, 'put', `/api/funcionarios/${titularId}`, { nivel_acesso: 'GERENTE' })).status).toBe(403);
    // editar nome/cargo do titular é permitido
    const ok = await op(A, 'put', `/api/funcionarios/${titularId}`, { cargo: 'Proprietário' });
    expect(ok.status).toBe(200);
    expect(ok.body.cargo).toBe('Proprietário');
  });
  test('outros funcionários continuam a poder ser desactivados e editados (perfis)', async () => {
    const r = await op(A, 'put', `/api/funcionarios/${outroId}`, { arruma_quartos: true });
    expect(r.body.arruma_quartos).toBe(true);
    expect((await op(A, 'put', `/api/funcionarios/${outroId}`, { ativo: false })).status).toBe(200);
    expect((await op(A, 'put', `/api/funcionarios/${outroId}`, { ativo: true })).status).toBe(200);
  });
  test('transferência: exige palavra-passe certa, só o titular, alvo activo do mesmo estabelecimento', async () => {
    expect((await op(A, 'post', '/api/funcionarios/transferir-titularidade', { novo_titular_id: outroId, password: 'errada' })).status).toBe(401);
    const outroB = (await pool.query(`SELECT id FROM funcionarios WHERE tenant_id = $1 LIMIT 1`, [B.tenantId])).rows[0].id;
    expect((await op(A, 'post', '/api/funcionarios/transferir-titularidade', { novo_titular_id: outroB, password: 'Senha@123' })).status).toBe(404);
    expect((await op(A, 'post', '/api/funcionarios/transferir-titularidade', { novo_titular_id: titularId, password: 'Senha@123' })).status).toBe(400);
    // quem não é titular não transfere (B não tem titular marcado)
    expect((await op(B, 'post', '/api/funcionarios/transferir-titularidade', { novo_titular_id: outroB, password: 'Senha@123' })).status).toBe(403);
  });
  test('transferência feita: novo titular fica ADMIN e protegido; o antigo passa a ser comum', async () => {
    const r = await op(A, 'post', '/api/funcionarios/transferir-titularidade', { novo_titular_id: outroId, password: 'Senha@123' });
    expect(r.status).toBe(200);
    const l = (await op(A, 'get', '/api/funcionarios')).body;
    const novo = l.find(f => f.id === outroId);
    expect(novo.titular).toBe(true);
    expect(novo.nivel_acesso).toBe('ADMIN');
    expect(l.filter(f => f.titular)).toHaveLength(1);
    expect((await op(A, 'put', `/api/funcionarios/${outroId}`, { ativo: false })).status).toBe(403);
    expect((await op(A, 'put', `/api/funcionarios/${titularId}`, { ativo: false })).status).toBe(200);
  });
  test('um único titular por estabelecimento (índice único)', async () => {
    await expect(pool.query(`UPDATE funcionarios SET titular = true WHERE id = $1`, [titularId])).rejects.toMatchObject({ code: '23505' });
  });
  test('activação de um estabelecimento novo cria a conta titular', async () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../server/saas.js'), 'utf8');
    expect(src).toMatch(/INSERT INTO funcionarios \([^)]*titular\)[\s\S]*?'ADMIN', true\)/);
  });
});
