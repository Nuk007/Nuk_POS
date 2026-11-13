'use strict';
/**
 * Migração: Contrato de Adesão à Plataforma Nuk_POS da GESTNUK AI (decisão do dono de 13/11/2026).
 * Um registo por estabelecimento e versão das condições gerais; guarda o texto assinado e a impressão
 * digital (SHA-256 do texto + nome + data + estabelecimento). Nunca se edita nem se apaga.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS adesoes_plataforma (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      versao VARCHAR(40) NOT NULL,
      texto TEXT NOT NULL,
      texto_hash CHAR(64) NOT NULL,
      assinado_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
      nome_escrito VARCHAR(160) NOT NULL,
      assinado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip VARCHAR(60),
      dispositivo VARCHAR(200),
      hash CHAR(64) NOT NULL,
      UNIQUE (tenant_id, versao)
    );
  `);
};
exports.down = (pgm) => { pgm.sql('DROP TABLE IF EXISTS adesoes_plataforma;'); };
