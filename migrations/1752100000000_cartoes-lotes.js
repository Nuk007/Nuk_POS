'use strict';
/** Migração: lotes de cartões de consumo pré-impressos (SQL em server/migrations-data/cartoes-lotes.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/cartoes-lotes');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM cartoes_consumo WHERE estado = 'POR_VENDER'`);
  pgm.sql(`ALTER TABLE cartoes_consumo DROP CONSTRAINT IF EXISTS cartoes_consumo_estado_check, DROP COLUMN IF EXISTS vendido_em, DROP COLUMN IF EXISTS estado, DROP COLUMN IF EXISTS lote_id`);
  pgm.sql(`DROP TABLE IF EXISTS cartoes_lotes`);
};
