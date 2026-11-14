'use strict';
/** Migração: níveis de preço e prato do dia (SQL em server/migrations-data/precos.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/precos');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE pedidos DROP COLUMN IF EXISTS tabela_preco_id');
  pgm.sql('ALTER TABLE produtos DROP COLUMN IF EXISTS prato_do_dia');
  pgm.sql('DROP TABLE IF EXISTS precos_tabela');
  pgm.sql('DROP TABLE IF EXISTS tabelas_preco');
};
