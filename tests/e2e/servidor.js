'use strict';
/**
 * Servidor para os testes de navegador (Playwright): PostgreSQL efémera (ou E2E_DATABASE_URL), schema pelo
 * initDB real, um estabelecimento de demonstração e o Nuk_POS a escutar em E2E_PORT (3999).
 * Arrancado pelo `webServer` de playwright.config.js; pára e apaga a base ao terminar.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-segredo-jwt-nukpos';
process.env.SUPERADMIN_KEY = process.env.SUPERADMIN_KEY || 'e2e-superadmin';

const PORTA = Number(process.env.E2E_PORT || 3999);
const globalSetup = require('../integration/globalSetup');
const globalTeardown = require('../integration/globalTeardown');

const E2E = {
  slug: 'e2e-casa', email: 'dono@e2e.ao', palavraPasse: '246810',
  produtos: [['Picanha', 4500, 'CHURRASCO'], ['Cuca', 800, 'BEBIDA'], ['Mufete', 6000, 'PEIXE']],
};

async function semear() {
  const bcrypt = require('bcryptjs');
  const { pool } = require('../../server/db');
  const plano = (await pool.query(`SELECT id FROM planos_assinatura ORDER BY preco_mensal LIMIT 1`)).rows[0];
  const t = (await pool.query(
    `INSERT INTO tenants (nome, telefone_whatsapp, email, plano_id, estado, slug) VALUES ('Casa E2E', '+244923000000', 'e2e@e2e.ao', $1, 'ACTIVA', $2) RETURNING id`,
    [plano && plano.id, E2E.slug])).rows[0].id;
  await pool.query(
    `INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, inicio, fim, estado, activado_em)
     VALUES ($1, 'NUK-E2E-0001', $2, 365, NOW(), NOW() + INTERVAL '365 days', 'ACTIVA', NOW())`, [t, plano && plano.id]);
  const f = (await pool.query(
    `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso, titular, pode_vender_quartos, arruma_quartos)
     VALUES ($1, 'Dono E2E', $2, $3, 'Dono', 'ADMIN', true, true, true) RETURNING id`, [t, E2E.email, await bcrypt.hash(E2E.palavraPasse, 4)])).rows[0].id;
  const { ADESAO_VERSAO } = require('../../server/services/adesao-texto');
  await pool.query(
    `INSERT INTO adesoes_plataforma (tenant_id, versao, texto, texto_hash, assinado_por, nome_escrito, hash)
     VALUES ($1, $2, 'texto e2e', repeat('0', 64), $3, 'Dono E2E', repeat('0', 64))`, [t, ADESAO_VERSAO, f]);
  for (const [nome, preco, categoria] of E2E.produtos) {
    await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true)`, [t, nome, preco, categoria]);
  }
  await require('../../server/services/mesas.service').definirQuantidade({ tenantId: t, quantidade: 4 });
  await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,'101','SUITE',15000,30000,45000)`, [t]);
}

(async () => {
  if (process.env.E2E_DATABASE_URL) { process.env.TEST_DATABASE_URL = process.env.E2E_DATABASE_URL; }
  await globalSetup();
  const { initDB } = require('../../server/db');
  await initDB();
  await semear();
  const { server } = require('../../server/app');
  server.listen(PORTA, '127.0.0.1', () => console.log(`[e2e] Nuk_POS em http://127.0.0.1:${PORTA}`));
  const parar = async () => { server.close(); await require('../../server/db').pool.end().catch(() => {}); await globalTeardown(); process.exit(0); };
  process.on('SIGTERM', parar);
  process.on('SIGINT', parar);
})().catch(async e => { console.error('[e2e] arranque falhou:', e); await globalTeardown().catch(() => {}); process.exit(1); });

module.exports = { E2E };
