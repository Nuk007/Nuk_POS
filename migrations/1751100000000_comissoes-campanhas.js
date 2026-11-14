'use strict';
/** Migração: comissões do pessoal e campanhas (SQL em server/migrations-data/comissoes-campanhas.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/comissoes-campanhas');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE tabelas_preco DROP COLUMN IF EXISTS desconto_pct, DROP COLUMN IF EXISTS data_fim, DROP COLUMN IF EXISTS data_inicio');
  pgm.sql('ALTER TABLE funcionarios DROP COLUMN IF EXISTS comissao_pct');
};
