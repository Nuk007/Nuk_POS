'use strict';
/**
 * Conta não paga (cliente saiu sem pagar) registada pela chefia (20/11/2026, decisão do dono). Partilhado pela migração
 * 1752700000000 e por db.js (corre em cada arranque: tudo idempotente).
 *  - pedidos.perda_em/perda_por/perda_motivo: a conta deixa de estar «por pagar» (mesa/quarto livres, o caixa pode
 *    fechar), não é receita e nunca entra no Caixa.
 *  - Registada, não se desfaz nem se altera, e o pedido nunca pode ser dado como pago (trigger).
 */
module.exports = [
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS perda_em TIMESTAMPTZ`,
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS perda_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL`,
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS perda_motivo TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_pedidos_perda ON pedidos (tenant_id, perda_em) WHERE perda_em IS NOT NULL`,
  `DROP INDEX IF EXISTS idx_pedidos_por_pagar`,
  `CREATE INDEX IF NOT EXISTS idx_pedidos_por_pagar2 ON pedidos (tenant_id, criado_em) WHERE status <> 'CANCELADO' AND pago_em IS NULL AND perda_em IS NULL`,
  `CREATE OR REPLACE FUNCTION nukpos_pedido_perda_selada() RETURNS trigger AS $$
   BEGIN
     IF OLD.perda_em IS NOT NULL AND (
          NEW.perda_em IS DISTINCT FROM OLD.perda_em OR NEW.perda_motivo IS DISTINCT FROM OLD.perda_motivo
          OR NOT (NEW.perda_por IS NOT DISTINCT FROM OLD.perda_por OR NEW.perda_por IS NULL)
          OR NEW.pago_em IS NOT NULL OR NEW.status = 'CANCELADO') THEN
       RAISE EXCEPTION 'Conta registada como não paga: não pode ser alterada, recebida nem cancelada' USING ERRCODE = 'P0001', HINT = 'PERDA_SELADA';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_pedido_perda_selada ON pedidos`,
  `CREATE TRIGGER trg_pedido_perda_selada BEFORE UPDATE ON pedidos FOR EACH ROW EXECUTE FUNCTION nukpos_pedido_perda_selada()`,
];
