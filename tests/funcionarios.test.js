'use strict';
/**
 * Testes de integração — /api/funcionarios
 * Cobre: GET / (lista, ADMIN/GERENTE only), POST / (criação), PUT /:id (actualização)
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server/app');

const TENANT_ID = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const FUNC_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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

function funcRow(overrides = {}) {
  return {
    id:          FUNC_ID,
    nome:        'João Operador',
    email:       'joao@nukpos.ao',
    nivel_acesso:'OPERADOR',
    ativo:       true,
    criado_em:   new Date().toISOString(),
    ...overrides,
  };
}

// ─── GET /api/funcionarios ───────────────────────────────────────────────────

describe('GET /api/funcionarios', () => {
  it('retorna lista para ADMIN', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [funcRow(), funcRow({ nome: 'Maria Gerente', nivel_acesso: 'GERENTE' })] });

    const res = await request(app)
      .get('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('retorna lista para GERENTE', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [funcRow()] });

    const res = await request(app)
      .get('/api/funcionarios')
      .set('Authorization', `Bearer ${gerenteToken}`);

    expect(res.status).toBe(200);
  });

  it('retorna 403 para OPERADOR', async () => {
    const res = await request(app)
      .get('/api/funcionarios')
      .set('Authorization', `Bearer ${operadorToken}`);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/funcionarios');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/funcionarios ──────────────────────────────────────────────────

describe('POST /api/funcionarios', () => {
  const payload = {
    nome:         'Pedro Caixa',
    email:        'pedro@nukpos.ao',
    password:     'Senha@Segura1!',
    nivel_acesso: 'OPERADOR', // 'CAIXA' não existe na BD (CHECK) e dava 500: a API passou a recusá-lo
  };

  it('cria funcionário como ADMIN', async () => {
    // 1ª query: quem cria (titular) · 2ª: email existente (rows vazio = não existe) · 3ª: INSERT
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, nivel_acesso: 'ADMIN', titular: true, permissoes: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [funcRow({ ...payload, id: FUNC_ID })] });

    const res = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.nivel_acesso).toBe('OPERADOR');
  });

  it('retorna 409 quando email já está registado', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, nivel_acesso: 'ADMIN', titular: true, permissoes: null }] }).mockResolvedValueOnce({ rows: [{ id: FUNC_ID }] }); // quem cria + email existe

    const res = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body.erro).toMatch(/email/i);
  });

  it('retorna 400 quando faltam campos obrigatórios', async () => {
    const res = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Sem email' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 com nivel_acesso inválido', async () => {
    const res = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...payload, nivel_acesso: 'SUPERUSUARIO' });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/nivel_acesso/i);
  });

  it('retorna 403 para GERENTE (só ADMIN cria funcionários)', async () => {
    const res = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${gerenteToken}`)
      .send(payload);

    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/funcionarios/:id ───────────────────────────────────────────────

describe('PUT /api/funcionarios/:id', () => {
  it('actualiza nome e nível de acesso', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, nivel_acesso: 'ADMIN', titular: true, permissoes: null }] })                                  // quem edita
      .mockResolvedValueOnce({ rows: [funcRow()] })                          // o alvo
      .mockResolvedValueOnce({ rows: [funcRow({ nome: 'Pedro Actualizado', nivel_acesso: 'GERENTE' })] });

    const res = await request(app)
      .put(`/api/funcionarios/${FUNC_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Pedro Actualizado', nivel_acesso: 'GERENTE' });

    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('Pedro Actualizado');
  });

  it('retorna 404 quando funcionário não existe', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, nivel_acesso: 'ADMIN', titular: true, permissoes: null }] }).mockResolvedValueOnce({ rows: [] }); // quem edita + alvo inexistente

    const res = await request(app)
      .put(`/api/funcionarios/${FUNC_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ativo: false });

    expect(res.status).toBe(404);
  });

  it('retorna 400 com UUID inválido', async () => {
    const res = await request(app)
      .put('/api/funcionarios/uuid-invalido')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(400);
  });
});

describe('Licença por módulos (acessos.js)', () => {
  const A = require('../server/services/acessos');
  test('NULL = todos os módulos prontos; lista corta os acessos', () => {
    expect(A.licenciados(null)).toEqual(A.PRONTOS);
    const ch = A.chavesLicenciadas(['restauracao']);
    expect(ch).toEqual(expect.arrayContaining(['dashboard', 'configuracoes', 'pedidos', 'mesas', 'produtos']));
    expect(ch).not.toContain('quartos');
  });
  test('validarModulos recusa vazio, desconhecido e não construído', () => {
    expect(() => A.validarModulos([])).toThrow();
    expect(() => A.validarModulos(['voar'])).toThrow();
    expect(() => A.validarModulos(['lazer'])).toThrow();
    expect(A.validarModulos(['rh', 'rh'])).toEqual(['rh']);
  });
});
