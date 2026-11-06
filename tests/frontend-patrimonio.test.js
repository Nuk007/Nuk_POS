'use strict';
/** Património, Lazer e Loja (frontend) em vm, sem navegador. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ler = f => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
function carregar(dados, ficheiros) {
  const chamadas = [], els = {};
  const el = id => els[id] || (els[id] = { innerHTML: '', value: '', textContent: '', style: {} });
  const ctx = {
    NUK: { utilizador: { nivel_acesso: 'ADMIN' } }, console, window: {}, setTimeout, Promise, Date, Intl,
    document: { getElementById: el, querySelectorAll: () => [] },
    api: async (m, url, corpo) => { chamadas.push([m, url, corpo]); return url in dados ? dados[url] : {}; },
    formatarMoeda: v => `${v} Kz`, toast: (...a) => { ctx._toast = a; }, abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {},
    carregarModulo: m => { ctx._modulo = m; }, esc: v => String(v ?? '').replace(/</g, '&lt;'), badgeStatus: s => s,
    modalConfirmar: (t, x, f, ...a) => { ctx._confirmar = [f, ...a]; },
  };
  ctx._chamadas = chamadas; ctx._els = els;
  vm.createContext(ctx);
  vm.runInContext(ficheiros.map(ler).join('\n'), ctx);
  return ctx;
}
const bem = { id: 'b1', codigo: 'PAT-0001', nome: 'Gerador', categoria: 'EQUIPAMENTO', data_aquisicao: '2021-03-01', valor_aquisicao: 1000, valor_actual: 400, vida_util_anos: 10, estado: 'BOM' };
const dadosPat = { '/patrimonio?estado=ACTIVOS': [bem], '/patrimonio/resumo': { bens: 1, valor_aquisicao: 1000, valor_actual: 400, em_mau_estado: 0 }, '/listas': { CATEGORIA_PATRIMONIO: { opcoes: [{ valor: 'EQUIPAMENTO', ativo: true }] } } };

describe('Património (frontend)', () => {
  test('lista bens com valor actual e pesquisa filtra', async () => {
    const ctx = carregar(dadosPat, ['patrimonio.js']);
    const el = { innerHTML: '' };
    await ctx.modulo_patrimonio(el);
    expect(el.innerHTML).toContain('PAT-0001'); expect(el.innerHTML).toContain('400 Kz'); expect(el.innerHTML).toContain('01/03/2021');
    expect(ctx.patLinhas(ctx.window._patBens, 'xyz')).toContain('Nenhum bem');
  });
  test('novo bem valida campos e envia o corpo esperado', async () => {
    const ctx = carregar(dadosPat, ['patrimonio.js']);
    await ctx.modulo_patrimonio({ innerHTML: '' });
    ctx.modalBem(-1);
    for (const [k, v] of Object.entries({ 'pt-nome': 'Mesa', 'pt-cat': 'EQUIPAMENTO', 'pt-loc': '', 'pt-data': '', 'pt-vida': '5', 'pt-valor': '1000', 'pt-estado': 'BOM', 'pt-obs': '' })) ctx._els[k] = { value: v };
    await ctx.guardarBem();
    expect(ctx._chamadas.some(c => c[0] === 'POST')).toBe(false);
    ctx._els['pt-data'].value = '2024-01-01';
    await ctx.guardarBem();
    expect(ctx._chamadas).toContainEqual(['POST', '/patrimonio', { nome: 'Mesa', categoria: 'EQUIPAMENTO', localizacao: '', data_aquisicao: '2024-01-01', vida_util_anos: 5, valor_aquisicao: 1000, estado: 'BOM', observacoes: '' }]);
  });
  test('abater passa por confirmação e exige motivo', async () => {
    const ctx = carregar(dadosPat, ['patrimonio.js']);
    await ctx.modulo_patrimonio({ innerHTML: '' });
    ctx.pedirAbaterBem(0);
    expect(ctx._confirmar).toEqual(['modalAbaterBem', 0]);
    expect(ctx._chamadas.some(c => c[0] === 'POST')).toBe(false);
    ctx.modalAbaterBem(0); ctx._els['pt-motivo'] = { value: ' ' };
    await ctx.abaterBem();
    expect(ctx._chamadas.some(c => c[0] === 'POST')).toBe(false);
    ctx._els['pt-motivo'].value = 'Avariado';
    await ctx.abaterBem();
    expect(ctx._chamadas).toContainEqual(['POST', '/patrimonio/b1/abater', { motivo: 'Avariado' }]);
  });
});

describe('Lazer e Loja (frontend)', () => {
  const prod = (id, nome, categoria) => ({ id, nome, preco: 100, categoria, disponivel: true });
  const dados = { '/produtos?disponivel=true': [prod('p1', 'Cuca', 'BEBIDA'), prod('p2', 'Bilhar', 'LAZER'), prod('p3', 'Camisa', 'LOJA'), prod('p4', 'Maço', 'CIGARROS')], '/pedidos': { id: 'x' } };
  test('Lazer mostra só produtos de lazer e envia origem LAZER', async () => {
    const ctx = carregar(dados, ['modulos.js', 'venda.js']);
    const el = { innerHTML: '' };
    await ctx.modulo_lazer(el);
    expect(el.innerHTML).toContain('Lazer'); expect(el.innerHTML).toContain('Registar venda');
    expect(ctx.window._venda.produtos.map(p => p.nome)).toEqual(['Bilhar']);
    ctx.vendaAdd(0);
    ctx._els['venda-obs'] = { value: '' };
    await ctx.vendaConfirmar();
    expect(ctx._chamadas).toContainEqual(['POST', '/pedidos', { origem: 'LAZER', mesa_id: null, cliente_id: null, itens: [{ produto_id: 'p2', quantidade: 1 }], observacoes: null }]);
    expect(ctx.window._venda.carrinho).toHaveLength(0); // pronto para a venda seguinte
  });
  test('Loja mostra loja e cigarros', async () => {
    const ctx = carregar(dados, ['modulos.js', 'venda.js']);
    await ctx.modulo_loja({ innerHTML: '' });
    expect(ctx.window._venda.produtos.map(p => p.nome)).toEqual(['Camisa', 'Maço']);
  });
});
