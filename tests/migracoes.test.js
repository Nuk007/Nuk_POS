'use strict';
/**
 * Guarda das migrações: os valores por omissão de texto têm de usar pgm.func("'X'").
 * Com "'X'" (string simples) o node-pg-migrate escapa as aspas e a coluna fica com o valor «'X'» entre aspas,
 * que viola os CHECK (ex.: mesas.status). Só se notava numa base nova criada pelas migrações (instalação nova ou
 * «recomeçar do zero»), porque a produção foi criada pelo initDB().
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'migrations');

test.each(fs.readdirSync(dir).filter(f => f.endsWith('.js')))('%s: sem valores por omissão de texto entre aspas duplas', f => {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  expect(/default:\s*["']'/.test(src)).toBe(false);
});
