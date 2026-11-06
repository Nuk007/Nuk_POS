'use strict';
/** Botões em relevo que afundam ao carregar: todas as páginas carregam o CSS e o CSS cobre o essencial. */
const fs = require('fs');
const path = require('path');
const pub = f => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

describe('Botões suaves (todo o sistema)', () => {
  test.each(['index.html', 'cliente.html', 'activate.html', 'superadmin.html'])('%s carrega botoes.css', f => {
    expect(pub(f)).toContain('<link rel="stylesheet" href="/css/botoes.css">');
  });
  test('o service worker guarda o CSS dos botões para uso offline', () => {
    expect(fs.readFileSync(path.join(__dirname, '../server/pwa/sw.template.js'), 'utf8')).toContain('/css/botoes.css');
  });
  test('relevo e estado carregado cobrem button, input de submissão, role=button e .btn; ícones só cedem ao toque', () => {
    const css = pub('css/botoes.css');
    expect(css).toMatch(/:where\(button, input\[type="button"\], input\[type="submit"\]/);
    expect(css).toContain(':active:not(:disabled');
    expect(css).toMatch(/scale\(\.98\)/);
    expect(css).toMatch(/inset 4px 4px 9px/); // fica «para dentro»
    expect(css).toContain('.btn-fechar-modal');
    expect(css).toContain('prefers-reduced-motion');
  });
  test('nenhum botão do POS desliga o relevo (sem box-shadow:none nos seletores de botão)', () => {
    const css = pub('css/nukpos.css');
    expect(css).not.toMatch(/(\.btn[\w-]*|button)[^{]*\{[^}]*box-shadow:\s*none/);
  });
});
