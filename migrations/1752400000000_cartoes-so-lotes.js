'use strict';
/** Migração: cartões de consumo só nascem por lote do Administrador (SQL em server/migrations-data/cartoes-so-lotes.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/cartoes-so-lotes');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql(`DROP TRIGGER IF EXISTS trg_cartao_so_por_lote ON cartoes_consumo; DROP FUNCTION IF EXISTS nukpos_cartao_so_por_lote()`); };
