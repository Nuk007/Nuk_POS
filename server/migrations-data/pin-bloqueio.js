'use strict';
/**
 * Bloqueio do PIN do portal gravado por cliente (20/11/2026). Partilhado pela migração 1752800000000 e por db.js
 * (corre em cada arranque: idempotente). Ver portal.service (exigirPin / tratarFalhaPin).
 */
module.exports = [
  `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pin_falhas INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pin_bloqueios INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pin_bloqueado_ate TIMESTAMPTZ`,
];
