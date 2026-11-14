'use strict';
/** Migração: pedidos registados sem internet (SQL em server/migrations-data/offline.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/offline');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('ALTER TABLE pedidos DROP COLUMN IF EXISTS registado_offline_em'); };
