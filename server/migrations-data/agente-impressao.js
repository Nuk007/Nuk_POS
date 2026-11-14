'use strict';
/**
 * Agente local de impressão em rede (14/11/2026): impressoras térmicas Wi-Fi/cabo (IP:9100) recebem os trabalhos
 * por um pequeno programa que corre num computador da rede do estabelecimento (agente-impressao/agente.js).
 * Partilhado pela migração 1751900000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS agentes_impressao (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     nome VARCHAR(80) NOT NULL,
     token_hash CHAR(64) NOT NULL UNIQUE,
     criado_por UUID,
     criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     ultimo_contacto TIMESTAMPTZ,
     revogado_em TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS idx_agentes_impressao_tenant ON agentes_impressao (tenant_id)`,
  `CREATE TABLE IF NOT EXISTS trabalhos_impressao (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     impressora VARCHAR(60) NOT NULL,
     dados TEXT NOT NULL,
     estado VARCHAR(10) NOT NULL DEFAULT 'PENDENTE' CHECK (estado IN ('PENDENTE','A_ENVIAR','ENVIADO','FALHOU')),
     tentativas INT NOT NULL DEFAULT 0,
     erro VARCHAR(300),
     agente_id UUID REFERENCES agentes_impressao(id) ON DELETE SET NULL,
     criado_por UUID,
     criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     reclamado_em TIMESTAMPTZ,
     concluido_em TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS idx_trabalhos_impressao_fila ON trabalhos_impressao (tenant_id, criado_em) WHERE estado IN ('PENDENTE','A_ENVIAR')`,
];
