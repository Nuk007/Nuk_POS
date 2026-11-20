'use strict';
/** Migração: tipos de cartão de consumo por estabelecimento (SQL em server/migrations-data/cartoes-tipos.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/cartoes-tipos');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql(`DROP INDEX IF EXISTS idx_cartoes_por_vender`); pgm.sql(`DROP TABLE IF EXISTS cartoes_tipos`); };
