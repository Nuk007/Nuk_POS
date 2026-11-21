'use strict';
/**
 * Arquitectura (CLAUDE.md, «Rotas finas»): nenhuma rota fala com a base de dados; a lógica e o SQL vivem nos serviços.
 * Desde 21/11/2026 as últimas rotas que consultavam a base directamente (produtos, configurações, dashboard, PWA,
 * QR do portal, pedidos de hospedagem antigos, preços) passaram para a camada de serviço.
 */
const fs = require('fs');
const path = require('path');

const pasta = path.join(__dirname, '../server/routes');
const rotas = fs.readdirSync(pasta).filter(f => f.endsWith('.js'));

test.each(rotas)('%s não usa a base de dados directamente', f => {
  const s = fs.readFileSync(path.join(pasta, f), 'utf8');
  expect(s).not.toMatch(/require\(['"]\.\.\/db['"]\)/);
  expect(s).not.toMatch(/\bpool\.(query|connect)\(/);
  expect(s).not.toMatch(/\bclient\.query\(/);
});
