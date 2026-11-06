'use strict';
/**
 * Migração: Compras pontuais pagas com o dinheiro do caixa do dia, só de produtos cadastrados (itens de stock).
 * Cada compra gera um movimento negativo em CASH no caixa (caixa_movimentos.tipo='COMPRA') e entra no stock (movimentos_stock 'COMPRA').
 * Anular uma compra não apaga nada: marca-a e faz o movimento contrário.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS compras_pontuais (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sessao_id UUID NOT NULL REFERENCES caixa_sessoes(id),
      stock_item_id UUID NOT NULL REFERENCES stock_items(id),
      quantidade NUMERIC(10,3) NOT NULL CHECK (quantidade > 0),
      valor_total NUMERIC(15,2) NOT NULL CHECK (valor_total > 0),
      fornecedor VARCHAR(120),
      observacoes TEXT,
      criado_por UUID REFERENCES funcionarios(id),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      anulada_em TIMESTAMPTZ,
      anulada_por UUID REFERENCES funcionarios(id)
    );
    CREATE INDEX IF NOT EXISTS idx_compras_pontuais_sessao ON compras_pontuais (tenant_id, sessao_id, criado_em DESC);
    ALTER TABLE caixa_movimentos ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES compras_pontuais(id);
  `);
};
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE caixa_movimentos DROP COLUMN IF EXISTS compra_id; DROP TABLE IF EXISTS compras_pontuais;`);
};
