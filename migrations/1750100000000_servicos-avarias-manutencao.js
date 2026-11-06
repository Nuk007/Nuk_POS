'use strict';
/**
 * Migração: Serviços — ativos (infraestrutura física e móvel), ocorrências (avarias e danos)
 * e prazos de manutenção (planos periódicos + registo de cada manutenção realizada).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ativos_servico (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      nome VARCHAR(120) NOT NULL,
      tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('FISICA','MOVEL')),
      localizacao VARCHAR(120),
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ativos_servico_tenant ON ativos_servico (tenant_id, ativo);

    CREATE TABLE IF NOT EXISTS ocorrencias_servico (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ativo_id UUID REFERENCES ativos_servico(id),
      tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('AVARIA','DANO')),
      titulo VARCHAR(160) NOT NULL,
      descricao TEXT,
      prioridade VARCHAR(10) NOT NULL DEFAULT 'MEDIA' CHECK (prioridade IN ('BAIXA','MEDIA','ALTA','URGENTE')),
      estado VARCHAR(12) NOT NULL DEFAULT 'ABERTA' CHECK (estado IN ('ABERTA','EM_CURSO','RESOLVIDA','CANCELADA')),
      reportado_por UUID REFERENCES funcionarios(id),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolvido_em TIMESTAMPTZ,
      resolucao TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ocorrencias_servico ON ocorrencias_servico (tenant_id, estado, criado_em DESC);

    CREATE TABLE IF NOT EXISTS manutencoes_plano (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ativo_id UUID NOT NULL REFERENCES ativos_servico(id),
      descricao VARCHAR(200) NOT NULL,
      periodicidade_dias INTEGER NOT NULL CHECK (periodicidade_dias BETWEEN 1 AND 3650),
      ultima_em DATE,
      proxima_em DATE NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_manutencoes_prazo ON manutencoes_plano (tenant_id, proxima_em) WHERE ativo;

    CREATE TABLE IF NOT EXISTS manutencoes_registo (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      plano_id UUID NOT NULL REFERENCES manutencoes_plano(id) ON DELETE CASCADE,
      realizada_em DATE NOT NULL,
      observacoes TEXT,
      realizada_por UUID REFERENCES funcionarios(id),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_manutencoes_registo ON manutencoes_registo (plano_id, realizada_em DESC);
  `);
};
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS manutencoes_registo; DROP TABLE IF EXISTS manutencoes_plano; DROP TABLE IF EXISTS ocorrencias_servico; DROP TABLE IF EXISTS ativos_servico;`);
};
