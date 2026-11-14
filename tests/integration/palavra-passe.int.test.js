'use strict';
/**
 * Integração (PostgreSQL real) — palavra-passe de 6 a 8 dígitos (decisão do dono de 14/11/2026).
 * Valida-se ao definir; as palavras-passe antigas (letras e números) continuam a entrar até serem mudadas.
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, n = 1;
const ip = () => `10.9.8.${n++}`;
const op = (m, url) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${A.token}`);
const entrar = (email, password) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip()).send({ email, password });

beforeAll(async () => { A = await criarTenantFixture({ slug: 'it-pp' }); }, 60000);

describe('Palavra-passe de 6 a 8 dígitos', () => {
  test('a palavra-passe antiga da fixture (letras) continua a entrar', async () => {
    expect((await entrar(A.email, A.password)).status).toBe(200);
  });

  test('criar funcionário: 5, 9 dígitos e letras recusados; 6 e 8 aceites e usados no login', async () => {
    for (const password of ['12345', '123456789', 'Senha@123']) {
      const r = await op('post', '/api/funcionarios').send({ nome: 'X', email: `x${password.length}@it-pp.ao`, password, nivel_acesso: 'OPERADOR' });
      expect(r.status).toBe(400);
    }
    const seis = await op('post', '/api/funcionarios').send({ nome: 'Seis Digitos', email: 'seis@it-pp.ao', password: '135790', nivel_acesso: 'OPERADOR' });
    expect(seis.status).toBe(201);
    expect((await entrar('seis@it-pp.ao', '135790')).status).toBe(200);
    const oito = await op('post', '/api/funcionarios').send({ nome: 'Oito Digitos', email: 'oito@it-pp.ao', password: '13579246', nivel_acesso: 'GERENTE' });
    expect(oito.status).toBe(201);
    expect((await entrar('oito@it-pp.ao', '13579246')).status).toBe(200);
  });

  test('alterar: só aceita 6 a 8 dígitos; vazio mantém a actual', async () => {
    const f = (await op('post', '/api/funcionarios').send({ nome: 'Muda Senha', email: 'muda@it-pp.ao', password: '111222', nivel_acesso: 'OPERADOR' })).body;
    expect((await op('put', `/api/funcionarios/${f.id}`).send({ password: 'nova-senha' })).status).toBe(400);
    expect((await op('put', `/api/funcionarios/${f.id}`).send({ nome: 'Muda Senha 2', password: '' })).status).toBe(200);
    expect((await entrar('muda@it-pp.ao', '111222')).status).toBe(200);
    expect((await op('put', `/api/funcionarios/${f.id}`).send({ password: '33344455' })).status).toBe(200);
    expect((await entrar('muda@it-pp.ao', '33344455')).status).toBe(200);
  });

  test('activação de um estabelecimento novo: o titular escolhe 6 a 8 dígitos', async () => {
    const { pool } = require('../../server/db');
    const plano = (await pool.query(`SELECT id FROM planos_assinatura ORDER BY preco_mensal LIMIT 1`)).rows[0].id;
    const t = (await pool.query(`INSERT INTO tenants (nome, telefone_whatsapp, email, plano_id, estado, slug)
      VALUES ('Novo PP', '+244911000000', 'novo@it-pp.ao', $1, 'PENDENTE', 'it-pp-novo') RETURNING id`, [plano])).rows[0].id;
    const chave = `NUK-PP-${Date.now().toString(36).toUpperCase()}`;
    await pool.query(`INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, estado) VALUES ($1, $2, $3, 30, 'PENDENTE')`, [t, chave, plano]);
    const url = `/api/saas/activate/${chave}/confirmar`;
    const corpo = { nome_admin: 'Titular Novo', email_admin: 'titular@it-pp-novo.ao', telefone_admin: '911000000' };
    expect((await request(app).post(url).set('X-Forwarded-For', ip()).send({ ...corpo, password: 'Senha@1234' })).status).toBe(400);
    const ok = await request(app).post(url).set('X-Forwarded-For', ip()).send({ ...corpo, password: '24682468' });
    expect(ok.status).toBeLessThan(300);
    expect((await entrar('titular@it-pp-novo.ao', '24682468')).status).toBe(200);
  });
});
