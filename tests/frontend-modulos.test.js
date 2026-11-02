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
    const quartos = await render(ctx, 'modulo_quartos');
    expect(quartos).not.toContain('modalFormQuarto');
    const produtos = await render(ctx, 'modulo_produtos');
    expect(produtos).not.toMatch(/modalNovoProduto|modalEditarProduto|modalIngredientes/);
  });
});
