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
  '/dashboard': { resumo_hoje: { receita_hoje: 0, fechados: 0 }, mesas: [], quartos: [], alertas_stock: 0, pedidos_abertos: [], top_produtos: [] },
  '/dashboard/comparativo': { dias: { hoje: '2026-11-02', ontem: '2026-11-01', homologo: '2026-10-26' }, facturacao: { valor: { hoje: 100, ontem: 200, homologo: 50 } }, itens: [
    { id: 'i1', nome: 'Shishas', fonte: 'PRODUTO', unidade: 'un', quantidade: { hoje: 2, ontem: 5, homologo: 4 }, valor: { hoje: 1, ontem: 2, homologo: 3 } },
    { id: 'i2', nome: 'Piscina', fonte: 'CONTADOR', unidade: 'registos', quantidade: { hoje: 3, ontem: 0, homologo: 1 }, valor: null, agora: 2 },
    { id: 'i3', nome: 'Reclamações', fonte: 'PENDENCIA', unidade: 'registos', quantidade: { hoje: 1, ontem: 1, homologo: 0 }, valor: null, em_aberto: 1, tratadas: { hoje: 0, ontem: 1, homologo: 0 } } ] },
  '/dashboard/itens': { itens: [{ id: 'i1', nome: 'Shishas', fonte: 'PRODUTO', ref: '22222222-2222-2222-2222-222222222222', ativo: true }], servicos: { QUARTOS: 'Quartos' } },
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
  test.each(['modulo_configuracoes', 'modulo_quartos', 'modulo_produtos', 'modulo_dashboard'])('%s (ADMIN)', async fn => {
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

describe('acções destrutivas pedem confirmação', () => {
  test('nenhum botão apaga/cancela/desactiva directamente: passa por pedirXxx → modalConfirmar', () => {
    const botoes = [...codigo.matchAll(/data-on-click="([^"]*)"/g)].map(m => m[1]);
    const directos = botoes.filter(b => /^(apagarQuarto|apagarOpcaoLista|cancelarPedidoConfirmado|cancelarSolicitacaoConfirmada|desactivarFuncConfirmado|removerItemDashboard)\(/.test(b)
      || /mudarStatusPedido\([^)]*CANCELADO/.test(b) || /actualizarSolicitacao\([^)]*CANCELADA/.test(b));
    // só o botão «Sim, confirmar» do modalConfirmar (construído com ${funcao}) pode chamá-las
    expect(directos).toEqual([]);
  });
  test('modalConfirmar mostra o texto e o botão de confirmação com a função pedida', () => {
    let html = '';
    const ctx = carregar({ nivel_acesso: 'ADMIN' });
    ctx.abrirModal = (t, h) => { html = h; };
    ctx.pedirApagarQuarto('abc');
    expect(html).toContain('apagarQuarto(\'abc\')');
    expect(html).toContain('Sim, confirmar');
    expect(html).toContain('fecharModal()');
  });
});
