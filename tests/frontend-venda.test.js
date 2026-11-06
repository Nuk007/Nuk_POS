'use strict';
/** Ecrãs dos fluxos de venda (Mesa | Balcão | Remota | Take Away) em vm, sem navegador. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ler = f => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
const prod = (id, nome, categoria) => ({ id, nome, preco: 600, categoria, disponivel: true });
const dados = {
  '/produtos?disponivel=true': [prod('p1', "Cuca d'água", 'BEBIDA'), prod('p2', 'Picanha', 'CHURRASCO'), prod('p3', 'Shisha', 'SHISHA'), prod('p4', 'Maço', 'CIGARROS')],
  '/mesas': [{ id: 'm1', numero: 'M01', capacidade: 4, zona: 'Salão', status: 'LIVRE', pedidos_ativos: '1' }],
  '/pedidos/por-validar': [{ id: 'r1', origem: 'REMOTA', total: 1200, nukcoin_pago: 0, mesa_numero: 'M01', cliente_nome: null, itens: [{ produto_nome: 'Cuca', quantidade: 2, preco_unitario: 600 }] }],
  '/pedidos/takeaway/elegivel?cliente_id=c1': { elegivel: true },
  '/mesas/quantidade': { quantidade: 3 }, '/quartos': [], '/produtos': [], '/dashboard/itens': { itens: [], servicos: {} },
  '/listas': {}, '/clientes?q=ana&limit=10': { data: [{ id: 'c1', nome: 'Ana', telefone: '923000000' }] },
};
const chamadas = [];
function carregar() {
  const els = {};
  const el = id => els[id] || (els[id] = { innerHTML: '', value: '', textContent: '', style: {} });
  const ctx = {
    NUK: { utilizador: { nivel_acesso: 'ADMIN' }, token: 't' }, console, window: {}, setTimeout, Promise,
    document: { getElementById: el, querySelectorAll: () => [] },
    api: async (m, url, corpo) => { chamadas.push([m, url, corpo]); return url in dados ? dados[url] : {}; },
    formatarMoeda: v => String(v), toast() {}, abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {}, carregarModulo() {}, badgeStatus: s => s,
    esc: v => String(v ?? '').replace(/'/g, '&#39;'),
  };
  ctx._els = els;
  vm.createContext(ctx);
  vm.runInContext(ler('modulos.js') + '\n' + ler('venda.js'), ctx);
  return ctx;
}

describe('Fluxos de venda', () => {
  test('Balcão: painel com um botão por produto e carrinho a somar', async () => {
    const ctx = carregar(); const el = { innerHTML: '' };
    await ctx.modulo_balcao(el);
    expect(el.innerHTML).toContain('venda-grelha');
    expect(ctx._els['venda-grelha'].innerHTML.match(/vendaAdd\(/g)).toHaveLength(4);
    ctx.vendaAdd(0); ctx.vendaAdd(0); ctx.vendaAdd(1);
    expect(ctx._els['venda-total'].textContent).toContain('1800');
    await ctx.vendaConfirmar();
    const post = chamadas.filter(c => c[0] === 'POST').pop();
    expect(post[1]).toBe('/pedidos');
    expect(post[2]).toMatchObject({ origem: 'BALCAO', mesa_id: null, itens: [{ produto_id: 'p1', quantidade: 2 }, { produto_id: 'p2', quantidade: 1 }] });
  });
  test('Mesa: clicar na mesa abre o painel e envia mesa_id', async () => {
    const ctx = carregar(); const el = { innerHTML: '' };
    await ctx.modulo_mesas(el);
    expect(el.innerHTML).toContain("abrirVendaMesa('m1')");
    ctx.document.getElementById('main-content').innerHTML = '';
    await ctx.abrirVendaMesa('m1');
    ctx.vendaAdd(0);
    await ctx.vendaConfirmar();
    expect(chamadas.filter(c => c[0] === 'POST').pop()[2]).toMatchObject({ origem: 'MESA', mesa_id: 'm1' });
  });
  test('Take Away: só comidas e bebidas nos botões e cliente na venda', async () => {
    const ctx = carregar(); const el = { innerHTML: '' };
    await ctx.modulo_takeaway(el);
    expect(el.innerHTML).toContain('takeAwayProcurar()');
    ctx.document.getElementById('ta-q').value = 'ana';
    await ctx.takeAwayProcurar();
    await ctx.takeAwayEscolher(0);
    expect(ctx._els['venda-grelha'].innerHTML.match(/vendaAdd\(/g)).toHaveLength(2); // sem shisha nem cigarros
    ctx.vendaAdd(0);
    await ctx.vendaConfirmar();
    expect(chamadas.filter(c => c[0] === 'POST').pop()[2]).toMatchObject({ origem: 'TAKEAWAY', cliente_id: 'c1' });
  });
  test('Remota: fila com Validar e Recusar; recusar passa pela confirmação', async () => {
    const ctx = carregar(); const el = { innerHTML: '' };
    await ctx.modulo_remota(el);
    expect(el.innerHTML).toContain("validarPedidoRemoto('r1')");
    expect(el.innerHTML).toContain("pedirRecusarRemoto('r1')");
    expect(el.innerHTML).not.toContain("recusarRemotoConfirmado('r1')"); // o botão nunca cancela directamente
    ctx.pedirRecusarRemoto('r1');
    expect(ctx._modal).toContain("recusarRemotoConfirmado('r1')");
  });
  test('Configurações: cartão de mesas, e reduzir pede confirmação', async () => {
    const ctx = carregar(); const el = { innerHTML: '' };
    await ctx.modulo_configuracoes(el);
    expect(el.innerHTML).toContain('guardarMesas()');
    ctx.document.getElementById('cfg-mesas').value = '1';
    ctx.guardarMesas();
    expect(ctx._modal).toContain("reduzirMesasConfirmado('1')");
    expect(chamadas.filter(c => c[0] === 'PUT')).toHaveLength(0);
  });
});
