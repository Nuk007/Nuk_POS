'use strict';
/**
 * Migração: acessos delegáveis. `permissoes` (JSONB) é a lista de módulos/capacidades de um funcionário;
 * NULL = predefinição do nível (comportamento anterior). Nos administradores não titulares é o LIMITE
 * dentro do qual podem atribuir acessos aos restantes funcionários.
 */
exports.up = (pgm) => { pgm.sql(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS permissoes JSONB;`); };
exports.down = (pgm) => { pgm.sql(`ALTER TABLE funcionarios DROP COLUMN IF EXISTS permissoes;`); };
