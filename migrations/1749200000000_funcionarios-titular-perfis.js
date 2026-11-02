'use strict';
/**
 * Migração: titular do estabelecimento e perfis de quartos.
 *  - titular: a 1.ª conta (ADMIN) de cada estabelecimento; não se apaga nem despromove, só transfere a titularidade.
 *    Um único titular por tenant (índice parcial único).
 *  - pode_vender_quartos: só estes funcionários vendem/reservam/abrem quartos.
 *  - arruma_quartos: recebem os avisos de arrumação e marcam o quarto como limpo.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS titular BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS pode_vender_quartos BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS arruma_quartos BOOLEAN NOT NULL DEFAULT false;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionarios_titular ON funcionarios(tenant_id) WHERE titular;
    -- estabelecimentos existentes: o ADMIN mais antigo passa a titular
    UPDATE funcionarios f SET titular = true
    WHERE f.nivel_acesso = 'ADMIN' AND f.tenant_id IS NOT NULL
      AND f.id = (SELECT id FROM funcionarios x WHERE x.tenant_id = f.tenant_id AND x.nivel_acesso = 'ADMIN' ORDER BY x.criado_em, x.id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM funcionarios y WHERE y.tenant_id = f.tenant_id AND y.titular);`);
};
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS uq_funcionarios_titular;
    ALTER TABLE funcionarios DROP COLUMN IF EXISTS titular, DROP COLUMN IF EXISTS pode_vender_quartos, DROP COLUMN IF EXISTS arruma_quartos;`);
};
