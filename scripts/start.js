'use strict';
/**
 * Arranque em produção: aplica migrações pendentes e só depois inicia o servidor.
 *
 * Compatibilidade com bases criadas pelo initDB() (antes de existirem migrações):
 * a migração inicial 1748600000000_initial-schema replica esse schema, por isso
 * se as tabelas já existem mas a tabela pgmigrations não, marca-se a inicial como
 * aplicada e correm apenas as migrações seguintes (índices, etc.).
 *
 * Se a migração falhar, o servidor arranca na mesma (initDB() garante o schema
 * base) e o erro é registado — nunca se bloqueia o serviço por causa de um índice.
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const path = require('path');
const { Pool } = require('pg');

const INITIAL = '1748600000000_initial-schema';

async function prepararPgmigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 1,
  });
  try {
    const temTenants = await pool.query(`SELECT to_regclass('public.tenants') AS t`);
    const temPgm     = await pool.query(`SELECT to_regclass('public.pgmigrations') AS t`);
    if (temTenants.rows[0].t && !temPgm.rows[0].t) {
      console.log('[migrate] Base pré-existente sem pgmigrations — a marcar migração inicial como aplicada');
      await pool.query(`CREATE TABLE IF NOT EXISTS pgmigrations (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, run_on TIMESTAMP NOT NULL)`);
      await pool.query(`INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())`, [INITIAL]);
    }
  } finally {
    await pool.end();
  }
}

(async () => {
  if (process.env.DATABASE_URL && process.env.SKIP_MIGRATIONS !== 'true') {
    try {
      await prepararPgmigrations();
      console.log('[migrate] A aplicar migrações pendentes…');
      execFileSync(
        path.join(__dirname, '..', 'node_modules', '.bin', 'node-pg-migrate'),
        ['up', '--migrations-dir', path.join(__dirname, '..', 'migrations'), '--no-check-order'],
        { stdio: 'inherit', env: process.env }
      );
      console.log('[migrate] Migrações concluídas');
    } catch (err) {
      console.error('[migrate] ⚠️  Falha nas migrações (o servidor arranca na mesma):', err.message);
    }
  } else {
    console.log('[migrate] Ignoradas (sem DATABASE_URL ou SKIP_MIGRATIONS=true)');
  }
  require('../server/app');
})();
