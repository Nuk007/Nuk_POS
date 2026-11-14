'use strict';
/**
 * Facturar a conta inteira de uma mesa (vários pedidos num só documento), a partir do Caixa (14/11/2026).
 * `fatura_pedidos` liga o documento a todos os pedidos que cobre; como os documentos, nunca se altera nem se apaga.
 * Partilhado pela migração 1751500000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS fatura_pedidos (
     fatura_id UUID NOT NULL REFERENCES faturas(id) ON DELETE CASCADE,
     pedido_id UUID NOT NULL REFERENCES pedidos(id),
     tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
     PRIMARY KEY (fatura_id, pedido_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_fatura_pedidos_pedido ON fatura_pedidos (pedido_id)`,
  // documentos anteriores: a ligação que já estava em faturas.pedido_id
  `INSERT INTO fatura_pedidos (fatura_id, pedido_id, tenant_id)
     SELECT id, pedido_id, tenant_id FROM faturas WHERE pedido_id IS NOT NULL ON CONFLICT DO NOTHING`,
  `DROP TRIGGER IF EXISTS trg_fatura_pedidos_imutavel ON fatura_pedidos`,
  `CREATE TRIGGER trg_fatura_pedidos_imutavel BEFORE UPDATE OR DELETE ON fatura_pedidos
     FOR EACH ROW EXECUTE FUNCTION nukpos_documento_fiscal_imutavel()`,
];
