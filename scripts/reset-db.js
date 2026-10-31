'use strict';
/**
 * Reset TOTAL da base de dados (apaga todos os dados e o esquema).
 * Pensado para recomeçar do zero. É destrutivo e irreversível.
 *
 * Uso (a partir de um shell com acesso à BD, p.ex. a Shell do serviço no Render):
 *   CONFIRMAR_RESET=APAGAR-TUDO node scripts/reset-db.js
 *
 * Sem CONFIRMAR_RESET=APAGAR-TUDO não faz nada. Depois, reiniciar o serviço: o arranque
 * recria o esquema, aplica as migrações e cria os planos (sem dados de demonstração em produção).
 */
const { Pool } = require('pg');

async function main() {
  if (process.env.CONFIRMAR_RESET !== 'APAGAR-TUDO') {
    console.error('Recusado: defina CONFIRMAR_RESET=APAGAR-TUDO para confirmar que quer apagar TODOS os dados.');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL não definido.'); process.exit(2); }
  const destino = (() => { try { const u = new URL(url); return `${u.hostname}${u.pathname}`; } catch { return '(URL inválido)'; } })();
  const pool = new Pool({ connectionString: url, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
  try {
    console.log(`A apagar TODOS os dados em ${destino} …`);
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    console.log('✅ Base de dados vazia. Reinicie o serviço para recriar o esquema e os planos.');
  } finally {
    await pool.end();
  }
}
main().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
