'use strict';
/**
 * Testes de integração — /api/financeiro
 * Cobre: GET /resumo, GET /faturas, POST /faturas
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server/app');

const TENANT_ID = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const ADMIN_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PEDIDO_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function makeToken(nivel = 'ADMIN') {
  return jwt.sign(
    { id: ADMIN_ID, email: 'admin@nukpos.ao', nivel_acesso: nivel, tenantId: TENANT_ID },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const adminToken    = makeToken('ADMIN');
const operadorToken = makeToken('OPERADOR');

function faturaRow(overrides = {}) {
  return {
    id:             'ffffffff-ffff-ffff-ffff-000000000001',
    tenant_id:      TENANT_ID,
    pedido_id:      PEDIDO_ID,
    numero_fatura:  'FT 2026/000001',
    serie:          'FT',
    ano:            2026,
    sequencial:     1,
    total:          '3200.00',
    total_sem_iva:  '2807.02',
    iva:            '392.98',
    taxa_iva:       14,
    nome_cliente:   'João Silva',
    nif_cliente:    '000123456LA041',
    emitida_em:     new Date().toISOString(),
    ...overrides,
  };
}

// ─── GET /api/financeiro/resumo ──────────────────────────────────────────────

describe('GET /api/financeiro/resumo', () => {
  const mockResumoRows = () => {
    // Promise.all dispara 4 queries em paralelo
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total_pedidos: '5', receita_total: '16000.00', pedidos_fechados: '3' }] })
      .mockResolvedValueOnce({ rows: [{ categoria: 'GRELHADOS', itens_vendidos: '8', total: '9600.00' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'FECHADO', total: '3', valor: '9600.00' }] })
      .mockResolvedValueOnce({ rows: [{ total_reservas: '2', receita_quartos: '24000.00' }] });
  };

  it('retorna resumo do dia com autenticação', async () => {
    mockResumoRows();

    const res = await request(app)
      .get('/api/financeiro/resumo')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pedidos');
    expect(res.body).toHaveProperty('por_categoria');
    expect(res.body).toHaveProperty('quartos');
  });

  it('aceita parâmetro de data válida', async () => {
    mockResumoRows();

    const res = await request(app)
      .get('/api/financeiro/resumo?data=2026-10-15')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBe('2026-10-15');
  });

  it('ignora data inválida e usa hoje', async () => {
    mockResumoRows();

    const res = await request(app)
      .get('/api/financeiro/resumo?data=nao-e-data')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // A data deve ser YYYY-MM-DD de hoje
    expect(res.body.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/financeiro/resumo');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/financeiro/faturas ─────────────────────────────────────────────

describe('GET /api/financeiro/faturas', () => {
  it('retorna lista de faturas', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [faturaRow(), faturaRow({ sequencial: 2 })] });

    const res = await request(app)
      .get('/api/financeiro/faturas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/financeiro/faturas');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/financeiro/faturas ────────────────────────────────────────────

describe('POST /api/financeiro/faturas', () => {
  it('emite fatura a partir de pedido_id', async () => {
    // 1: SELECT MAX sequencial, 2: SELECT pedido total, 3: INSERT fatura
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ prox: 1 }] })
      .mockResolvedValueOnce({ rows: [{ total: '3200.00' }] })
      .mockResolvedValueOnce({ rows: [faturaRow()] });

    const res = await request(app)
      .post('/api/financeiro/faturas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pedido_id: PEDIDO_ID, nome_cliente: 'João Silva' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('numero_fatura');
    expect(res.body.total).toBe('3200.00');
  });

  it('emite fatura com total_manual', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ prox: 2 }] })
      .mockResolvedValueOnce({ rows: [faturaRow({ sequencial: 2, total: '5000.00' })] });

    const res = await request(app)
      .post('/api/financeiro/faturas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ total_manual: 5000, nome_cliente: 'Maria Costa' });

    expect(res.status).toBe(201);
  });

  it('retorna 400 sem pedido_id, reserva_id ou total_manual', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ prox: 1 }] }); // seq

    const res = await request(app)
      .post('/api/financeiro/faturas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome_cliente: 'Sem valor' });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/pedido_id|reserva_id|total_manual/i);
  });

  it('retorna 400 com total_manual negativo ou zero', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ prox: 1 }] });

    const res = await request(app)
      .post('/api/financeiro/faturas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ total_manual: -100 });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/positivo/i);
  });

  it('retorna 400 com pedido_id UUID inválido', async () => {
    const res = await request(app)
      .post('/api/financeiro/faturas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pedido_id: 'nao-e-uuid' });

    expect(res.status).toBe(400);
  });

  it('retorna 404 quando pedido não existe', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ prox: 1 }] })  // seq
      .mockResolvedValueOnce({ rows: [] });              // pedido não encontrado

    const res = await request(app)
      .post('/api/financeiro/faturas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pedido_id: PEDIDO_ID });

    expect(res.status).toBe(404);
  });
});
