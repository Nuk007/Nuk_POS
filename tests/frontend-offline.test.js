'use strict';
/** Modo sem internet (offline.js) em vm: cópia das leituras, fila de pedidos, sincronização e recusas. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function carregar(api) {
  const store = {}, els = {};
  const ctx = {
    console, window: {}, Promise, Date, JSON, NUK: { token: 't', utilizador: { tenant_slug: 'casa' } }, navigator: { onLine: true },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { getElementById: id => els[id] || (els[id] = { textContent: '', style: {} }) },
    api, toast: (...a) => { ctx._toast = a; }, esc: v => String(v ?? ''), abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {},
    modalConfirmar: (...a) => { ctx._confirmar = a; }, setInterval: () => 1, clearInterval() {},
  };
  ctx._store = store; ctx._els = els;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/offline.js'), 'utf8'), ctx);
  return ctx;
}
const corpo = (chave, origem = 'BALCAO') => ({ origem, itens: [{ produto_id: 'p1', quantidade: 2 }], chave_idempotencia: chave });
const semRede = () => Object.assign(new Error('Sem ligação ao servidor'), { semRede: true });

describe('offline.js', () => {
  test('guarda só as leituras do painel de venda, por estabelecimento', () => {
    const ctx = carregar();
    ctx.offlineGuardarLeitura('/produtos?disponivel=true', [{ id: 'p1' }]);
    ctx.offlineGuardarLeitura('/caixa', { aberta: true });
    expect(ctx.offlineLer('/produtos?disponivel=true')).toEqual([{ id: 'p1' }]);
    expect(ctx.offlineLer('/caixa')).toBeUndefined();
    expect(Object.keys(ctx._store)).toEqual(['nuk_cache:casa:/produtos?disponivel=true']);
  });

  test('fila: guarda com a hora real, não duplica a mesma chave, recusa pedido remoto', () => {
    const ctx = carregar();
    ctx.offlineGuardar(corpo('chave-0001'));
    ctx.offlineGuardar(corpo('chave-0001'));
    const f = ctx.offlineFila();
    expect(f).toHaveLength(1);
    expect(new Date(f[0].corpo.registado_em).getTime()).toBeLessThanOrEqual(Date.now());
    expect(() => ctx.offlineGuardar(corpo('chave-0002', 'REMOTA'))).toThrow(/ligação/);
    expect(ctx._els['offline-estado'].textContent).toBe('⏳ 1 por enviar');
  });

  test('sincronizar: envia por ordem; pára no erro de rede; recusa do servidor fica marcada', async () => {
    const enviados = [];
    let rede = false;
    const api = async (m, url, c) => {
      if (rede) throw semRede();
      if (c.chave_idempotencia === 'chave-0002') throw new Error('Stock insuficiente de Carvão');
      enviados.push(c.chave_idempotencia); return { id: 'x' };
    };
    const ctx = carregar(api);
    ['chave-0001', 'chave-0002', 'chave-0003'].forEach(k => ctx.offlineGuardar(corpo(k)));
    const r = await ctx.offlineSincronizar();
    expect(r).toEqual({ enviados: 2, recusados: 1 });
    expect(enviados).toEqual(['chave-0001', 'chave-0003']);
    const f = ctx.offlineFila();
    expect(f.map(x => [x.corpo.chave_idempotencia, x.recusado, x.erro])).toEqual([['chave-0002', true, 'Stock insuficiente de Carvão']]);
    expect(ctx._els['offline-estado'].textContent).toBe('⚠ 1 recusado');
    // sem rede: nada sai e nada se perde
    ctx.offlineGuardar(corpo('chave-0004'));
    rede = true;
    expect(await ctx.offlineSincronizar()).toEqual({ enviados: 0, recusados: 0 });
    expect(ctx.offlineFila()).toHaveLength(2);
  });

  test('descartar um recusado passa pela confirmação', () => {
    const ctx = carregar();
    ctx.offlineGuardar(corpo('chave-0001'));
    const f = ctx.offlineFila(); f[0].recusado = true; ctx.offlineGravarFila(f);
    ctx.modalOffline();
    expect(ctx._modal).toContain('pedirDescartarOffline(0)');
    ctx.pedirDescartarOffline(0);
    expect(ctx._confirmar[2]).toBe('descartarOfflineConfirmado');
    ctx.descartarOfflineConfirmado(0);
    expect(ctx.offlineFila()).toEqual([]);
  });
});
