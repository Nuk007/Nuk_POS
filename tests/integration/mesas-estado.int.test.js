'use strict';
/** Integração (PostgreSQL real) — mudar o estado de uma mesa. Apanha colunas inexistentes que os testes com pool mockado não vêem. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, mesaId, n = 1;
const op = (T, url, body) => request(app).patch(url).set('X-Forwarded-For', `10.8.0.${n++}`).set('Authorization', `Bearer ${T.token}`).send(body);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-mesa-est-a' });
  B = await criarTenantFixture({ slug: 'it-mesa-est-b' });
  mesaId = (await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,'M01',4) RETURNING id`, [A.tenantId])).rows[0].id;
}, 60000);

describe('PATCH /api/mesas/:id/status', () => {
  test.each(['OCUPADA', 'RESERVADA', 'LIMPEZA', 'MANUTENCAO', 'LIVRE'])('muda para %s e regista a actividade', async estado => {
    const r = await op(A, `/api/mesas/${mesaId}/status`, { status: estado });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe(estado);
    expect(r.body.ultima_atividade).toBeTruthy();
  });
  test('estado inválido → 400; outro estabelecimento → 404', async () => {
    expect((await op(A, `/api/mesas/${mesaId}/status`, { status: 'XPTO' })).status).toBe(400);
    expect((await op(B, `/api/mesas/${mesaId}/status`, { status: 'LIVRE' })).status).toBe(404);
  });
});
