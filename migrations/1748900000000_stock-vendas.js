'use strict';
/**
 * Migração: as vendas passam a abater o stock.
 *  - produto_ingredientes: o que cada produto consome do stock (1 linha = 1 item de stock + quantidade por unidade vendida).
 *    Uma cerveja consome 1 un da cerveja; uma picanha pode consumir 300 g de carne + 20 g de tempero.
 *  - movimentos_stock.pedido_id: liga o movimento ao pedido (abate e devolução na mesma auditoria).
 *  - tipo ESTORNO: devolução de stock quando um pedido é cancelado.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS produto_ingredientes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
      stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
      quantidade NUMERIC(10,3) NOT NULL CHECK (quantidade > 0),
      UNIQUE (produto_id, stock_item_id)
    )`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_prod_ingr_stock ON produto_ingredientes(stock_item_id)`);
  pgm.sql(`ALTER TABLE movimentos_stock ADD COLUMN IF NOT EXISTS pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_mov_stock_pedido ON movimentos_stock(pedido_id) WHERE pedido_id IS NOT NULL`);
  pgm.sql(`ALTER TABLE movimentos_stock DROP CONSTRAINT IF EXISTS movimentos_stock_tipo_check`);
  pgm.sql(`ALTER TABLE movimentos_stock ADD CONSTRAINT movimentos_stock_tipo_check
           CHECK (tipo IN ('VENDA','COMPRA','AJUSTE','DESPERDICIO','INVENTARIO','ESTORNO'))`);
};
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE movimentos_stock DROP CONSTRAINT IF EXISTS movimentos_stock_tipo_check`);
  pgm.sql(`ALTER TABLE movimentos_stock ADD CONSTRAINT movimentos_stock_tipo_check CHECK (tipo IN ('VENDA','COMPRA','AJUSTE','DESPERDICIO','INVENTARIO'))`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mov_stock_pedido`);
  pgm.sql(`ALTER TABLE movimentos_stock DROP COLUMN IF EXISTS pedido_id`);
  pgm.sql(`DROP TABLE IF EXISTS produto_ingredientes`);
};
