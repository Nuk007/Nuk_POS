'use strict';
/** Migração: produção de cartões no Caixa (SQL em server/migrations-data/cartoes-producao.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/cartoes-producao');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE cartoes_lotes DROP COLUMN IF EXISTS pedido_por`);
  pgm.sql(`ALTER TABLE funcionarios DROP COLUMN IF EXISTS imprime_cartoes`);
};
