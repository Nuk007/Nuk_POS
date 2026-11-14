'use strict';
/**
 * Comissões do pessoal e campanhas (benchmarking WinREST, 14/11/2026). Partilhado pela migração 1751100000000 e por db.js.
 *  - funcionarios.comissao_pct: % sobre as vendas FECHADAS do funcionário (relatório de vendas).
 *  - tabelas_preco.data_inicio/data_fim: campanha com datas (dias de Luanda, inclusivas).
 *  - tabelas_preco.desconto_pct: desconto geral da tabela para os produtos sem preço próprio nela.
 */
module.exports = [
  `ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS comissao_pct NUMERIC(5,2) NOT NULL DEFAULT 0`,
  `DO $$ BEGIN
     ALTER TABLE funcionarios ADD CONSTRAINT funcionarios_comissao_pct_check CHECK (comissao_pct >= 0 AND comissao_pct <= 100);
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TABLE tabelas_preco ADD COLUMN IF NOT EXISTS data_inicio DATE`,
  `ALTER TABLE tabelas_preco ADD COLUMN IF NOT EXISTS data_fim DATE`,
  `ALTER TABLE tabelas_preco ADD COLUMN IF NOT EXISTS desconto_pct NUMERIC(5,2)`,
  `DO $$ BEGIN
     ALTER TABLE tabelas_preco ADD CONSTRAINT tabelas_preco_desconto_check CHECK (desconto_pct IS NULL OR (desconto_pct > 0 AND desconto_pct < 100));
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     ALTER TABLE tabelas_preco ADD CONSTRAINT tabelas_preco_datas_check CHECK (data_inicio IS NULL OR data_fim IS NULL OR data_fim >= data_inicio);
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
];
