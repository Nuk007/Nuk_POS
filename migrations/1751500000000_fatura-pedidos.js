'use strict';
/** Migração: um documento pode cobrir vários pedidos (SQL em server/migrations-data/fatura-pedidos.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/fatura-pedidos');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('DROP TABLE IF EXISTS fatura_pedidos'); };
