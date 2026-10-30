'use strict';
/**
 * Testes de integração — /api/dashboard
 * Cobre: GET / (resumo agregado: pedidos, mesas, quartos, stock, top produtos)
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server/app');

const TENANT_ID = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const ADMIN_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeToken(nivel = 'ADMIN') {
  return jwt.sign(
    { id: ADMIN_ID, email: 'admin@nukpos.ao', nivel_acesso: nivel, tenantId: TENANT_ID },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const adminToken    = makeToken('ADMIN');
const operadorToken = makeToken('OPERADOR');

// Configura os 6 mocks que o dashboard usa em Promise.all
function mockDashboard() {
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ total_pedidos: '12', receita_hoje: '38400.00', fechados: '8' }] })
    .mockResolvedValueOnce({ rows: [{ status: 'LIVRE', total: '6' }, { status: 'OCUPADA', total: '4' }] })
    .mockResolvedValueOnce({ rows: [{ status: 'DISPONIVEL', total: '5' }, { status: 'OCUPADO', total: '3' }] })
    .mockResolvedValueOnce({ rows: [{ total: '2' }] })
    .mockResolvedValueOnce({ rows: [
      { id: 'p1', status: 'ABERTO', mesa: 'M03', total: '3200.00', criado_em: new Date().toISOString(), num_itens: '2' },
      { id: 'p2', status: 'EM_PREPARO', mesa: 'M01', total: '6400.00', criado_em: new Date().toISOString(), num_itens: '4' },
    ]})
    .mockResolvedValueOnce({ rows: [
      { nome: 'Frango no Churrasco', categoria: 'GRELHADOS', total_vendido: '15' },
      { nome: 'Costela de Vaca', categoria: 'GRELHADOS', total_vendido: '10' },
    ]});
}

describe('GET /api/dashboard', () => {
  it('retorna resumo completo do dashboard', async () => {
    mockDashboard();

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('resumo_hoje');
    expect(res.body.resumo_hoje.total_pedidos).toBe('12');
    expect(res.body.resumo_hoje.receita_hoje).toBe('38400.00');
  });

  it('inclui estado das mesas', async () => {
    mockDashboard();

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.mesas)).toBe(true);
    expect(res.body.mesas.some(m => m.status === 'LIVRE')).toBe(true);
  });

  it('inclui estado dos quartos', async () => {
    mockDashboard();

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.quartos)).toBe(true);
  });

  it('inclui alertas de stock', async () => {
    mockDashboard();

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alertas_stock', 2);
  });

  it('inclui pedidos abertos', async () => {
    mockDashboard();

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pedidos_abertos)).toBe(true);
    expect(res.body.pedidos_abertos).toHaveLength(2);
  });

  it('inclui top produtos do dia', async () => {
    mockDashboard();

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.top_produtos)).toBe(true);
    expect(res.body.top_produtos[0].nome).toBe('Frango no Churrasco');
  });

  it('também disponível para OPERADOR', async () => {
    mockDashboard();

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${operadorToken}`);

    expect(res.status).toBe(200);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });
});
