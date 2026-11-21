'use strict';
/** Venda ao peso (balança), leitor de códigos de barras e etiquetas — em vm, sem navegador (21/11/2026). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ler = f => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
const dados = {
  '/produtos?disponivel=true': [
    { id: 'p1', nome: 'Cuca', preco: 600, categoria: 'BEBIDA', disponivel: true, codigo_barras: '5601234567892' },
    { id: 'p2', nome: 'Picanha (kg)', preco: 12000, categoria: 'BEBIDA', disponivel: true, vendido_ao_peso: true, codigo_barras: 'PIC-1' },
  ],
  '/pedidos/fluxos/categorias': { BALCAO: { categorias: ['BEBIDA'] } },
  '/produtos/codigo/CHURR-9': { id: 'p9', nome: 'Churrasco misto' },
};
function carregar() {
  const els = {}; const chamadas = [];
  const el = id => els[id] || (els[id] = { innerHTML: '', value: '', textContent: '', style: {}, focus() {} });
  const ctx = {
    NUK: { utilizador: { nivel_acesso: 'ADMIN' }, token: 't' }, console, window: {}, setTimeout, Promise, localStorage: { getItem: () => null, setItem() {} },
    navigator: {}, TextEncoder, TextDecoder,
    document: { getElementById: el, querySelectorAll: () => [] },
    api: async (m, url, corpo) => { chamadas.push([m, url, corpo]); if (url in dados) return dados[url]; const e = new Error('Nenhum produto com o código'); throw e; },
    fmtQtd: q => (Number.isInteger(Number(q)) ? `${Number(q)}×` : `${q} kg`), formatarMoeda: v => String(v),
    toast: (...a) => { ctx._toast = a; }, abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {}, carregarModulo() {}, badgeStatus: s => s,
    descarregarPdf: (c, n) => { ctx._pdf = [c, n]; }, esc: v => String(v ?? ''),
  };
  ctx._els = els; ctx._chamadas = chamadas;
  vm.createContext(ctx);
  vm.runInContext(require('./frontend-ficheiros').lerModulos() + '\n' + ler('venda.js') + '\n' + ler('balanca.js') + '\n' + ler('codigos.js'), ctx);
  return ctx;
}

describe('Leitura da balança (texto que as balanças mandam)', () => {
  const ctx = carregar();
  test.each([
    ['ST,GS,+  0.355kg\r\n', 0.355],
    ['US,GS,+  0.310kg\r\nST,GS,+  0.355kg\r\n', 0.355],
    ['ST,GS,+  0.355kg\r\nUS,GS,+  0.400kg\r\n', 0.355],  // a última está instável: fica a estável anterior
    ['   355 g\r\n', 0.355],
    ['W 1,250\r\n', 1.25],
    ['\x02  1234\x03', 1.234],                          // sem unidade, inteiro grande = gramas
    ['0.000kg\r\n', null],
    ['?????\r\n', null],
    ['', null],
  ])('%j → %p', (texto, kg) => { expect(ctx.balInterpretar(texto)).toBe(kg); });
});

describe('Painel de venda: produto ao peso', () => {
  test('tocar no produto ao peso pede o peso; a linha mostra kg e o total arredonda ao cêntimo', async () => {
    const ctx = carregar(); const el = { innerHTML: '' };
    await ctx.modulo_balcao(el);
    expect(ctx._els['venda-grelha'].innerHTML).toContain('/kg ⚖️');
    ctx.vendaAdd(1);
    expect(ctx._modal).toContain('Peso (kg)');
    expect(ctx._modal).not.toContain('Ler da balança'); // sem Web Serial neste «navegador»
    ctx._els['peso-kg'].value = '0.3555'; // arredonda ao grama
    ctx.pesoConfirmar();
    const v = ctx.window._venda;
    expect(v.carrinho[0]).toMatchObject({ produto_id: 'p2', quantidade: 0.356, ao_peso: true });
    expect(ctx._els['venda-itens'].innerHTML).toContain('0.356 kg');
    expect(ctx._els['venda-total'].textContent).toBe('Total: 4272');
    ctx._els['peso-kg'].value = '0'; ctx.vendaRepesar(0); ctx.pesoConfirmar();
    expect(ctx._toast[0]).toMatch(/Indique o peso/);
    ctx._els['peso-kg'].value = '1.5'; ctx.pesoConfirmar();
    expect(v.carrinho).toHaveLength(1); expect(v.carrinho[0].quantidade).toBe(1.5);
    await ctx.vendaConfirmar();
    const env = ctx._chamadas.find(c => c[0] === 'POST' && c[1] === '/pedidos');
    expect(env[2].itens).toEqual([{ produto_id: 'p2', quantidade: 1.5 }]);
  });
});

describe('Leitor de códigos de barras no painel', () => {
  test('código de um produto do painel adiciona-o; de outro fluxo explica; desconhecido avisa', async () => {
    const ctx = carregar(); const el = { innerHTML: '' };
    await ctx.modulo_balcao(el);
    expect(el.innerHTML).toContain('data-on-change="vendaCodigo(this.value)"');
    await ctx.vendaCodigo(' 5601234567892 ');
    expect(ctx.window._venda.carrinho[0]).toMatchObject({ produto_id: 'p1', quantidade: 1 });
    await ctx.vendaCodigo('PIC-1');
    expect(ctx._modal).toContain('Peso (kg)'); // ao peso: pede o peso
    await ctx.vendaCodigo('CHURR-9');
    expect(ctx._toast[0]).toBe('Churrasco misto não se vende em Balcão');
    await ctx.vendaCodigo('NADA');
    expect(ctx._toast[0]).toMatch(/Nenhum produto/);
  });
});

describe('Etiquetas', () => {
  test('descarrega a folha só dos produtos escolhidos, com as cópias (1 a 100)', () => {
    const ctx = carregar();
    ctx.window._produtosCfg = [{ id: 'a1', nome: 'Cuca', preco: 600 }, { id: 'a2', nome: 'Picanha', preco: 12000, vendido_ao_peso: true }];
    ctx.modalEtiquetas();
    expect(ctx._modal).toContain('sem código'); expect(ctx._modal).toContain('/ kg');
    ctx.document.querySelectorAll = sel => (sel === '.etq-sel'
      ? [{ checked: true, value: 'a1' }, { checked: false, value: 'a2' }]
      : [{ getAttribute: () => 'a1', value: '500' }, { getAttribute: () => 'a2', value: '3' }]);
    ctx.imprimirEtiquetas();
    expect(ctx._pdf).toEqual([`/produtos/etiquetas.pdf?itens=${encodeURIComponent('a1:100')}`, 'etiquetas.pdf']);
  });
});
