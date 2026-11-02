'use strict';
/**
 * Renderiza os módulos do POS com dados falsos (vm, sem navegador) para apanhar erros de execução
 * como variáveis não definidas («produtos is not defined»), que o node --check não vê.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codigo = fs.readFileSync(path.join(__dirname, '../public/js/modulos.js'), 'utf8');
const q = { id: '11111111-1111-1111-1111-111111111111', numero: '101', tipo: 'SUITE', status: 'DISPONIVEL', preco_2h: 1, preco_pernoite: 2, preco_diaria: 3, reservas_activas: null };
const prod = { id: '22222222-2222-2222-2222-222222222222', nome: "Cuca d'água", preco: 600, categoria: 'BEBIDA', disponivel: true, descricao: '' };
const dados = {
  '/configuracoes': { nome_estabelecimento: 'X', iva_padrao: 14, moeda: 'Kz', timezone: 'Africa/Luanda' },
  '/quartos': [q], '/produtos': [prod],
  '/listas': { TIPO_QUARTO: { nome: 'Tipos de quarto', opcoes: [{ id: '33333333-3333-3333-3333-333333333333', valor: 'SUITE', ativo: true }] } },
  '/listas/TIPO_QUARTO': [{ valor: 'SUITE', ativo: true }], '/listas/CATEGORIA_PRODUTO': [{ valor: 'BEBIDA', ativo: true }],
};

function carregar(utilizador) {
  const ctx = {
    NUK: { utilizador, token: 't' }, console, window: {}, document: { getElementById: () => ({ value: '' }), querySelectorAll: () => [] },
    api: async (m, url) => (url in dados ? dados[url] : []),
    formatarMoeda: v => String(v), badgeStatus: s => s, toast() {}, abrirModal() {}, fecharModal() {}, carregarModulo() {},
    esc: v => String(v ?? ''), setTimeout, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}
const render = async (ctx, fn) => { const el = { innerHTML: '' }; await ctx[fn](el); return el.innerHTML; };

describe('módulos do POS renderizam sem erro', () => {
  const admin = { nivel_acesso: 'ADMIN' };
  test.each(['modulo_configuracoes', 'modulo_quartos', 'modulo_produtos'])('%s (ADMIN)', async fn => {
    const html = await render(carregar(admin), fn);
    expect(html).not.toMatch(/erro-msg/);
    expect(html.length).toBeGreaterThan(50);
  });
  test('Configurações mostra quartos e ementa; módulos operacionais não trazem botões de configuração', async () => {
    const ctx = carregar(admin);
    const cfg = await render(ctx, 'modulo_configuracoes');
    expect(cfg).toContain("modalFormQuarto('')");
    expect(cfg).toContain('modalNovoProduto()');
    expect(cfg).toContain('modalIngredientes(');
    expect(cfg).toContain("adicionarOpcaoLista('TIPO_QUARTO')");
    const quartos = await render(ctx, 'modulo_quartos');
    expect(quartos).not.toContain('modalFormQuarto');
    const produtos = await render(ctx, 'modulo_produtos');
    expect(produtos).not.toMatch(/modalNovoProduto|modalEditarProduto|modalIngredientes/);
  });
});

describe('formulários usam as listas do estabelecimento', () => {
  test('novo quarto e novo produto mostram as opções configuradas', async () => {
    let html = '';
    const ctx = carregar({ nivel_acesso: 'ADMIN' });
    ctx.abrirModal = (t, h) => { html = h; };
    await ctx.modalFormQuarto('');
    expect(html).toContain('<option value="SUITE"');
    expect(html).not.toContain('VIP_EXECUTIVO');
    await ctx.modalNovoProduto();
    expect(html).toContain('<option value="BEBIDA"');
    expect(html).not.toContain('CHURRASCO');
  });
});
