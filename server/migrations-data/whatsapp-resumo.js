'use strict';
/**
 * WhatsApp oficial (Meta Cloud API) e resumo diário para o dono (14/11/2026).
 * `mensagens_whatsapp` = registo de cada envio (auditoria); `resumos_diarios` = um resumo por estabelecimento e dia
 * (a chave única garante um só envio, mesmo com várias instâncias do servidor).
 * Partilhado pela migração 1751600000000 e por db.js.
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS mensagens_whatsapp (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
     para VARCHAR(20) NOT NULL,
     tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('TEMPLATE','TEXTO')),
     template VARCHAR(80),
     finalidade VARCHAR(40) NOT NULL,
     estado VARCHAR(10) NOT NULL CHECK (estado IN ('ENVIADA','FALHOU')),
     meta_id VARCHAR(120),
     erro VARCHAR(300),
     criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mensagens_whatsapp_tenant ON mensagens_whatsapp (tenant_id, criado_em DESC)`,
  `CREATE TABLE IF NOT EXISTS resumos_diarios (
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     dia DATE NOT NULL,
     conteudo JSONB,
     canal VARCHAR(10) CHECK (canal IN ('WHATSAPP','APP')),
     estado VARCHAR(12) NOT NULL DEFAULT 'A_PREPARAR' CHECK (estado IN ('A_PREPARAR','ENVIADO','SO_APP','FALHOU')),
     erro VARCHAR(300),
     criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     enviado_em TIMESTAMPTZ,
     PRIMARY KEY (tenant_id, dia)
   )`,
];
