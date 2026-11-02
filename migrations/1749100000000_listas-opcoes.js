'use strict';
/**
 * Migração: listas de opções configuráveis por estabelecimento (tipos de quarto, categorias de produto,
 * categorias e unidades de stock). Até aqui estavam fixas em CHECK da BD, iguais para todos.
 * Os CHECK saem (a validação passa a ser contra a lista do tenant) e as colunas alargam-se.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS listas_opcoes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      lista VARCHAR(30) NOT NULL,
      valor VARCHAR(30) NOT NULL,
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, lista, valor)
    )`);
  pgm.sql(`
    ALTER TABLE quartos DROP CONSTRAINT IF EXISTS quartos_tipo_check;
    ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_categoria_check;
    ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_categoria_check;
    ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_unidade_check;
    ALTER TABLE quartos ALTER COLUMN tipo TYPE VARCHAR(30);
    ALTER TABLE produtos ALTER COLUMN categoria TYPE VARCHAR(30);
    ALTER TABLE stock_items ALTER COLUMN categoria TYPE VARCHAR(30);
    ALTER TABLE stock_items ALTER COLUMN unidade TYPE VARCHAR(10);`);
};
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS listas_opcoes`);
};
