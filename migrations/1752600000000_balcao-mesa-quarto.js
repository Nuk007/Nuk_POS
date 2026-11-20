'use strict';
/** Migração: pedido nunca de mesa e quarto ao mesmo tempo + categoria PISCINA (SQL em server/migrations-data/balcao-mesa-quarto.js, partilhado com db.js). */
const instrucoes = require('../server/migrations-data/balcao-mesa-quarto');
exports.up = (pgm) => { for (const sql of instrucoes) pgm.sql(sql); };
exports.down = (pgm) => { pgm.sql(`ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_mesa_ou_quarto`); };
