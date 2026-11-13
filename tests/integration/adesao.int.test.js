'use strict';
/**
 * Integração (PostgreSQL real) — Contrato de Adesão à Plataforma Nuk_POS da GESTNUK AI (13/11/2026)
 * e verificação da licença, que só passou a ver o estabelecimento quando o resolverTenant lê o token.
 */
const request = require('supertest');
const { app } = require('../../server/app');
const { pool } = require('../../server/db');

let N, S, n = 1;
const auth = (T, m, url) => request(app)[m](url).set('X-Forwarded-For', `10.9.7.${n++}`).set('Authorization', `Bearer ${T.token}`);

beforeAll(async () => {
  N = await criarTenantFixture({ slug: 'it-ades-n', adesao: false });
  S = await criarTenantFixture({ slug: 'it-ades-s' }); // já assinou
}, 60000);

describe('Contrato de Adesão', () => {
  test('sem adesão, a operação responde 428 ADESAO_PENDENTE; o estado e a autenticação continuam acessíveis', async () => {
    const r = await auth(N, 'get', '/api/configuracoes');
    expect(r.status).toBe(428);
    expect(r.body.codigo).toBe('ADESAO_PENDENTE');
    expect((await auth(S, 'get', '/api/configuracoes')).status).toBe(200);
    const e = await auth(N, 'get', '/api/adesao');
    expect(e.status).toBe(200);
    expect(e.body.pendente).toBe(true);
    expect(e.body.pode_assinar).toBe(true); // sem titular no estabelecimento, um ADMIN activo assina
    const txt = e.body.texto.join(' ');
    expect(txt).toContain('GESTNUK AI');
    expect(txt).toContain('Tribunal da Comarca de Luanda');
    expect(txt).toContain('14/26');
    expect(txt).toContain('Documento sem validade fiscal');
  });

  test('só o titular assina; nome completo e aceitação obrigatórios; depois a operação abre e não se assina duas vezes', async () => {
    // Com um titular noutra conta, este ADMIN deixa de poder assinar.
    const t = await pool.query(
      `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso, titular)
       VALUES ($1, 'Titular Ades', 'titular@it-ades-n.ao', 'x', 'Titular', 'ADMIN', true) RETURNING id`, [N.tenantId]);
    expect((await auth(N, 'get', '/api/adesao')).body.pode_assinar).toBe(false);
    expect((await auth(N, 'post', '/api/adesao/assinar').send({ nome: 'Admin Ades', aceito: true })).status).toBe(403);
    await pool.query(`UPDATE funcionarios SET titular = false WHERE id = $1`, [t.rows[0].id]);
    await pool.query(`UPDATE funcionarios SET titular = true WHERE id = $1`, [N.userId]);
    expect((await auth(N, 'get', '/api/adesao')).body.pode_assinar).toBe(true);
    expect((await auth(N, 'post', '/api/adesao/assinar').send({ nome: 'Admin', aceito: true })).status).toBe(400);
    expect((await auth(N, 'post', '/api/adesao/assinar').send({ nome: 'Admin Ades', aceito: 'sim' })).status).toBe(400);
    expect((await auth(N, 'get', '/api/adesao/documento.pdf')).status).toBe(409);
    const ok = await auth(N, 'post', '/api/adesao/assinar').set('User-Agent', 'Teste/1.0').send({ nome: '  Admin   Ades  ', aceito: true });
    expect(ok.status).toBe(200);
    expect(ok.body.nome_escrito).toBe('Admin Ades');
    expect(ok.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await auth(N, 'get', '/api/configuracoes')).status).toBe(200);
    expect((await auth(N, 'post', '/api/adesao/assinar').send({ nome: 'Admin Ades', aceito: true })).status).toBe(409);
    const g = (await pool.query(`SELECT texto, texto_hash, dispositivo, assinado_por FROM adesoes_plataforma WHERE tenant_id = $1`, [N.tenantId])).rows;
    expect(g).toHaveLength(1);
    expect(g[0].texto).toContain('Tenant it-ades-n');
    expect(g[0].dispositivo).toBe('Teste/1.0');
    expect(g[0].assinado_por).toBe(N.userId);
    const e = (await auth(N, 'get', '/api/adesao')).body;
    expect(e.pendente).toBe(false);
    expect(e.assinada.nome_escrito).toBe('Admin Ades');
  });

  test('PDF do contrato assinado, só do próprio estabelecimento', async () => {
    const r = await auth(N, 'get', '/api/adesao/documento.pdf').buffer(true).parse((res, cb) => { const b = []; res.on('data', x => b.push(x)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/pdf/);
    expect(r.body.slice(0, 4).toString()).toBe('%PDF');
    const outro = await criarTenantFixture({ slug: 'it-ades-o', adesao: false });
    expect((await auth(outro, 'get', '/api/adesao/documento.pdf')).status).toBe(409);
  });

  test('pedido sem token não passa pela verificação de adesão (401 da rota)', async () => {
    expect((await request(app).get('/api/configuracoes').set('X-Forwarded-For', '10.9.7.250')).status).toBe(401);
  });
});

describe('Licença do estabelecimento (regressão de 13/11/2026)', () => {
  test('licença expirada bloqueia a operação (antes passava: o tenant não era resolvido)', async () => {
    const E = await criarTenantFixture({ slug: 'it-ades-exp' });
    expect((await auth(E, 'get', '/api/configuracoes')).status).toBe(200);
    await pool.query(`UPDATE licencas SET fim = NOW() - INTERVAL '1 day' WHERE tenant_id = $1`, [E.tenantId]);
    const r = await auth(E, 'get', '/api/configuracoes');
    expect(r.status).toBe(403);
    expect(r.body.codigo).toBe('LICENCA_EXPIRADA');
  });
  test('estabelecimento suspenso bloqueia a operação', async () => {
    const X = await criarTenantFixture({ slug: 'it-ades-sus' });
    await pool.query(`UPDATE tenants SET estado = 'SUSPENSA' WHERE id = $1`, [X.tenantId]);
    expect((await auth(X, 'get', '/api/configuracoes')).body.codigo).toBe('TENANT_SUSPENSA');
  });
});
