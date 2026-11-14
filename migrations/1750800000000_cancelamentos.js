'use strict';
/** Migração: quem cancelou, quando e porquê (SQL em server/migrations-data/cancelamentos.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/cancelamentos');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('ALTER TABLE pedidos DROP COLUMN IF EXISTS motivo_cancelamento, DROP COLUMN IF EXISTS cancelado_por, DROP COLUMN IF EXISTS cancelado_em'); };
