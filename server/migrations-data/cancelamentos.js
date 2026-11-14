'use strict';
/**
 * Responsabilização dos cancelamentos (benchmarking WinREST, 14/11/2026): quem cancelou, quando e porquê.
 * A regra do dono mantém-se: só se cancela nos primeiros 5 minutos (ou o pedido remoto por validar).
 * Partilhado pela migração 1750800000000 e por db.js.
 */
module.exports = [
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ`,
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelado_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL`,
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(200)`,
  `CREATE INDEX IF NOT EXISTS idx_pedidos_cancelados ON pedidos (tenant_id, cancelado_em) WHERE cancelado_em IS NOT NULL`,
];
