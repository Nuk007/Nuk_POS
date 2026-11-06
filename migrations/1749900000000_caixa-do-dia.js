'use strict';
/**
 * Migração: Caixa do dia (turnos), cartões de consumo pré-pagos e recebimento dos pedidos fechados.
 *  - caixa_sessoes: abre com fundo, fecha com contagem (esperado = fundo + dinheiro recebido). Uma aberta por estabelecimento.
 *  - caixa_movimentos: livro-razão do caixa (valor com sinal; saídas, como as compras pontuais, serão negativas).
 *  - cartoes_consumo / movimentos_cartao: cartão físico com código e saldo (livro-razão: saldo = Σ movimentos).
 *  - pedidos.pago_em/pago_metodo/pago_por: pedido já recebido. Dados antigos FECHADOS ficam como pagos.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS caixa_sessoes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      aberta_por UUID REFERENCES funcionarios(id),
      aberta_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fundo_inicial NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (fundo_inicial >= 0),
      fechada_por UUID REFERENCES funcionarios(id),
      fechada_em TIMESTAMPTZ,
      esperado NUMERIC(15,2),
      contado NUMERIC(15,2),
      diferenca NUMERIC(15,2),
      observacoes TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_sessao_aberta ON caixa_sessoes (tenant_id) WHERE fechada_em IS NULL;
    CREATE INDEX IF NOT EXISTS idx_caixa_sessoes_tenant ON caixa_sessoes (tenant_id, aberta_em DESC);

    CREATE TABLE IF NOT EXISTS cartoes_consumo (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      codigo VARCHAR(16) NOT NULL,
      valor_inicial NUMERIC(15,2) NOT NULL CHECK (valor_inicial > 0),
      saldo NUMERIC(15,2) NOT NULL CHECK (saldo >= 0),
      vendido_por UUID REFERENCES funcionarios(id),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, codigo)
    );

    CREATE TABLE IF NOT EXISTS movimentos_cartao (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cartao_id UUID NOT NULL REFERENCES cartoes_consumo(id) ON DELETE CASCADE,
      tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('VENDA','CONSUMO','ESTORNO')),
      valor NUMERIC(15,2) NOT NULL,
      saldo_antes NUMERIC(15,2) NOT NULL,
      saldo_depois NUMERIC(15,2) NOT NULL,
      pedido_id UUID REFERENCES pedidos(id),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mov_cartao ON movimentos_cartao (cartao_id, criado_em);

    CREATE TABLE IF NOT EXISTS caixa_movimentos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sessao_id UUID NOT NULL REFERENCES caixa_sessoes(id),
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('NUKCOIN_CARREGAMENTO','CARTAO_VENDA','RECEBIMENTO','COMPRA')),
      metodo VARCHAR(15) NOT NULL CHECK (metodo IN ('CASH','TPA','TRANSFERENCIA','EXPRESS','NUKCOIN','CARTAO')),
      valor NUMERIC(15,2) NOT NULL,
      descricao TEXT,
      pedido_id UUID REFERENCES pedidos(id),
      cliente_id UUID REFERENCES clientes(id),
      cartao_id UUID REFERENCES cartoes_consumo(id),
      criado_por UUID REFERENCES funcionarios(id),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_caixa_mov_sessao ON caixa_movimentos (sessao_id, criado_em);

    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pago_em TIMESTAMPTZ;
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pago_metodo VARCHAR(15);
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pago_por UUID REFERENCES funcionarios(id);
    UPDATE pedidos SET pago_em = atualizado_em, pago_metodo = COALESCE(metodo_pagamento, 'CASH') WHERE status = 'FECHADO' AND pago_em IS NULL;
    UPDATE pedidos SET pago_em = criado_em, pago_metodo = 'NUKCOIN' WHERE nukcoin_pago > 0 AND pago_em IS NULL;
    CREATE INDEX IF NOT EXISTS idx_pedidos_por_receber ON pedidos (tenant_id, atualizado_em) WHERE status = 'FECHADO' AND pago_em IS NULL;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_pedidos_por_receber;
    ALTER TABLE pedidos DROP COLUMN IF EXISTS pago_por, DROP COLUMN IF EXISTS pago_metodo, DROP COLUMN IF EXISTS pago_em;
    DROP TABLE IF EXISTS caixa_movimentos; DROP TABLE IF EXISTS movimentos_cartao; DROP TABLE IF EXISTS cartoes_consumo; DROP TABLE IF EXISTS caixa_sessoes;
  `);
};
