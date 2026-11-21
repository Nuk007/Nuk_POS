'use strict';
/**
 * Venda ao peso e códigos de barras (21/11/2026, pedido do dono: funções do WinREST que faltavam).
 * Partilhado pela migração 1752900000000 e por db.js (corre em cada arranque: idempotente).
 *  - produtos.vendido_ao_peso: o preço é por kg e a quantidade é o peso (até 3 casas decimais = gramas);
 *  - produtos.codigo_barras: único por estabelecimento (leitor no painel de venda e etiquetas);
 *  - quantidades com 3 casas decimais nos itens do pedido e nas linhas dos documentos (0,355 kg).
 *    O tipo só muda se ainda tiver menos casas (não reescreve a tabela em cada arranque).
 */
module.exports = [
  `ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vendido_ao_peso BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE produtos ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(32)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_tenant_codigo_barras ON produtos (tenant_id, codigo_barras) WHERE codigo_barras IS NOT NULL`,
  `DO $$ BEGIN
     IF (SELECT numeric_scale FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'itens_pedido' AND column_name = 'quantidade') < 3 THEN
       ALTER TABLE itens_pedido ALTER COLUMN quantidade TYPE NUMERIC(10,3);
     END IF;
     IF (SELECT numeric_scale FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'fatura_linhas' AND column_name = 'quantidade') < 3 THEN
       ALTER TABLE fatura_linhas ALTER COLUMN quantidade TYPE NUMERIC(10,3);
     END IF;
   END $$`,
];
