'use strict';
/**
 * Testes de integração — /api/financeiro
 * Cobre: GET /resumo, GET /faturas, POST /faturas, nota de crédito, cálculos fiscais
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');
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
  const setupResumoMocks = () => {
    // Promise.all dispara 4 queries em paralelo
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total_pedidos: '5', receita_total: '16000.00', pedidos_fechados: '3' }] })
      .mockResolvedValueOnce({ rows: [{ categoria: 'GRELHADOS', itens_vendidos: '8', total: '9600.00' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'FECHADO', total: '3', valor: '9600.00' }] })
      .mockResolvedValueOnce({ rows: [{ total_reservas: '2', receita_quartos: '24000.00' }] });
  };

  it('retorna resumo do dia com autenticação', async () => {
    setupResumoMocks();

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
    setupResumoMocks();

    const res = await request(app)
      .get('/api/financeiro/resumo?data=2026-10-15')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBe('2026-10-15');
  });

  it('ignora data inválida e usa hoje', async () => {
    setupResumoMocks();

    const res = await request(app)
      .get('/api/financeiro/resumo?data=nao-e-data')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
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

// ─── POST /api/financeiro/faturas (rota fina: o serviço fiscal tem testes de integração próprios) ──

const svc = require('../server/services/fiscal/faturas.service');
const erroSvc = (statusCode, message) => Object.assign(new Error(message), { statusCode });

describe('POST /api/financeiro/faturas', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emite e passa ao serviço o tenant e o utilizador do token (nunca do corpo)', async () => {
    const spy = jest.spyOn(svc, 'emitir').mockResolvedValue({ ...faturaRow(), linhas: [] });
    const res = await request(app).post('/api/financeiro/faturas').set('Authorization', `Bearer ${adminToken}`)
      .send({ pedido_id: PEDIDO_ID, nome_cliente: 'João Silva', tenantId: null, userId: 'outro' });
    expect(res.status).toBe(201);
    expect(res.body.numero_fatura).toBe('FT 2026/000001');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ pedido_id: PEDIDO_ID, tenantId: TENANT_ID, userId: ADMIN_ID }));
  });

  it('retorna 400 com pedido_id, reserva_id ou cliente_id que não são UUID (sem chamar o serviço)', async () => {
    const spy = jest.spyOn(svc, 'emitir');
    for (const campo of ['pedido_id', 'reserva_id', 'cliente_id']) {
      const res = await request(app).post('/api/financeiro/faturas').set('Authorization', `Bearer ${adminToken}`).send({ [campo]: 'nao-e-uuid' });
      expect(res.status).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('mapeia os erros do serviço (409) e a corrida na numeração (23505)', async () => {
    jest.spyOn(svc, 'emitir').mockRejectedValueOnce(erroSvc(409, 'Este pedido já foi facturado (FT 2026/000001)'));
    let res = await request(app).post('/api/financeiro/faturas').set('Authorization', `Bearer ${adminToken}`).send({ pedido_id: PEDIDO_ID });
    expect(res.status).toBe(409);
    expect(res.body.erro).toMatch(/já foi facturado/);
    svc.emitir.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    res = await request(app).post('/api/financeiro/faturas').set('Authorization', `Bearer ${adminToken}`).send({ total_manual: 1000 });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/financeiro/faturas/:id/nota-credito', () => {
  afterEach(() => jest.restoreAllMocks());
  const FID = 'ffffffff-ffff-ffff-ffff-000000000001';

  it('OPERADOR não emite notas de crédito (403)', async () => {
    const spy = jest.spyOn(svc, 'notaCredito');
    const res = await request(app).post(`/api/financeiro/faturas/${FID}/nota-credito`).set('Authorization', `Bearer ${operadorToken}`).send({ motivo: 'Engano no NIF' });
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('ADMIN emite (201) e o id tem de ser UUID', async () => {
    jest.spyOn(svc, 'notaCredito').mockResolvedValue({ numero_fatura: 'NC 2026/000001', linhas: [] });
    const ok = await request(app).post(`/api/financeiro/faturas/${FID}/nota-credito`).set('Authorization', `Bearer ${adminToken}`).send({ motivo: 'Engano no NIF' });
    expect(ok.status).toBe(201);
    const mau = await request(app).post('/api/financeiro/faturas/xyz/nota-credito').set('Authorization', `Bearer ${adminToken}`).send({ motivo: 'Engano no NIF' });
    expect(mau.status).toBe(400);
  });
});

// ─── Cálculos do serviço fiscal (sem base de dados) ──────────────────────────

describe('serviço fiscal — cálculos', () => {
  const { totais, separarIva, assinar, linha } = svc._interno;

  it('separa o IVA de um valor com IVA incluído em cêntimos exactos', () => {
    expect(separarIva(320000, 14)).toEqual({ semIva: 280702, iva: 39298 });
    expect(separarIva(100000, 0)).toEqual({ semIva: 100000, iva: 0 });
  });

  it('o desconto do documento reduz a base e o IVA; base + IVA = total', () => {
    const ls = [linha(1, { descricao: 'A', quantidade: 2, precoCent: 150000, taxa: 14 }), linha(2, { descricao: 'B', quantidade: 1, precoCent: 50000, taxa: 14 })];
    const t = totais(ls, 300000); // soma 350 000, paga 300 000
    expect(t.brutoCent).toBe(350000);
    expect(t.descontoCent).toBe(50000);
    expect(t.semIvaCent + t.ivaCent).toBe(300000);
    expect(t.semIvaCent).toBe(separarIva(300000, 14).semIva);
  });

  it('a assinatura depende da assinatura anterior (cadeia)', () => {
    const d = new Date('2026-11-14T10:00:00Z');
    const a = assinar({ emitidaEm: d, numero: 'FT 2026/000002', totalCent: 100000, anterior: 'x' });
    const b = assinar({ emitidaEm: d, numero: 'FT 2026/000002', totalCent: 100000, anterior: 'y' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('níveis de preço — janela horária', () => {
  const { _interno: { serve } } = require('../server/services/precos.service');
  const t = x => ({ ativa: true, origens: null, dias: null, hora_inicio: null, hora_fim: null, ...x });
  it('sem horário serve sempre; desligada nunca; fluxo filtra', () => {
    expect(serve(t({}), 'MESA', { dia: 1, hora: '10:00' })).toBe(true);
    expect(serve(t({ ativa: false }), 'MESA', { dia: 1, hora: '10:00' })).toBe(false);
    expect(serve(t({ origens: ['BALCAO'] }), 'MESA', { dia: 1, hora: '10:00' })).toBe(false);
  });
  it('janela normal e janela que passa a meia-noite (o dia conta pelo início)', () => {
    expect(serve(t({ hora_inicio: '17:00', hora_fim: '19:00' }), 'MESA', { dia: 1, hora: '18:30' })).toBe(true);
    expect(serve(t({ hora_inicio: '17:00', hora_fim: '19:00' }), 'MESA', { dia: 1, hora: '19:00' })).toBe(false);
    const noite = t({ hora_inicio: '22:00', hora_fim: '02:00', dias: [5] }); // sexta à noite
    expect(serve(noite, 'MESA', { dia: 5, hora: '23:00' })).toBe(true);
    expect(serve(noite, 'MESA', { dia: 6, hora: '01:30' })).toBe(true);  // madrugada de sábado ainda é a sexta
    expect(serve(noite, 'MESA', { dia: 6, hora: '23:00' })).toBe(false);
  });
});
