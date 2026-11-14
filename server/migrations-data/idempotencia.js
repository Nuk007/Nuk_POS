'use strict';
/**
 * Idempotência dos pedidos (14/11/2026): o portal e o POS mandam uma chave por envio; se a resposta se perder e o
 * aparelho tentar de novo (ou sincronizar depois de estar sem internet), o servidor devolve o pedido já criado em vez
 * de criar outro. Partilhado pela migração 1751300000000 e por db.js.
 */
module.exports = [
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS chave_idempotencia VARCHAR(64)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_chave ON pedidos (tenant_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL`,
];
