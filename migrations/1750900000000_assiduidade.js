'use strict';
/** Migração: assiduidade do pessoal (SQL em server/migrations-data/assiduidade.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/assiduidade');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('DROP TABLE IF EXISTS registos_ponto'); };
