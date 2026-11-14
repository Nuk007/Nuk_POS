'use strict';
/** Ecrã de cozinha e bar em vm. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function carregar(dados) {
  const chamadas = [];
  const ctx = {
    console, window: {}, Promise, Date, NUK: { moduloActual: 'cozinha', utilizador: { nivel_acesso: 'OPERADOR' } },
    setInterval: () => 1, clearInterval() {}, document: { getElementById: () => ({ value: 'BAR' }) },
    api: async (m, url, corpo) => { chamadas.push([m, url, corpo]); const k = Object.keys(dados).find(x => url.startsWith(x)); return k ? dados[k] : {}; },
    toast() {}, esc: v => String(v ?? ''), abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {},
  };
  ctx._chamadas = chamadas;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/cozinha.js'), 'utf8'), ctx);
  return ctx;
}
const pedido = { id: 'p1', origem: 'MESA', mesa: 'M01', minutos: 27, itens: [{ id: 'i1', produto: 'Picanha', quantidade: 2, status: 'AGUARDANDO', observacoes: 'bem passada' }], estado: 'AGUARDANDO' };

describe('Cozinha e bar (frontend)', () => {
  test('cartão com mesa, tempo, observações e botões de avançar; posto muda', async () => {
    const ctx = carregar({ '/cozinha?posto=COZINHA': [pedido], '/cozinha?posto=BAR': [] });
    const el = { innerHTML: '' };
    await ctx.modulo_cozinha(el);
    ['Mesa M01', '27 min', 'bem passada', "avancarItemKds('p1','i1')", "avancarPedidoKds('p1')", 'Começar'].forEach(t => expect(el.innerHTML).toContain(t));
    await ctx.avancarPedidoKds('p1');
    expect(ctx._chamadas).toContainEqual(['POST', '/cozinha/pedidos/p1/avancar', { posto: 'COZINHA' }]);
    ctx.mudarPostoKds('BAR');
    await new Promise(r => setTimeout(r, 0));
    expect(ctx._chamadas.some(c => c[1] === '/cozinha?posto=BAR')).toBe(true);
  });
  test('configurar postos envia o mapa por categoria', async () => {
    const ctx = carregar({ '/cozinha/postos': { postos: { BEBIDA: 'BAR' } }, '/listas/CATEGORIA_PRODUTO': [{ valor: 'BEBIDA', ativo: true }, { valor: 'PRATO', ativo: true }] });
    await ctx.modalPostosPreparacao();
    expect(ctx._modal).toContain('posto-1');
    await ctx.guardarPostosPreparacao();
    expect(ctx._chamadas).toContainEqual(['PUT', '/cozinha/postos', { postos: { BEBIDA: 'BAR', PRATO: 'BAR' } }]);
  });
});
