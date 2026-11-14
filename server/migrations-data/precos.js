'use strict';
/**
 * Níveis de preço e prato do dia (benchmarking WinREST, 14/11/2026). Partilhado pela migração 1751000000000 e por db.js.
 *  - tabelas_preco: até 5 por estabelecimento (ex.: Happy hour, Esplanada, Eventos), com dias da semana, horário
 *    (pode passar a meia-noite), fluxos de venda (MESA, BALCAO, …; NULL = todos) e prioridade.
 *  - precos_tabela: preço de um produto nessa tabela (sem linha = preço base do produto).
 *  - pedidos.tabela_preco_id: tabela que fixou os preços do pedido.
 *  - produtos.prato_do_dia: destaque no painel de venda.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS tabelas_preco (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     nome VARCHAR(60) NOT NULL,
     prioridade INTEGER NOT NULL DEFAULT 1 CHECK (prioridade BETWEEN 1 AND 99),
     ativa BOOLEAN NOT NULL DEFAULT true,
     origens TEXT[],
     dias SMALLINT[],
     hora_inicio TIME,
     hora_fim TIME,
     criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (tenant_id, nome),
     CHECK ((hora_inicio IS NULL) = (hora_fim IS NULL))
   )`,
  `CREATE TABLE IF NOT EXISTS precos_tabela (
     tabela_id UUID NOT NULL REFERENCES tabelas_preco(id) ON DELETE CASCADE,
     produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
     preco NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
     PRIMARY KEY (tabela_id, produto_id)
   )`,
  `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tabela_preco_id UUID REFERENCES tabelas_preco(id) ON DELETE SET NULL`,
  `ALTER TABLE produtos ADD COLUMN IF NOT EXISTS prato_do_dia BOOLEAN NOT NULL DEFAULT false`,
];
