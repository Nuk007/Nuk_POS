'use strict';
/**
 * Cartões de consumo pré-impressos (20/11/2026). O estabelecimento gera um lote de códigos, imprime-os em cartolina
 * e cada cartão fica POR_VENDER (saldo 0, não paga nada) até o caixa o vender: aí passa a ACTIVO com o saldo do
 * valor impresso, cobrado ao cliente sem desconto. Partilhado pela migração 1752100000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS cartoes_lotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    numero INT NOT NULL,
    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    quantidade INT NOT NULL CHECK (quantidade BETWEEN 1 AND 200),
    criado_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, numero)
  )`,
  `ALTER TABLE cartoes_consumo ADD COLUMN IF NOT EXISTS lote_id UUID REFERENCES cartoes_lotes(id) ON DELETE CASCADE`,
  `ALTER TABLE cartoes_consumo ADD COLUMN IF NOT EXISTS estado VARCHAR(12) NOT NULL DEFAULT 'ACTIVO'`,
  `ALTER TABLE cartoes_consumo ADD COLUMN IF NOT EXISTS vendido_em TIMESTAMPTZ`,
  // cartões antigos foram vendidos no momento em que nasceram
  `UPDATE cartoes_consumo SET vendido_em = criado_em WHERE vendido_em IS NULL AND estado = 'ACTIVO'`,
  `ALTER TABLE cartoes_consumo DROP CONSTRAINT IF EXISTS cartoes_consumo_estado_check`,
  `ALTER TABLE cartoes_consumo ADD CONSTRAINT cartoes_consumo_estado_check CHECK (estado IN ('POR_VENDER','ACTIVO'))`,
  `CREATE INDEX IF NOT EXISTS idx_cartoes_lote ON cartoes_consumo (lote_id) WHERE lote_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_cartoes_vendidos ON cartoes_consumo (tenant_id, vendido_em DESC) WHERE estado = 'ACTIVO'`,
];
