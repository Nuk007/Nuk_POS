'use strict';
/**
 * Setup dos testes de INTEGRAÇÃO — corre contra uma PostgreSQL real.
 *
 * Ao contrário de tests/setup.js (unitários), aqui NÃO se faz mock do db.js:
 * as queries dos serviços executam-se de verdade, incluindo transacções,
 * FOR UPDATE, constraints CHECK/UNIQUE e índices.
 *
 * Apenas o Socket.io é substituído (não há servidor WS durante os testes).
 */
process.env.NODE_ENV  = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-jwt-integration-nukpos';
// DATABASE_URL foi definida pelo globalSetup (ou por TEST_DATABASE_URL)
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

jest.mock('../../server/middleware/broadcast', () => ({ init: jest.fn(), broadcast: jest.fn() }));
jest.mock('../../server/websocket',           () => ({ initWebSocket: jest.fn() }));

const { pool, initDB } = require('../../server/db');
const bcrypt = require('bcryptjs');
const { gerarToken } = require('../../server/middleware/auth');

// Tabelas operacionais limpas entre testes (ordem irrelevante com CASCADE)
const TABELAS_OPERACIONAIS = [
  'movimentos_stock', 'stock_items',
  'itens_pedido', 'pedidos',
  'produtos', 'mesas', 'clientes',
];

/**
 * Cria tenant ACTIVA + licença ACTIVA + admin, devolvendo ids e token JWT válido.
 * Reutilizado por todos os ficheiros de integração.
 */
async function criarTenantFixture({ slug = 'teste', nivel = 'ADMIN' } = {}) {
  const plano = await pool.query(`SELECT id FROM planos_assinatura ORDER BY preco_mensal LIMIT 1`);
  const planoId = plano.rows[0]?.id || null;

  const t = await pool.query(
    `INSERT INTO tenants (nome, telefone_whatsapp, email, plano_id, estado, slug)
     VALUES ($1, '+244900000000', $2, $3, 'ACTIVA', $4) RETURNING id`,
    [`Tenant ${slug}`, `${slug}@teste.ao`, planoId, slug]
  );
  const tenantId = t.rows[0].id;

  await pool.query(
    `INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, inicio, fim, estado, activado_em)
     VALUES ($1, $2, $3, 365, NOW(), NOW() + INTERVAL '365 days', 'ACTIVA', NOW())`,
    [tenantId, `NUK-TEST-${slug.toUpperCase()}-${Date.now().toString(36)}`, planoId]
  );

  const hash = await bcrypt.hash('Senha@123', 4);
  const f = await pool.query(
    `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso)
     VALUES ($1, $2, $3, $4, 'Administrador', $5) RETURNING id, email, nivel_acesso`,
    [tenantId, `Admin ${slug}`, `admin@${slug}.ao`, hash, nivel]
  );
  const user = f.rows[0];

  const token = gerarToken({ id: user.id, email: user.email, nivel_acesso: user.nivel_acesso, tenantId });
  return { tenantId, userId: user.id, email: user.email, password: 'Senha@123', token, slug };
}

async function limparOperacionais() {
  await pool.query(`TRUNCATE ${TABELAS_OPERACIONAIS.join(', ')} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => {
  await initDB();        // schema real, idempotente
  await limparOperacionais();
  await pool.query(`DELETE FROM tenants WHERE slug LIKE 'it-%'`); // restos de execuções anteriores
}, 60000);

afterAll(async () => {
  await pool.end();
});

global.pool = pool;
global.criarTenantFixture = criarTenantFixture;
global.limparOperacionais = limparOperacionais;
