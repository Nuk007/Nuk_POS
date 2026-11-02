'use strict';
/**
 * Migração: itens a controlar no dashboard (configuráveis por estabelecimento) e os seus registos manuais
 * (contadores como «pessoas na piscina» e pendências como «reclamações abertas/tratadas»).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS dashboard_itens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      nome VARCHAR(80) NOT NULL,
      fonte VARCHAR(20) NOT NULL,
      ref VARCHAR(80),
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_itens_tenant ON dashboard_itens(tenant_id, ordem);
    CREATE TABLE IF NOT EXISTS dashboard_registos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id UUID NOT NULL REFERENCES dashboard_itens(id) ON DELETE CASCADE,
      evento VARCHAR(10) NOT NULL CHECK (evento IN ('MAIS','MENOS','ABRIR','TRATAR')),
      funcionario_id UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_registos_item ON dashboard_registos(tenant_id, item_id, criado_em);`);
};
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS dashboard_registos; DROP TABLE IF EXISTS dashboard_itens;`);
};
