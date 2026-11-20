'use strict';
/** Migração: livro do caixa numerado, encadeado (SHA-256) e imutável (SQL em server/migrations-data/caixa-auditoria.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/caixa-auditoria');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS trg_mov_cartao_imutavel ON movimentos_cartao; DROP FUNCTION IF EXISTS nukpos_mov_cartao_imutavel()`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_caixa_sessao_protegida ON caixa_sessoes; DROP FUNCTION IF EXISTS nukpos_caixa_sessao_protegida()`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_caixa_mov_imutavel ON caixa_movimentos; DROP FUNCTION IF EXISTS nukpos_caixa_mov_imutavel()`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_caixa_mov_encadear ON caixa_movimentos; DROP FUNCTION IF EXISTS nukpos_caixa_mov_encadear()`);
  pgm.sql(`DROP INDEX IF EXISTS uq_caixa_mov_tenant_numero; DROP INDEX IF EXISTS idx_caixa_mov_tenant_data; DROP INDEX IF EXISTS idx_caixa_mov_cartao; DROP INDEX IF EXISTS idx_caixa_mov_pedido`);
  pgm.sql(`ALTER TABLE caixa_movimentos DROP COLUMN IF EXISTS hash, DROP COLUMN IF EXISTS hash_anterior, DROP COLUMN IF EXISTS numero`);
  pgm.sql(`DROP FUNCTION IF EXISTS nukpos_caixa_mov_hash(TEXT, BIGINT, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, UUID, TIMESTAMPTZ)`);
};
