'use strict';
/**
 * Integração (PostgreSQL real) — licença expirada, ecrã de bloqueio e renovação sem tocar nas contas (14/11/2026).
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { pool } = require('../../server/db');

let E, A, n = 1;
const ip = () => `10.9.8.${n++}`;
const auth = (T, m, url) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`);
const sa = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Superadmin-Key', process.env.SUPERADMIN_KEY).send(body);
const licencas = async (tenantId) => (await pool.query(
  `SELECT license_key, estado, inicio, fim FROM licencas WHERE tenant_id = $1 ORDER BY criado_em, fim NULLS LAST`, [tenantId])).rows;
const DIA = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  E = await criarTenantFixture({ slug: 'it-lic-exp' });
  A = await criarTenantFixture({ slug: 'it-lic-act' });
  await pool.query(`UPDATE funcionarios SET titular = true WHERE id = ANY($1)`, [[E.userId, A.userId]]);
  // E: licença que acabou ontem.
  await pool.query(`UPDATE licencas SET inicio = NOW() - INTERVAL '15 days', fim = NOW() - INTERVAL '1 day' WHERE tenant_id = $1`, [E.tenantId]);
  // A: faltam 5 dias.
  await pool.query(`UPDATE licencas SET fim = NOW() + INTERVAL '5 days' WHERE tenant_id = $1`, [A.tenantId]);
}, 60000);

describe('Licença expirada', () => {
  test('a operação responde 403 LICENCA_EXPIRADA com a data de fim; o estado da licença continua a responder', async () => {
    const r = await auth(E, 'get', '/api/dashboard/comparativo');
    expect(r.status).toBe(403);
    expect(r.body.codigo).toBe('LICENCA_EXPIRADA');
    expect(r.body.fim).toBeTruthy();

    process.env.SUPORTE_WHATSAPP = '+244 923 000 111';
    const l = await auth(E, 'get', '/api/saas/licenca');
    delete process.env.SUPORTE_WHATSAPP;
    expect(l.status).toBe(200);
    expect(l.body.situacao).toBe('EXPIRADA');
    expect(l.body.fim).toBeTruthy();
    expect(l.body.aviso).toBe(false);
    expect(l.body.suporte_whatsapp).toBe('244923000111');
    expect(l.body.estabelecimento).toBeTruthy();
  });

  test('sem token, o estado da licença não responde', async () => {
    expect((await request(app).get('/api/saas/licenca').set('X-Forwarded-For', ip())).status).toBe(401);
  });

  test('a 5 dias do fim há aviso; a operação continua aberta', async () => {
    const l = await auth(A, 'get', '/api/saas/licenca');
    expect(l.body.situacao).toBe('ACTIVA');
    expect(l.body.aviso).toBe(true);
    expect(l.body.dias_restantes).toBe(5);
    expect(l.body.suporte_whatsapp).toBeNull();
    expect((await auth(A, 'get', '/api/dashboard/comparativo')).status).not.toBe(403);
  });
});

describe('Renovação pelo superadmin', () => {
  test('licença expirada: fica activa já, conta a partir de agora, a operação reabre e a palavra-passe não muda', async () => {
    const antes = (await pool.query(`SELECT password_hash FROM funcionarios WHERE id = $1`, [E.userId])).rows[0].password_hash;
    const r = await sa('post', `/api/saas/tenants/${E.tenantId}/renovar`, { duracao_dias: 30 });
    expect(r.status).toBe(200);
    expect(r.body.valido_ate).toBeTruthy();
    const fim = new Date(r.body.fim).getTime();
    expect(Math.abs(fim - (Date.now() + 30 * DIA))).toBeLessThan(60000);

    const ls = await licencas(E.tenantId);
    expect(ls.filter(l => l.estado === 'ACTIVA')).toHaveLength(1);
    expect((await pool.query(`SELECT estado FROM tenants WHERE id = $1`, [E.tenantId])).rows[0].estado).toBe('ACTIVA');
    expect((await auth(E, 'get', '/api/dashboard/comparativo')).status).not.toBe(403);
    expect((await auth(E, 'get', '/api/saas/licenca')).body.situacao).toBe('ACTIVA');
    expect((await pool.query(`SELECT password_hash FROM funcionarios WHERE id = $1`, [E.userId])).rows[0].password_hash).toBe(antes);
  });

  test('renovar antes do fim soma os dias que faltavam; uma só licença activa', async () => {
    const fimAntes = new Date((await licencas(A.tenantId)).find(l => l.estado === 'ACTIVA').fim).getTime();
    const r = await sa('post', `/api/saas/tenants/${A.tenantId}/renovar`, { duracao_dias: 365 });
    expect(r.status).toBe(200);
    expect(Math.abs(new Date(r.body.fim).getTime() - (fimAntes + 365 * DIA))).toBeLessThan(1000);
    const ls = await licencas(A.tenantId);
    expect(ls.filter(l => l.estado === 'ACTIVA')).toHaveLength(1);
    expect((await auth(A, 'get', '/api/saas/licenca')).body.aviso).toBe(false);
  });

  test('duração inválida → 400; conta suspensa continua suspensa', async () => {
    expect((await sa('post', `/api/saas/tenants/${A.tenantId}/renovar`, { duracao_dias: 0 })).status).toBe(400);
    await pool.query(`UPDATE tenants SET estado = 'SUSPENSA' WHERE id = $1`, [A.tenantId]);
    const r = await sa('post', `/api/saas/tenants/${A.tenantId}/renovar`, { duracao_dias: 10 });
    expect(r.status).toBe(200);
    expect(r.body.suspensa).toBe(true);
    expect((await auth(A, 'get', '/api/saas/licenca')).body.situacao).toBe('SUSPENSA');
    await pool.query(`UPDATE tenants SET estado = 'ACTIVA' WHERE id = $1`, [A.tenantId]);
  });
});

describe('Chave de renovação na página de activação', () => {
  test('estabelecimento com titular: não pede administrador, não muda a palavra-passe e prolonga o prazo', async () => {
    const hash = await bcrypt.hash('123456', 4);
    await pool.query(`UPDATE funcionarios SET password_hash = $1 WHERE id = $2`, [hash, E.userId]);
    await pool.query(`UPDATE licencas SET fim = NOW() - INTERVAL '1 hour' WHERE tenant_id = $1 AND estado = 'ACTIVA'`, [E.tenantId]);
    const key = `NUK-REN-${Date.now().toString(36)}`;
    await pool.query(
      `INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, estado)
       SELECT id, $2, plano_id, 60, 'PENDENTE' FROM tenants WHERE id = $1`, [E.tenantId, key]);

    const g = await request(app).get(`/api/saas/activate/${key}`).set('X-Forwarded-For', ip());
    expect(g.status).toBe(200);
    expect(g.body.renovacao).toBe(true);

    const c = await request(app).post(`/api/saas/activate/${key}/confirmar`).set('X-Forwarded-For', ip()).send({});
    expect(c.status).toBe(200);
    expect(c.body.renovacao).toBe(true);
    expect(c.body.valido_ate).toBeTruthy();

    const f = (await pool.query(`SELECT password_hash FROM funcionarios WHERE id = $1`, [E.userId])).rows[0];
    expect(f.password_hash).toBe(hash);
    const ls = await licencas(E.tenantId);
    const activa = ls.filter(l => l.estado === 'ACTIVA');
    expect(activa).toHaveLength(1);
    expect(activa[0].license_key).toBe(key);
    expect(Math.abs(new Date(activa[0].fim).getTime() - (Date.now() + 60 * DIA))).toBeLessThan(60000);

    // A mesma chave não se usa duas vezes.
    expect((await request(app).post(`/api/saas/activate/${key}/confirmar`).set('X-Forwarded-For', ip()).send({})).status).toBe(400);
  });
});
