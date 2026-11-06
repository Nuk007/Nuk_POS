'use strict';
/**
 * Migração: fluxo de venda do pedido (Mesa | Balcão | Remota | Take Away) e validação do caixa.
 *  - pedidos.origem: de onde veio a venda.
 *  - pedidos.validado_em / validado_por: os pedidos REMOTOS (QR do cliente) chegam por validar; o caixa valida ou recusa.
 * Dados antigos: com mesa → MESA; sem funcionário (portal) → REMOTA; resto → BALCAO. Todos ficam já validados.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origem VARCHAR(10) NOT NULL DEFAULT 'BALCAO';
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS validado_em TIMESTAMPTZ;
    ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS validado_por UUID REFERENCES funcionarios(id);
    ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_origem_check;
    ALTER TABLE pedidos ADD CONSTRAINT pedidos_origem_check CHECK (origem IN ('MESA','BALCAO','REMOTA','TAKEAWAY'));
    UPDATE pedidos SET origem = 'MESA' WHERE mesa_id IS NOT NULL;
    UPDATE pedidos SET origem = 'REMOTA' WHERE funcionario_id IS NULL;
    UPDATE pedidos SET validado_em = criado_em WHERE validado_em IS NULL;
    CREATE INDEX IF NOT EXISTS idx_pedidos_por_validar ON pedidos (tenant_id, criado_em) WHERE origem = 'REMOTA' AND validado_em IS NULL;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_pedidos_por_validar;
    ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_origem_check;
    ALTER TABLE pedidos DROP COLUMN IF EXISTS validado_por, DROP COLUMN IF EXISTS validado_em, DROP COLUMN IF EXISTS origem;
  `);
};
