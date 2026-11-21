'use strict';
/** Ecrã de licença (licenca.js) em vm: bloqueio com data e suporte, aviso dos 7 dias, e ligação no api(). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function carregar(respostaLicenca) {
  const store = {}, els = {};
  const el = id => els[id] || (els[id] = { id, textContent: '', href: '', style: {}, addEventListener(ev, fn) { this['_' + ev] = fn; } });
  const ctx = {
    console, Promise, Date, JSON, encodeURIComponent,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { getElementById: el },
    api: async () => { if (respostaLicenca instanceof Error) throw respostaLicenca; return respostaLicenca; },
    toast: (...a) => { ctx._toast = a; }, logout: () => { ctx._logout = true; }, iniciarApp: () => { ctx._iniciou = true; },
  };
  ctx._els = els; ctx._store = store;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/licenca.js'), 'utf8'), ctx);
  return ctx;
}

describe('licenca.js', () => {
  test('licença expirada: bloqueia, esconde a app, mostra a data e o WhatsApp do suporte', async () => {
    const ctx = carregar({ situacao: 'EXPIRADA', estabelecimento: 'Casa Nuk', fim: '2026-11-14T10:00:00Z', suporte_whatsapp: '244923000111' });
    expect(await ctx.verificarLicenca()).toBe(true);
    expect(ctx._els.app.style.display).toBe('none');
    expect(ctx._els['tela-licenca'].style.display).toBe('flex');
    expect(ctx._els['licenca-titulo'].textContent).toBe('A licença expirou');
    expect(ctx._els['licenca-texto'].textContent).toContain('14/11/2026');
    expect(ctx._els['licenca-texto'].textContent).toContain('Casa Nuk');
    expect(ctx._els['licenca-suporte'].href).toMatch(/^https:\/\/wa\.me\/244923000111\?text=/);
    expect(ctx._els['licenca-suporte'].style.display).toBe('');
  });

  test('conta suspensa e sem número de suporte: título próprio, sem botão', async () => {
    const ctx = carregar({ situacao: 'SUSPENSA', suporte_whatsapp: null });
    expect(await ctx.verificarLicenca()).toBe(true);
    expect(ctx._els['licenca-titulo'].textContent).toBe('Conta suspensa');
    expect(ctx._els['licenca-suporte'].style.display).toBe('none');
  });

  test('activa a 3 dias do fim: segue o arranque e mostra a faixa; fechar esconde-a até ao dia seguinte', async () => {
    const ctx = carregar({ situacao: 'ACTIVA', aviso: true, dias_restantes: 3, fim: '2026-11-17T10:00:00Z', suporte_whatsapp: null });
    expect(await ctx.verificarLicenca()).toBe(false);
    expect(ctx._els['aviso-licenca'].style.display).toBe('flex');
    expect(ctx._els['aviso-licenca-texto'].textContent).toContain('daqui a 3 dias');
    ctx._els['aviso-licenca-fechar']._click();
    expect(ctx._els['aviso-licenca'].style.display).toBe('none');
    await ctx.verificarLicenca();
    expect(ctx._els['aviso-licenca'].style.display).toBe('none');
  });

  test('sem resposta do servidor não bloqueia; um 403 a meio mostra o ecrã com a data da resposta', async () => {
    const ctx = carregar(new Error('rede'));
    expect(await ctx.verificarLicenca()).toBe(false);
    await ctx.mostrarLicencaBloqueada({ codigo: 'LICENCA_EXPIRADA', fim: '2026-11-13T10:00:00Z' });
    expect(ctx._els['tela-licenca'].style.display).toBe('flex');
    expect(ctx._els['licenca-texto'].textContent).toContain('13/11/2026');
  });

  test('«Já renovei» volta a arrancar quando a licença está activa', async () => {
    const ctx = carregar({ situacao: 'ACTIVA', aviso: false });
    await ctx._els['licenca-tentar']._click();
    expect(ctx._iniciou).toBe(true);
    expect(ctx._els['tela-licenca'].style.display).toBe('none');
  });

  test('o api() de nukpos.js chama o ecrã nos 403 de licença e o arranque verifica a licença primeiro', () => {
    const src = require('./frontend-ficheiros').lerGrupo('nukpos');
    expect(src).toMatch(/LICENCA_EXPIRADA', 'TENANT_SUSPENSA'\]\.includes\(json\.codigo\)/);
    expect(src.indexOf('verificarLicenca()')).toBeLessThan(src.indexOf('verificarAdesao()'));
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    for (const id of ['tela-licenca', 'licenca-suporte', 'licenca-tentar', 'licenca-sair', 'aviso-licenca', 'aviso-licenca-fechar']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('<script src="/js/licenca.js"></script>');
  });
});
