'use strict';
/**
 * O antigo modulos.js (2 100 linhas) foi dividido por área a 21/11/2026. Os testes que precisam do conjunto
 * carregam-no por esta ordem — a mesma do index.html (tests/frontend-modulos.test.js verifica).
 */
const fs = require('fs');
const path = require('path');

const MODULOS = ['modulos.js', 'mesas-quartos.js', 'produtos-stock.js', 'financeiro.js', 'clientes.js',
  'funcionarios.js', 'config-cartoes.js', 'configuracoes.js'];

const ler = f => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
/** Código de todos os ficheiros dos módulos, pela ordem do index.html. */
const lerModulos = () => MODULOS.map(ler).join('\n');

module.exports = { MODULOS, lerModulos };
