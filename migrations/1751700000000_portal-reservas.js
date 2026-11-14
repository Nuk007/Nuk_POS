'use strict';
/** Migração: reservas de quarto pelo portal com preço real (SQL em server/migrations-data/portal-reservas.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/portal-reservas');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  for (const c of ['reserva_id', 'valor_estimado', 'inicio', 'fracao', 'tipo_quarto']) pgm.sql(`ALTER TABLE solicitacoes_portal DROP COLUMN IF EXISTS ${c}`);
};
