'use strict';
/** Integração (PostgreSQL real) — assiduidade: entrada/saída do próprio, relatório e correcção pela chefia. */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, OP, n = 1;
const ip = () => `10.11.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-ponto-a' });
  B = await criarTenantFixture({ slug: 'it-ponto-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Empregado Rui','op@it-ponto-a.ao',$2,'Empregado','OPERADOR') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  OP = { id: op, token: gerarToken({ id: op, email: 'op@it-ponto-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
}, 60000);

describe('Entrada e saída', () => {
  test('entrada, segunda entrada recusada, saída com horas; sem entrada → 409', async () => {
    expect((await call(OP, 'get', '/api/ponto')).body.em_servico).toBe(false);
    expect((await call(OP, 'post', '/api/ponto/saida')).status).toBe(409);
    const e = await call(OP, 'post', '/api/ponto/entrada', { funcionario_id: A.userId }); // o corpo é ignorado
    expect(e.status).toBe(201);
    expect((await pool.query(`SELECT funcionario_id FROM registos_ponto WHERE id=$1`, [e.body.id])).rows[0].funcionario_id).toBe(OP.id);
    expect((await call(OP, 'post', '/api/ponto/entrada')).status).toBe(409);
    expect((await call(OP, 'get', '/api/ponto')).body.em_servico).toBe(true);
    const s = await call(OP, 'post', '/api/ponto/saida');
    expect(s.status).toBe(200);
    expect(s.body.horas).toBeGreaterThanOrEqual(0);
    expect((await call(OP, 'get', '/api/ponto')).body.em_servico).toBe(false);
  });

  test('entradas em simultâneo: só uma fica aberta', async () => {
    const rs = await Promise.all([1, 2, 3].map(() => call(A, 'post', '/api/ponto/entrada')));
    expect(rs.filter(r => r.status === 201)).toHaveLength(1);
    expect(rs.filter(r => r.status === 409)).toHaveLength(2);
  });
});

describe('Relatório e correcção (chefia)', () => {
  test('OPERADOR não vê o relatório (403); ADMIN vê horas por funcionário', async () => {
    expect((await call(OP, 'get', '/api/ponto/relatorio')).status).toBe(403);
    const r = await call(A, 'get', `/api/ponto/relatorio?de=${hoje()}&ate=${hoje()}`);
    expect(r.status).toBe(200);
    expect(r.body.por_funcionario.find(f => f.nome === 'Empregado Rui')).toMatchObject({ dias: 1, em_aberto: 0 });
    expect(r.body.por_funcionario.find(f => f.funcionario_id === A.userId)).toMatchObject({ em_aberto: 1 });
  });

  test('corrigir saída esquecida: observação obrigatória, hora válida, só uma vez; outro estabelecimento → 404', async () => {
    const ent = new Date(Date.now() - 30 * 3600e3);
    const id = (await pool.query(`INSERT INTO registos_ponto (tenant_id, funcionario_id, entrada_em) VALUES ($1,$2,$3) RETURNING id`, [A.tenantId, OP.id, ent])).rows[0].id;
    const rel = await call(A, 'get', `/api/ponto/relatorio?de=${ent.toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' })}&ate=${hoje()}`);
    expect(rel.body.registos.find(x => x.id === id).esquecido).toBe(true);
    const saida = new Date(ent.getTime() + 8 * 3600e3).toISOString();
    expect((await call(OP, 'patch', `/api/ponto/${id}/saida`, { saida_em: saida, observacoes: 'esqueceu' })).status).toBe(403);
    expect((await call(A, 'patch', `/api/ponto/${id}/saida`, { saida_em: saida, observacoes: '' })).status).toBe(400);
    expect((await call(A, 'patch', `/api/ponto/${id}/saida`, { saida_em: new Date(ent.getTime() - 1000).toISOString(), observacoes: 'esqueceu' })).status).toBe(400);
    expect((await call(B, 'patch', `/api/ponto/${id}/saida`, { saida_em: saida, observacoes: 'esqueceu' })).status).toBe(404);
    const ok = await call(A, 'patch', `/api/ponto/${id}/saida`, { saida_em: saida, observacoes: 'Esqueceu-se de registar' });
    expect(ok.status).toBe(200);
    expect(ok.body.saida_corrigida_por).toBe(A.userId);
    expect((await call(A, 'patch', `/api/ponto/${id}/saida`, { saida_em: saida, observacoes: 'outra vez' })).status).toBe(409);
    const depois = await call(A, 'get', `/api/ponto/relatorio?de=${ent.toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' })}&ate=${hoje()}`);
    expect(depois.body.registos.find(x => x.id === id)).toMatchObject({ horas: 8, corrigido_por: `Admin it-ponto-a` });
  });
});
