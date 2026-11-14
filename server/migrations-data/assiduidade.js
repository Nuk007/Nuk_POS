'use strict';
/**
 * Assiduidade do pessoal (benchmarking WinREST, 14/11/2026): cada funcionário regista a sua entrada e saída.
 * Um registo aberto por funcionário. Partilhado pela migração 1750900000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS registos_ponto (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     funcionario_id UUID NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
     entrada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     saida_em TIMESTAMPTZ,
     saida_corrigida_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
     observacoes VARCHAR(200),
     CHECK (saida_em IS NULL OR saida_em > entrada_em)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_ponto_aberto ON registos_ponto (funcionario_id) WHERE saida_em IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_ponto_tenant ON registos_ponto (tenant_id, entrada_em DESC)`,
];
