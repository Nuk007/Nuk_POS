'use strict';
/** Migração: WhatsApp oficial e resumo diário (SQL em server/migrations-data/whatsapp-resumo.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/whatsapp-resumo');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('DROP TABLE IF EXISTS resumos_diarios'); pgm.sql('DROP TABLE IF EXISTS mensagens_whatsapp'); };
