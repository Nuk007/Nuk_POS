'use strict';
/**
 * Testes de integração — /api/quartos e /api/reservas
 * Quartos:  GET / (lista), POST /reserva (transacção), PATCH /:id/status
 * Reservas: GET / (lista), PATCH /:id/status (com side-effect no quarto)
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server/app');

const TENANT_ID  = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const QUARTO_ID  = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RESERVA_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ADMIN_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeToken(nivel = 'ADMIN') {
  return jwt.sign(
    { id: ADMIN_ID, email: 'admin@nukpos.ao', nivel_acesso: nivel, tenantId: TENANT_ID },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const adminToken    = makeToken('ADMIN');
const gerenteToken  = makeToken('GERENTE');
const operadorToken = makeToken('OPERADOR');

function quartoRow(overrides = {}) {
  return {
    id:              QUARTO_ID,
    tenant_id:       TENANT_ID,
    numero:          '101',
    tipo:            'STANDARD',
    status:          'DISPONIVEL',
    preco_2h:        '5000.00',
    preco_pernoite:  '12000.00',
    preco_diaria:    '18000.00',
    reservas_activas: null,
    criado_em:       new Date().toISOString(),
    atualizado_em:   new Date().toISOString(),
    ...overrides,
  };
}

function reservaRow(overrides = {}) {
  return {
    id:           RESERVA_ID,
    tenant_id:    TENANT_ID,
    quarto_id:    QUARTO_ID,
    quarto_numero:'101',
    quarto_tipo:  'STANDARD',
    nome_hospede: 'João Silva',
    fracao:       'PERNOITE',
    checkin:      '2026-11-01T14:00:00Z',
    checkout:     '2026-11-02T12:00:00Z',
    valor_total:  '12000.00',
    status:       'CONFIRMADA',
    criado_em:    new Date().toISOString(),
    atualizado_em:new Date().toISOString(),
    ...overrides,
  };
}

// ─── GET /api/quartos ────────────────────────────────────────────────────────

describe('GET /api/quartos', () => {
  it('retorna lista de quartos autenticado (com ocupação, ★ e arrumação calculadas)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [quartoRow(), quartoRow({ id: 'q2', numero: '102' })] }) // quartos
      .mockResolvedValueOnce({ rows: [] })                                                    // reservas activas
      .mockResolvedValueOnce({ rows: [] });                                                   // arrumações abertas

    const res = await request(app)
      .get('/api/quartos')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ estrela: null, ocupacao: null, limpeza: null, livre_as: null });
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/quartos');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/quartos/:id/vender (contrato com a UI dos botões) ──────────────

describe('POST /api/quartos/:id/vender', () => {
  it('recusa quem não tem o perfil «vender quartos» (403)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ v: false }] }); // temPerfil

    const res = await request(app)
      .post(`/api/quartos/${QUARTO_ID}/vender`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ fracao: 'DUAS_HORAS' });

    expect(res.status).toBe(403);
    expect(res.body.erro).toMatch(/Vender quartos/);
  });

  it('exige o serviço Hora/Noite/Diária (400)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ v: true }] });

    const res = await request(app)
      .post(`/api/quartos/${QUARTO_ID}/vender`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('retorna 400 com UUID inválido e 401 sem token', async () => {
    expect((await request(app).post('/api/quartos/xx/vender').set('Authorization', `Bearer ${operadorToken}`).send({ fracao: 'DUAS_HORAS' })).status).toBe(400);
    expect((await request(app).post(`/api/quartos/${QUARTO_ID}/vender`).send({ fracao: 'DUAS_HORAS' })).status).toBe(401);
  });

  it('a rota antiga POST /quartos/reserva já não existe', async () => {
    const res = await request(app).post('/api/quartos/reserva').set('Authorization', `Bearer ${adminToken}`).send({});
    expect([400, 404]).toContain(res.status);
  });
});

// ─── PATCH /api/quartos/:id/status ──────────────────────────────────────────

describe('PATCH /api/quartos/:id/status', () => {
  it('actualiza quarto para MANUTENCAO (ADMIN)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'DISPONIVEL' }] }); // estado actual
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                               // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: QUARTO_ID, numero: '101', status: 'DISPONIVEL' }] } ) // FOR UPDATE
      .mockResolvedValueOnce({ rows: [quartoRow({ status: 'MANUTENCAO' })] })            // UPDATE
      .mockResolvedValueOnce({ rows: [] })                                               // fecha arrumações abertas
      .mockResolvedValueOnce({ rows: [] });                                              // COMMIT

    const res = await request(app)
      .patch(`/api/quartos/${QUARTO_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'MANUTENCAO' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('MANUTENCAO');
  });

  it('retorna 403 para OPERADOR', async () => {
    const res = await request(app)
      .patch(`/api/quartos/${QUARTO_ID}/status`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ status: 'LIMPEZA' });

    expect(res.status).toBe(403);
  });

  it('retorna 400 com status inválido', async () => {
    const res = await request(app)
      .patch(`/api/quartos/${QUARTO_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DESTRUIDO' });

    expect(res.status).toBe(400);
  });

  it('retorna 404 quando quarto não existe', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch(`/api/quartos/${QUARTO_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'MANUTENCAO' });

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/reservas ───────────────────────────────────────────────────────

describe('GET /api/reservas', () => {
  it('retorna lista de reservas', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [reservaRow(), reservaRow({ id: 'outra-reserva' })] });

    const res = await request(app)
      .get('/api/reservas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/reservas');
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/reservas/:id/status ─────────────────────────────────────────

describe('PATCH /api/reservas/:id/status', () => {
  it('faz CHECKIN na reserva', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [reservaRow({ status: 'CHECKIN' })] });

    const res = await request(app)
      .patch(`/api/reservas/${RESERVA_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CHECKIN' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CHECKIN');
  });

  it('faz CHECKOUT e liberta o quarto (sem outras reservas)', async () => {
    // UPDATE reserva → reserva actualizada
    // SELECT outras reservas activas → nenhuma
    // UPDATE quartos SET status=LIMPEZA
    mockPool.query
      .mockResolvedValueOnce({ rows: [reservaRow({ status: 'CHECKOUT', quarto_id: QUARTO_ID })] })
      .mockResolvedValueOnce({ rows: [] })   // sem outras reservas activas
      .mockResolvedValueOnce({ rows: [] });  // UPDATE quartos LIMPEZA

    const res = await request(app)
      .patch(`/api/reservas/${RESERVA_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CHECKOUT' });

    expect(res.status).toBe(200);
    expect(mockPool.query).toHaveBeenCalledTimes(3);
  });

  it('retorna 400 com status inválido', async () => {
    const res = await request(app)
      .patch(`/api/reservas/${RESERVA_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DORMIU' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 com UUID inválido', async () => {
    const res = await request(app)
      .patch('/api/reservas/nao-e-uuid/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CHECKIN' });

    expect(res.status).toBe(400);
  });

  it('retorna 404 quando reserva não existe', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch(`/api/reservas/${RESERVA_ID}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CHECKIN' });

    expect(res.status).toBe(404);
  });
});
