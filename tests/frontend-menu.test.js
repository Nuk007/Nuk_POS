'use strict';
// Menu lateral em acordeão (pedido do dono, 22/11/2026): só as categorias à vista, sem barra de rolagem visível.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/nukpos.css'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../public/js/nukpos-ui.js'), 'utf8');

describe('Menu lateral em acordeão', () => {
  test('cada categoria tem um título que é um botão de abrir/fechar, fechado ao arrancar', () => {
    const grupos = html.match(/<div class="nav-grupo">/g) || [];
    const titulos = html.match(/<button type="button" class="nav-titulo sem-relevo" data-action="nav-grupo" aria-expanded="false">/g) || [];
    expect(grupos.length).toBeGreaterThan(3);
    expect(titulos.length).toBe(grupos.length);
    expect(html).not.toMatch(/<div class="nav-titulo">/);
  });

  test('categoria fechada esconde os módulos; a barra de rolagem não aparece', () => {
    expect(css).toMatch(/\.nav-grupo:not\(\.aberto\) > :not\(\.nav-titulo\) \{ display: none !important; \}/);
    expect(css).toMatch(/\.sidebar-nav \{ scrollbar-width: none;/);
    expect(css).toMatch(/\.sidebar-nav::-webkit-scrollbar \{ display: none;/);
  });

  test('tocar no título alterna a categoria e mudar de módulo abre a categoria dele', () => {
    expect(ui).toMatch(/action === 'nav-grupo'/);
    expect(ui).toMatch(/function abrirGrupoNav\(grupo, abrir/);
    expect(ui).toMatch(/abrirGrupoNav\(activo\.closest\('\.nav-grupo'\), true, false\)/);
  });
});
