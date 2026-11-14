'use strict';
/** /api/health: base de dados, arranque e agendador dos quartos. */
const request = require('supertest');
const { app } = require('../server/app');
const saude = require('../server/services/saude.service');

afterEach(() => { Object.assign(saude._estado, { arranque: 'a iniciar', agendadorUltimo: null, agendadorIntervaloMs: null }); mockPool.query.mockReset(); });

test('tudo bem → 200 ok, sem mensagens de erro internas', async () => {
  mockPool.query.mockResolvedValue({ rows: [{}] });
  saude.arranqueOk();
  const r = await request(app).get('/api/health');
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ status: 'ok', db: 'ok', arranque: 'ok', agendador: 'inactivo', problemas: [] });
});

test('base de dados sem resposta → 503 sem expor o erro', async () => {
  mockPool.query.mockRejectedValue(new Error('password authentication failed for user x'));
  const r = await request(app).get('/api/health');
  expect(r.status).toBe(503);
  expect(r.body.problemas).toContain('base de dados sem resposta');
  expect(JSON.stringify(r.body)).not.toMatch(/password/);
});

test('arranque falhado → 503', async () => {
  mockPool.query.mockResolvedValue({ rows: [{}] });
  saude.arranqueFalhou();
  const r = await request(app).get('/api/health');
  expect(r.status).toBe(503);
  expect(r.body.problemas).toContain('o arranque (initDB) falhou');
});

test('agendador: parado se ficar mais de 4 voltas (mínimo 2 min) sem correr', () => {
  saude.agendadorIniciado(30000);
  expect(saude.agendadorParado()).toBe(true); // ainda nenhuma volta
  saude.agendadorVolta();
  expect(saude.agendadorParado()).toBe(false);
  expect(saude.agendadorParado(Date.now() + 121000)).toBe(true);
});
