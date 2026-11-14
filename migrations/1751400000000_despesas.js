'use strict';
/** Migração: despesas do estabelecimento (SQL em server/migrations-data/despesas.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/despesas');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('ALTER TABLE caixa_movimentos DROP COLUMN IF EXISTS despesa_id'); pgm.sql('DROP TABLE IF EXISTS despesas'); };
