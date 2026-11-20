'use strict';
/** Migração: bloqueio do PIN do portal por cliente (SQL em server/migrations-data/pin-bloqueio.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/pin-bloqueio');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql(`ALTER TABLE clientes DROP COLUMN IF EXISTS pin_falhas, DROP COLUMN IF EXISTS pin_bloqueios, DROP COLUMN IF EXISTS pin_bloqueado_ate`); };
