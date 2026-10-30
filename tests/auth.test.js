'use strict';
/**
 * Testes de integração — /api/auth
 * Cobre: POST /login (sucesso, credenciais inválidas, tenant suspenso, rate limit)
 *        GET /me (sucesso, token ausente, token inválido)
 */

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const { app } = require('../server/app');

// UUID válido do tenant demo
const TENANT_ID = 'bbc44510-a49a-4e1e-88a1-cae77c7c8f02';
const ADMIN_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Hash pré-calculado de 'Admin@NukPOS25!'
let ADMIN_HASH;
beforeAll(async () => {
  ADMIN_HASH = await bcrypt.hash('Admin@NukPOS25!', 12);
});

/**
 * Linha de funcionário completa retornada pela DB.
 * Nota: a rota verifica tenant_estado !== 'ACTIVA', não tenant_ativo.
 */
function adminRow(overrides = {}) {
  return {
    id:             ADMIN_ID,
    nome:           'Administrador',
    email:          'admin@nukpos.ao',
    password_hash:  ADMIN_HASH,
    nivel_acesso:   'ADMIN',
    cargo:          'Administrador',
    ativo:          true,
    tenant_id:      TENANT_ID,
    tenant_slug:    'demo',
    tenant_nome:    'Nuk_POS Demo',
    tenant_estado:  'ACTIVA',   // campo real usado em routes/auth.js:35
    ...overrides,
  };
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('retorna token JWT com credenciais válidas', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [adminRow()] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@nukpos.ao', password: 'Admin@NukPOS25!' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.funcionario).toMatchObject({
      email:        'admin@nukpos.ao',
      nivel_acesso: 'ADMIN',
      tenant_slug:  'demo',
    });
  });

  it('retorna 401 com password errada', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [adminRow()] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@nukpos.ao', password: 'PasswordErrada!' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('erro', 'Credenciais inválidas');
  });

  it('retorna 401 quando o utilizador não existe', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'naoexiste@nukpos.ao', password: 'qualquer' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('erro', 'Credenciais inválidas');
  });

  it('retorna 403 quando o tenant está suspenso (estado != ACTIVA)', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [adminRow({ tenant_estado: 'SUSPENSA' })],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@nukpos.ao', password: 'Admin@NukPOS25!' });

    expect(res.status).toBe(403);
    expect(res.body.erro).toMatch(/suspen/i);
  });

  it('retorna 400 quando os campos estão ausentes', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@nukpos.ao' }); // sem password

    expect(res.status).toBe(400);
  });

  it('retorna 500 quando a DB lança erro', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB offline'));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@nukpos.ao', password: 'Admin@NukPOS25!' });

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('erro');
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  let token;
  beforeAll(() => {
    const jwt = require('jsonwebtoken');
    token = jwt.sign(
      { id: ADMIN_ID, email: 'admin@nukpos.ao', nivel_acesso: 'ADMIN', tenantId: TENANT_ID },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  it('retorna dados do utilizador com token válido', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id:           ADMIN_ID,
        nome:         'Administrador',
        email:        'admin@nukpos.ao',
        nivel_acesso: 'ADMIN',
        tenant_id:    TENANT_ID,
        tenant_slug:  'demo',
        tenant_nome:  'Nuk_POS Demo',
      }],
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'admin@nukpos.ao', nivel_acesso: 'ADMIN' });
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('retorna 401 com token inválido', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer token-invalido-xpto');
    expect(res.status).toBe(401);
  });

  it('retorna 404 quando o utilizador não existe na DB', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
