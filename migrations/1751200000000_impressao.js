'use strict';
/** Migração: controlo dos talões de cozinha/bar já impressos (SQL em server/migrations-data/impressao.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/impressao');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('DROP TABLE IF EXISTS impressoes_preparacao'); };
