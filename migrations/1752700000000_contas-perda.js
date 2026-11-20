'use strict';
/** Migração: conta não paga registada pela chefia (SQL em server/migrations-data/contas-perda.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/contas-perda');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql(`DROP TRIGGER IF EXISTS trg_pedido_perda_selada ON pedidos; DROP FUNCTION IF EXISTS nukpos_pedido_perda_selada()`); };
