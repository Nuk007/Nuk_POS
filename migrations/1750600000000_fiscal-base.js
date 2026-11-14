'use strict';
/**
 * Migração: base do módulo fiscal (numeração por estabelecimento, FT/FR/NC, linhas, documentos imutáveis).
 * O SQL vive em server/migrations-data/fiscal-base.js (partilhado com o espelho em db.js).
 */
const instrucoes = require('../server/migrations-data/fiscal-base');

exports.up = (pgm) => {
  for (const sql of instrucoes) pgm.sql(sql);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS trg_fatura_linhas_imutavel ON fatura_linhas');
  pgm.sql('DROP TRIGGER IF EXISTS trg_faturas_imutavel ON faturas');
  pgm.sql('DROP FUNCTION IF EXISTS nukpos_documento_fiscal_imutavel()');
  pgm.sql('DROP TABLE IF EXISTS fatura_linhas');
  // A unicidade global antiga não é reposta: impedia o 2.º estabelecimento de facturar.
};
