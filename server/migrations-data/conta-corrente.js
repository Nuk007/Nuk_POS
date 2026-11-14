'use strict';
/**
 * Conta corrente de clientes (benchmarking WinREST, 14/11/2026). Partilhado pela migração 1750700000000 e por db.js.
 *  - clientes.conta_corrente_ativa / limite_credito: o ADMIN autoriza o cliente e fixa o limite (Configurações).
 *  - conta_corrente_movimentos: livro-razão (DEBITO = consumo lançado na conta; PAGAMENTO = liquidação no Caixa).
 *    Saldo em dívida = Σ DEBITO − Σ PAGAMENTO.
 *  - caixa_movimentos aceita o tipo CONTA_PAGAMENTO (o dinheiro da liquidação entra no caixa do dia).
 */
module.exports = [
  `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS conta_corrente_ativa BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS limite_credito NUMERIC(15,2) NOT NULL DEFAULT 0`,
  `DO $$ BEGIN
     ALTER TABLE clientes ADD CONSTRAINT clientes_limite_credito_check CHECK (limite_credito >= 0);
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS conta_corrente_movimentos (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
     tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('DEBITO','PAGAMENTO')),
     valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
     metodo VARCHAR(15),
     pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
     sessao_id UUID REFERENCES caixa_sessoes(id) ON DELETE SET NULL,
     descricao TEXT,
     criado_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
     criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cc_mov_cliente ON conta_corrente_movimentos (cliente_id, criado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_cc_mov_tenant ON conta_corrente_movimentos (tenant_id, criado_em)`,
  `ALTER TABLE caixa_movimentos DROP CONSTRAINT IF EXISTS caixa_movimentos_tipo_check`,
  `ALTER TABLE caixa_movimentos ADD CONSTRAINT caixa_movimentos_tipo_check
     CHECK (tipo IN ('NUKCOIN_CARREGAMENTO','CARTAO_VENDA','RECEBIMENTO','COMPRA','CONTA_PAGAMENTO'))`,
];
