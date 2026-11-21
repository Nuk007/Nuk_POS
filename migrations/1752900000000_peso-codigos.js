'use strict';
/** Migração: venda ao peso e códigos de barras (SQL em server/migrations-data/peso-codigos.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/peso-codigos');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS uq_produtos_tenant_codigo_barras`);
  pgm.sql(`ALTER TABLE produtos DROP COLUMN IF EXISTS vendido_ao_peso, DROP COLUMN IF EXISTS codigo_barras`);
};
