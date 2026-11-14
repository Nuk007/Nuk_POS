'use strict';
/**
 * Modo sem internet (14/11/2026): o pedido registado no dispositivo sem ligação chega mais tarde; guarda-se a hora
 * real da venda (para auditoria e para os preços dessa hora). Partilhado pela migração 1752000000000 e por db.js.
 */
module.exports = [
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS registado_offline_em TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS idx_pedidos_offline ON pedidos (tenant_id, registado_offline_em) WHERE registado_offline_em IS NOT NULL`,
];
