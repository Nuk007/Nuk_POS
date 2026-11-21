'use strict';
/** Migração: relatórios gerados automaticamente (SQL em server/migrations-data/relatorios-auto.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/relatorios-auto');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql(`DROP TABLE IF EXISTS relatorios_gerados`); };
