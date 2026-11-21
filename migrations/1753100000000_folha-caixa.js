'use strict';
/** Migração: Folha de Caixa diária — área, NIF e documento das compras; área das despesas (SQL em server/migrations-data/folha-caixa.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/folha-caixa');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_compras_pontuais_dia`);
  pgm.sql(`ALTER TABLE compras_pontuais DROP COLUMN IF EXISTS area, DROP COLUMN IF EXISTS fornecedor_nif, DROP COLUMN IF EXISTS documento`);
  pgm.sql(`ALTER TABLE despesas DROP COLUMN IF EXISTS area`);
};
