'use strict';
/**
 * O antigo modulos.js (2 100 linhas) foi dividido por área a 21/11/2026. Os testes que precisam do conjunto
 * carregam-no por esta ordem — a mesma do index.html (tests/frontend-modulos.test.js verifica).
 */
const fs = require('fs');
const path = require('path');

const MODULOS = ['modulos.js', 'mesas-quartos.js', 'produtos-stock.js', 'financeiro.js', 'clientes.js',
  'funcionarios.js', 'config-cartoes.js', 'config-fluxos.js', 'configuracoes.js'];

/** Ficheiros que foram divididos a 21/11/2026, pela ordem em que as páginas os carregam. */
const GRUPOS = {
  modulos: MODULOS,
  nukpos: ['nukpos.js', 'nukpos-ui.js', 'navegacao.js'],
  caixa: ['caixa.js', 'caixa-receber.js', 'caixa-contas.js', 'caixa-producao.js'],
  cliente: ['cliente.js', 'cliente-pedidos.js'],
  superadmin: ['superadmin.js', 'superadmin-tenants.js'],
};
const PAGINA = { modulos: 'index.html', nukpos: 'index.html', caixa: 'index.html', cliente: 'cliente.html', superadmin: 'superadmin.html' };

const ler = f => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
/** Código de todos os ficheiros dos módulos, pela ordem do index.html. */
const lerModulos = () => MODULOS.map(ler).join('\n');
/** Código de um grupo (ex.: 'caixa'), pela ordem da página. */
const lerGrupo = nome => GRUPOS[nome].map(ler).join('\n');

module.exports = { MODULOS, GRUPOS, PAGINA, lerModulos, lerGrupo };
