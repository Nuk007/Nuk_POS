'use strict';
/**
 * Cartões de consumo configurados por estabelecimento (20/11/2026): cada tipo é um valor (com nome opcional) que
 * aparece como botão no Caixa → Cartões, como os quartos. Configura-se em Configurações (só ADMIN); não se apaga,
 * desactiva-se. Partilhado pela migração 1752300000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS cartoes_tipos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    valor NUMERIC(15,2) NOT NULL CHECK (valor >= 1000 AND valor <= 500000),
    nome VARCHAR(60),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, valor)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cartoes_por_vender ON cartoes_consumo (tenant_id, valor_inicial) WHERE estado = 'POR_VENDER'`,
];
