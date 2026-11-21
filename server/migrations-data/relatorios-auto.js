'use strict';
/**
 * Relatórios gerados automaticamente (21/11/2026, pedido do dono). Partilhado pela migração 1753200000000 e por db.js
 * (corre em cada arranque: tudo idempotente). Um relatório por estabelecimento, tipo e período (único).
 * estado: PRONTO (com dados) · VAZIO (sem movimento no período; não aparece na lista, evita gerar de novo) · FALHOU.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS relatorios_gerados (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     tipo VARCHAR(30) NOT NULL,
     frequencia VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
     de DATE NOT NULL,
     ate DATE NOT NULL,
     estado VARCHAR(10) NOT NULL DEFAULT 'PRONTO',
     dados JSONB,
     erro VARCHAR(300),
     origem VARCHAR(10) NOT NULL DEFAULT 'AUTO',
     gerado_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
     gerado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_relatorios_gerados ON relatorios_gerados (tenant_id, tipo, de, ate)`,
  `CREATE INDEX IF NOT EXISTS idx_relatorios_gerados_lista ON relatorios_gerados (tenant_id, gerado_em DESC)`,
];
