'use strict';
/** Migração: cadeias de estabelecimentos (SQL em server/migrations-data/cadeias.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/cadeias');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('ALTER TABLE tenants DROP COLUMN IF EXISTS grupo_id'); pgm.sql('DROP TABLE IF EXISTS grupos'); };
