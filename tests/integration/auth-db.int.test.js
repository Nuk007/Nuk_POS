'use strict';
/**
 * Integração — auth.service (bcrypt + JWT reais) e verificação dos índices
 * compostos da migração 1748700000000_composite-indexes.
 */
const request = require('supertest');
const { app } = require('../../server/app');
const svc = require('../../server/services/auth.service');

let A;
beforeAll(async () => { A = await criarTenantFixture({ slug: 'it-auth' }); });

describe('auth.service — login contra funcionarios real', () => {
  test('credenciais válidas devolvem token com tenantId e perfil', async () => {
    const r = await svc.login({ email: A.email, password: A.password });
    expect(r.token).toEqual(expect.any(String));
    expect(r.funcionario.email).toBe(A.email);
    expect(r.funcionario.tenant_slug).toBe(A.slug);
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(r.token, process.env.JWT_SECRET);
    expect(payload.tenantId).toBe(A.tenantId);
    expect(payload.nivel_acesso).toBe('ADMIN');
  });

  test('email é case-insensitive (usa LOWER(email) — índice funcional)', async () => {
    const r = await svc.login({ email: A.email.toUpperCase(), password: A.password });
    expect(r.token).toBeDefined();
  });

  test('password errada → 401; email inexistente → 401 (sem oráculo)', async () => {
    await expect(svc.login({ email: A.email, password: 'errada' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(svc.login({ email: 'ninguem@x.ao', password: 'x' })).rejects.toMatchObject({ statusCode: 401 });
  });

  test('funcionário inactivo não entra', async () => {
    await pool.query(`UPDATE funcionarios SET ativo=false WHERE id=$1`, [A.userId]);
    await expect(svc.login({ email: A.email, password: A.password })).rejects.toMatchObject({ statusCode: expect.any(Number) });
    await pool.query(`UPDATE funcionarios SET ativo=true WHERE id=$1`, [A.userId]);
  });

  test('HTTP: POST /login → GET /me com o token devolvido', async () => {
    const l = await request(app).post('/api/auth/login').send({ email: A.email, password: A.password });
    expect(l.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${l.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(A.userId);
  });
});

describe('migração composite-indexes — índices existem e são usados', () => {
  beforeAll(async () => {
    // O schema base já foi criado pelo initDB(); marca a migração inicial como aplicada
    // e corre apenas a de índices compostos através da CLI do node-pg-migrate.
    const { execFileSync } = require('child_process');
    const path = require('path');
    const root = path.join(__dirname, '..', '..');
    await pool.query(`CREATE TABLE IF NOT EXISTS pgmigrations (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, run_on TIMESTAMP NOT NULL)`);
    await pool.query(`INSERT INTO pgmigrations (name, run_on) SELECT '1748600000000_initial-schema', NOW()
                      WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name='1748600000000_initial-schema')`);
    execFileSync(path.join(root, 'node_modules', '.bin', 'node-pg-migrate'),
      ['up', '--migrations-dir', path.join(root, 'migrations'), '--no-check-order'],
      { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }, stdio: 'pipe', cwd: root });
  }, 60000);

  test('os 14 índices compostos estão presentes', async () => {
    const esperados = [
      'idx_pedidos_tenant_status', 'idx_pedidos_tenant_criado_em', 'idx_pedidos_tenant_mesa_id',
      'idx_itens_pedido_pedido_produto',
      'idx_stock_tenant_ativo_cat_nome', 'idx_stock_tenant_niveis',
      'idx_movimentos_item_criado_em',
      'idx_produtos_tenant_disp_ativo', 'idx_produtos_tenant_categoria',
      'idx_funcionarios_email_lower', 'idx_funcionarios_tenant_nivel',
      'idx_mesas_tenant_status', 'idx_clientes_tenant_criado_em',
      'idx_faturas_tenant_emitida_em',
    ];
    const r = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1)`, [esperados]);
    const encontrados = r.rows.map(x => x.indexname).sort();
    expect(encontrados).toEqual([...esperados].sort());
  });

  test('EXPLAIN de pedidos por tenant+status usa um índice composto (sem Seq Scan)', async () => {
    const r = await pool.query(`SET enable_seqscan = off`);
    const plan = await pool.query(
      `EXPLAIN (FORMAT JSON) SELECT * FROM pedidos WHERE tenant_id = $1 AND status = 'ABERTO'`,
      [A.tenantId]
    );
    await pool.query(`RESET enable_seqscan`);
    const json = JSON.stringify(plan.rows[0]['QUERY PLAN']);
    // com a tabela quase vazia o planeador pode escolher qualquer índice composto que comece por tenant_id;
    // o que importa é nunca cair em Seq Scan.
    expect(json).toMatch(/idx_pedidos_tenant_/);
    expect(json).not.toMatch(/Seq Scan/);
  });
});
