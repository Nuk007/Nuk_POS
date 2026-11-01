'use strict';
/**
 * Migração: solicitações do portal do cliente (hospedagem, serviços e eventos).
 *
 * Até aqui os pedidos de serviços e eventos feitos no portal não chegavam ao POS: os eventos nem eram enviados
 * e a tabela solicitacoes_hospedagem só aceita as três fracções de quarto. Esta tabela guarda qualquer
 * solicitação com o contacto do cliente, para a equipa a ver e tratar no módulo «Solicitações».
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS solicitacoes_portal (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      tipo VARCHAR(12) NOT NULL CHECK (tipo IN ('HOSPEDAGEM','SERVICO','EVENTO')),
      nome_servico VARCHAR(120) NOT NULL,
      nome_contacto VARCHAR(200) NOT NULL,
      telefone_contacto VARCHAR(30) NOT NULL,
      observacoes TEXT,
      status VARCHAR(12) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','CONFIRMADA','CANCELADA')),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // padrão de acesso: caixa de entrada do estabelecimento, por estado, mais recentes primeiro
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_solic_portal_tenant_status ON solicitacoes_portal(tenant_id, status, criado_em DESC)`);
};
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS solicitacoes_portal`);
};
