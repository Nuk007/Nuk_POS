'use strict';
/**
 * Despesas do estabelecimento (14/11/2026): renda, salários, energia, manutenção… para o resultado (lucro) real.
 * Uma despesa paga pela gaveta é também uma saída de dinheiro do caixa do dia (tipo DESPESA, valor negativo).
 * Partilhado pela migração 1751400000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS despesas (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     categoria VARCHAR(30) NOT NULL CHECK (categoria IN ('SALARIOS','RENDA','ENERGIA','AGUA','COMBUSTIVEL','MANUTENCAO','MARKETING','IMPOSTOS','OUTRA')),
     descricao VARCHAR(200) NOT NULL,
     valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
     data DATE NOT NULL,
     pela_gaveta BOOLEAN NOT NULL DEFAULT false,
     sessao_id UUID REFERENCES caixa_sessoes(id) ON DELETE SET NULL,
     criado_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
     criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     anulada_em TIMESTAMPTZ,
     anulada_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
     motivo_anulacao VARCHAR(200)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_despesas_tenant_data ON despesas (tenant_id, data DESC)`,
  `ALTER TABLE caixa_movimentos ADD COLUMN IF NOT EXISTS despesa_id UUID REFERENCES despesas(id) ON DELETE SET NULL`,
  `ALTER TABLE caixa_movimentos DROP CONSTRAINT IF EXISTS caixa_movimentos_tipo_check`,
  `ALTER TABLE caixa_movimentos ADD CONSTRAINT caixa_movimentos_tipo_check
     CHECK (tipo IN ('NUKCOIN_CARREGAMENTO','CARTAO_VENDA','RECEBIMENTO','COMPRA','CONTA_PAGAMENTO','DESPESA'))`,
];
