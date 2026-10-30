'use strict';
/**
 * Testes de integração — /api/mesas e /api/chamadas
 * Mesas:   GET / (lista), PATCH /:id/status
 * Chamadas: POST / (chamar staff), PATCH /:id/atender
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server/app');

const TENANT_ID  = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const MESA_ID    = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CHAMADA_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeToken(nivel = 'ADMIN') {
  return jwt.sign(
    { id: ADMIN_ID, email: 'admin@nukpos.ao', nivel_acesso: nivel, tenantId: TENANT_ID },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const adminToken    = makeToken('ADMIN');
const operadorToken = makeToken('OPERADOR');

function mesaRow(overrides = {}) {
  return {
    id:             MESA_ID,
    tenant_id:      TENANT_ID,
    numero:         'M01',
    capacidade:     4,
    status:         'LIVRE',
    pedidos_ativos: '0',
    criado_em:      new Date().toISOString(),
    atualizado_em:  new Date().toISOString(),
    ...overrides,
  };
}

function chamadaRow(overrides = {}) {
  return {
    id:              CHAMADA_ID,
    mesa_id:         MESA_ID,
    motivo:          'Conta, por favor',
    funcionario_id:  null,
    atendido_em:     null,
    solicitado_em:   new Date().toISOString(),
    ...overrides,
  };
}

// ─── GET /api/mesas ──────────────────────────────────────────────────────────

describe('GET /api/mesas', () => {
  it('retorna lista de mesas autenticado', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [mesaRow(), mesaRow({ numero: 'M02' })] });

    const res = await request(app)
      .get('/api/mesas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/mesas');
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/mesas/:id/status ─────────────────────────────────────────────

describe('PATCH /api/mesas/:id/status', () => {
  it('actualiza status para OCUPADA', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [mesaRow({ status: 'OCUPADA' })] });

    const res = await request(app)
      .patch(`/api/mesas/${MESA_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'OCUPADA' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OCUPADA');
  });

  it('retorna 400 com status inválido', async () => {
    const res = await request(app)
      .patch(`/api/mesas/${MESA_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DEMOLIDA' });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/status/i);
  });

  it('retorna 400 com UUID inválido', async () => {
    const res = await request(app)
      .patch('/api/mesas/nao-e-uuid/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'LIVRE' });

    expect(res.status).toBe(400);
  });

  it('retorna 404 quando mesa não existe', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch(`/api/mesas/${MESA_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'LIVRE' });

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/chamadas ──────────────────────────────────────────────────────

describe('POST /api/chamadas', () => {
  it('regista chamada ao staff com sucesso', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: MESA_ID }] })          // SELECT mesa
      .mockResolvedValueOnce({ rows: [chamadaRow()] });             // INSERT chamada

    const res = await request(app)
      .post('/api/chamadas')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ mesa_id: MESA_ID, motivo: 'Conta, por favor' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', CHAMADA_ID);
    expect(res.body.mesa_id).toBe(MESA_ID);
  });

  it('retorna 400 com mesa_id inválido', async () => {
    const res = await request(app)
      .post('/api/chamadas')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ mesa_id: 'nao-e-uuid', motivo: 'Teste' });

    expect(res.status).toBe(400);
  });

  it('retorna 404 quando mesa não existe', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // mesa não encontrada

    const res = await request(app)
      .post('/api/chamadas')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ mesa_id: MESA_ID });

    expect(res.status).toBe(404);
  });

  it('retorna 401 sem autenticação', async () => {
    const res = await request(app)
      .post('/api/chamadas')
      .send({ mesa_id: MESA_ID });

    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/chamadas/:id/atender ────────────────────────────────────────

describe('PATCH /api/chamadas/:id/atender', () => {
  it('marca chamada como atendida', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [chamadaRow({ funcionario_id: ADMIN_ID, atendido_em: new Date().toISOString() })],
    });

    const res = await request(app)
      .patch(`/api/chamadas/${CHAMADA_ID}/atender`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.funcionario_id).toBe(ADMIN_ID);
  });

  it('retorna 404 quando chamada não existe', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch(`/api/chamadas/${CHAMADA_ID}/atender`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it('retorna 400 com UUID inválido', async () => {
    const res = await request(app)
      .patch('/api/chamadas/uuid-invalido/atender')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });
});
