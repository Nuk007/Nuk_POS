'use strict';
/**
 * Cadeias de estabelecimentos (14/11/2026): o superadmin agrupa estabelecimentos do mesmo dono numa cadeia.
 * Quem é ADMIN em vários (mesmo email) vê o consolidado e muda de estabelecimento confirmando a palavra-passe.
 * Partilhado pela migração 1751800000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS grupos (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     nome VARCHAR(120) NOT NULL,
     criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_grupos_nome ON grupos (LOWER(nome))`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grupo_id UUID REFERENCES grupos(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_tenants_grupo ON tenants (grupo_id) WHERE grupo_id IS NOT NULL`,
];
