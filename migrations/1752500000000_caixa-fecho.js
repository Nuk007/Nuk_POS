'use strict';
/**
 * Migração: fecho do caixa com regras (20/11/2026, regra do dono). Acrescenta caixa_sessoes.justificacao, o índice das
 * contas por pagar e sela a justificação no trigger da sessão. O SQL vive em server/migrations-data/caixa-auditoria.js
 * (idempotente, partilhado com db.js), por isso esta migração volta a aplicá-lo tal como está.
 */
const instrucoes = require('../server/migrations-data/caixa-auditoria');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql(`DROP INDEX IF EXISTS idx_pedidos_por_pagar`); };
