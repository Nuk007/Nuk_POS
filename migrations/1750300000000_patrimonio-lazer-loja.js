'use strict';
/**
 * Migração: Património (registo de bens com depreciação linear) e origens de venda LAZER e LOJA.
 * Bens nunca se apagam: abatem-se (com motivo). O código PAT-0001… é único por estabelecimento.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_origem_check;
    ALTER TABLE pedidos ADD CONSTRAINT pedidos_origem_check CHECK (origem IN ('MESA','BALCAO','REMOTA','TAKEAWAY','LAZER','LOJA'));

    CREATE TABLE IF NOT EXISTS patrimonio_bens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      codigo VARCHAR(20) NOT NULL,
      nome VARCHAR(160) NOT NULL,
      categoria VARCHAR(30) NOT NULL,
      localizacao VARCHAR(120),
      data_aquisicao DATE NOT NULL,
      valor_aquisicao NUMERIC(15,2) NOT NULL CHECK (valor_aquisicao >= 0),
      vida_util_anos INTEGER NOT NULL CHECK (vida_util_anos BETWEEN 1 AND 100),
      estado VARCHAR(10) NOT NULL DEFAULT 'BOM' CHECK (estado IN ('BOM','REGULAR','MAU','ABATIDO')),
      observacoes TEXT,
      abatido_em TIMESTAMPTZ,
      motivo_abate TEXT,
      criado_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, codigo)
    );
    CREATE INDEX IF NOT EXISTS idx_patrimonio_tenant ON patrimonio_bens (tenant_id, estado, categoria);
  `);
};
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS patrimonio_bens;
    ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_origem_check;
    ALTER TABLE pedidos ADD CONSTRAINT pedidos_origem_check CHECK (origem IN ('MESA','BALCAO','REMOTA','TAKEAWAY'));`);
};
