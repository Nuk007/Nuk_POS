'use strict';
/** Migração: conta corrente de clientes (SQL em server/migrations-data/conta-corrente.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/conta-corrente');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS conta_corrente_movimentos');
  pgm.sql('ALTER TABLE clientes DROP COLUMN IF EXISTS limite_credito, DROP COLUMN IF EXISTS conta_corrente_ativa');
};
