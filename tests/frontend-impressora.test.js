'use strict';
/** Impressão directa (ESC/POS) em vm: codificação, configuração do dispositivo e talões automáticos. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function carregar({ guardado = {}, api = async () => [] } = {}) {
  const store = { nuk_impressora: JSON.stringify(guardado) };
  const ctx = {
    console, window: {}, Promise, Date, Uint8Array, setInterval: () => 1, clearInterval() {},
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    navigator: {}, document: { getElementById: () => null }, api, toast: (...a) => { ctx._toast = a; }, esc: v => String(v ?? ''),
    abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {},
  };
  ctx._store = store;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/impressora.js'), 'utf8') + '\nthis._lig = l => { _impLigacao = l; };', ctx);
  return ctx;
}
const bytes = u => Array.from(u);
const contem = (arr, sub) => arr.join(',').includes(sub.join(','));

describe('Codificação ESC/POS', () => {
  test('reinicia, CP860, negrito/tamanho/alinhamento, corte e gaveta', () => {
    const ctx = carregar();
    const b = bytes(ctx.impCodificar({ colunas: 32, cortar: true, gaveta: true, linhas: [{ t: 'Ação', n: true, g: true, a: 'c' }, { sep: true }] }, { acentos: 'CP860', gaveta: true }));
    expect(b.slice(0, 5)).toEqual([0x1B, 0x40, 0x1B, 0x74, 3]);
    expect(contem(b, [0x1B, 0x61, 1, 0x1B, 0x45, 1, 0x1D, 0x21, 0x11, 0x41, 0x87, 0x84, 0x6F, 0x0A])).toBe(true); // A ç ã o
    expect(contem(b, Array(32).fill(0x2D))).toBe(true);
    expect(contem(b, [0x1D, 0x56, 0x42, 0x00])).toBe(true);
    expect(contem(b, [0x1B, 0x70, 0x00, 0x19, 0xFA])).toBe(true);
  });
  test('sem acentos tira os acentos; gaveta desligada no dispositivo não abre', () => {
    const ctx = carregar();
    const b = bytes(ctx.impCodificar({ linhas: [{ t: 'Pão' }], gaveta: true }, { acentos: 'SEM', gaveta: false }));
    expect(contem(b, [0x50, 0x61, 0x6F, 0x0A])).toBe(true);
    expect(contem(b, [0x1B, 0x74])).toBe(false);
    expect(contem(b, [0x1B, 0x70])).toBe(false);
  });
});

describe('Dispositivo', () => {
  test('a configuração fica neste dispositivo', () => {
    const ctx = carregar({ guardado: { colunas: 32, cozinha: true } });
    expect(ctx.impConfig()).toMatchObject({ colunas: 32, cozinha: true, recibos: true, ligacao: 'NENHUMA' });
    ctx.impGuardar({ ...ctx.impConfig(), bar: true });
    expect(JSON.parse(ctx._store.nuk_impressora).bar).toBe(true);
  });
  test('talões automáticos: reclama no posto do dispositivo e envia cada documento', async () => {
    const enviados = [], pedidos = [];
    const ctx = carregar({ guardado: { ligacao: 'USB', cozinha: true, colunas: 42 }, api: async (m, url, corpo) => { pedidos.push([url, corpo]); return [{ linhas: [{ t: 'Mesa 1' }] }, { linhas: [{ t: 'Mesa 2' }] }]; } });
    ctx._lig({ nome: 'x', enviar: async b => enviados.push(b) });
    await ctx.impVerificarPreparacao();
    expect(pedidos).toEqual([['/impressao/preparacao/reclamar', { posto: 'COZINHA', colunas: 42 }]]);
    expect(enviados).toHaveLength(2);
  });
  test('recibo só sai se o dispositivo imprimir recibos', async () => {
    const pedidos = [];
    const ctx = carregar({ guardado: { ligacao: 'USB', recibos: false }, api: async (m, url) => { pedidos.push(url); return { linhas: [] }; } });
    ctx._lig({ nome: 'x', enviar: async () => {} });
    await ctx.imprimirRecibo(['p1']);
    expect(pedidos).toEqual([]);
    await ctx.imprimirRecibo(['p1'], { manual: true });
    expect(pedidos).toEqual(['/impressao/recibo']);
  });
});
