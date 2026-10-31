'use strict';
/**
 * Migração: o pedido passa a guardar como foi pago e quanto foi pago em Nuk-Coin.
 * Sem isto não era possível reembolsar o cliente ao cancelar um pedido pago com Nuk-Coin.
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metodo_pagamento VARCHAR(20) DEFAULT 'CASH'`);
  pgm.sql(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS nukcoin_pago NUMERIC(15,2) NOT NULL DEFAULT 0`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_nukcoin_pedido ON movimentos_nukcoin(pedido_id) WHERE pedido_id IS NOT NULL`);
};
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_nukcoin_pedido`);
  pgm.sql(`ALTER TABLE pedidos DROP COLUMN IF EXISTS nukcoin_pago`);
  pgm.sql(`ALTER TABLE pedidos DROP COLUMN IF EXISTS metodo_pagamento`);
};
