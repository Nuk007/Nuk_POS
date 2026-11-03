'use strict';
/**
 * Migração: módulos contratados por estabelecimento (`tenants.modulos`, lista JSON de chaves de licença).
 * NULL = todos os módulos já disponíveis (estabelecimentos existentes não perdem nada).
 */
exports.up = (pgm) => { pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS modulos JSONB;`); };
exports.down = (pgm) => { pgm.sql(`ALTER TABLE tenants DROP COLUMN IF EXISTS modulos;`); };
