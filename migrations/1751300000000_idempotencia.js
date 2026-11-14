'use strict';
/** Migração: chave de idempotência dos pedidos (SQL em server/migrations-data/idempotencia.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/idempotencia');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('DROP INDEX IF EXISTS uq_pedidos_chave'); pgm.sql('ALTER TABLE pedidos DROP COLUMN IF EXISTS chave_idempotencia'); };
