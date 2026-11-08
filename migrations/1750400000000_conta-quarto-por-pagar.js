'use strict';
/**
 * Migração: consumos ligados ao quarto (origem QUARTO + pedidos.quarto_id) e estado POR_PAGAR do quarto.
 * Regra: mesa/quarto com conta por pagar continua «em uso» até o Caixa receber.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS quarto_id UUID REFERENCES quartos(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_pedidos_quarto ON pedidos (quarto_id) WHERE quarto_id IS NOT NULL;
    ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_origem_check;
    ALTER TABLE pedidos ADD CONSTRAINT pedidos_origem_check CHECK (origem IN ('MESA','BALCAO','REMOTA','TAKEAWAY','LAZER','LOJA','QUARTO'));
    ALTER TABLE quartos DROP CONSTRAINT IF EXISTS quartos_status_check;
    ALTER TABLE quartos ADD CONSTRAINT quartos_status_check CHECK (status IN ('DISPONIVEL','OCUPADO','LIMPEZA','POR_PAGAR','MANUTENCAO','BLOQUEADO'));
  `);
};
exports.down = () => {};
