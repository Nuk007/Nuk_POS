'use strict';
/** Migração: agente local de impressão em rede (SQL em server/migrations-data/agente-impressao.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/agente-impressao');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql('DROP TABLE IF EXISTS trabalhos_impressao'); pgm.sql('DROP TABLE IF EXISTS agentes_impressao'); };
