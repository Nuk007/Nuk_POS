'use strict';
/**
 * Migração: vendas de quartos pelos botões + fluxo de arrumação.
 *  - reservas: quem vendeu, hora real de saída (abrir quarto antes da hora) e marca do aviso «faltam 5 min»;
 *  - quarto_limpezas: cada arrumação tem prazo (30 min), pode ser escalada para a chefia e mede o atraso na abertura.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE reservas ADD COLUMN IF NOT EXISTS criado_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL;
    ALTER TABLE reservas ADD COLUMN IF NOT EXISTS saida_em TIMESTAMPTZ;
    ALTER TABLE reservas ADD COLUMN IF NOT EXISTS aviso_fim_em TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_reservas_estado_checkout ON reservas(status, checkout);

    CREATE TABLE IF NOT EXISTS quarto_limpezas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      quarto_id UUID NOT NULL REFERENCES quartos(id) ON DELETE CASCADE,
      reserva_id UUID REFERENCES reservas(id) ON DELETE SET NULL,
      origem VARCHAR(12) NOT NULL CHECK (origem IN ('ABERTO','FIM_TEMPO')),
      aviso_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      prazo_em TIMESTAMPTZ NOT NULL,
      escalado_em TIMESTAMPTZ,
      limpo_em TIMESTAMPTZ,
      limpo_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
      atraso_min INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_limpeza_aberta ON quarto_limpezas(quarto_id) WHERE limpo_em IS NULL;
    CREATE INDEX IF NOT EXISTS idx_limpezas_prazo ON quarto_limpezas(prazo_em) WHERE limpo_em IS NULL AND escalado_em IS NULL;
    CREATE INDEX IF NOT EXISTS idx_limpezas_tenant_dia ON quarto_limpezas(tenant_id, prazo_em);`);
};
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS quarto_limpezas;
    DROP INDEX IF EXISTS idx_reservas_estado_checkout;
    ALTER TABLE reservas DROP COLUMN IF EXISTS aviso_fim_em, DROP COLUMN IF EXISTS saida_em, DROP COLUMN IF EXISTS criado_por;`);
};
