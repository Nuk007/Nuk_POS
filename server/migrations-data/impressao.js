'use strict';
/**
 * Impressão directa (14/11/2026): cada talão de cozinha/bar só sai UMA vez, mesmo com vários dispositivos ligados
 * (o dispositivo «reclama» o talão numa transacção). Partilhado pela migração 1751200000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS impressoes_preparacao (
     pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
     posto VARCHAR(10) NOT NULL CHECK (posto IN ('COZINHA','BAR')),
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     impresso_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     impresso_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
     PRIMARY KEY (pedido_id, posto)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_impressoes_tenant ON impressoes_preparacao (tenant_id, impresso_em DESC)`,
];
