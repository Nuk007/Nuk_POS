'use strict';
/**
 * Migração: regras ON DELETE nas chaves estrangeiras de caixa, compras e serviços (ver server/migrations-data/fk-ondelete.js).
 * Idempotente: larga e volta a criar cada chave com o nome por omissão `<tabela>_<coluna>_fkey`.
 */
const regras = require('../server/migrations-data/fk-ondelete');
exports.up = (pgm) => {
  for (const [t, c, ref, acao] of regras) {
    pgm.sql(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_${c}_fkey;
             ALTER TABLE ${t} ADD CONSTRAINT ${t}_${c}_fkey FOREIGN KEY (${c}) REFERENCES ${ref}(id) ON DELETE ${acao};`);
  }
};
exports.down = () => {}; // sem reversão: a regra anterior (NO ACTION) só causava falhas ao apagar estabelecimentos
