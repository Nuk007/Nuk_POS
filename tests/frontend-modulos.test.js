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
  test('Configurações tem morada, NIF e telefone e envia-os ao guardar (contrato com a API)', async () => {
    const ctx = carregar(admin);
    const html = await render(ctx, 'modulo_configuracoes');
    ['cfg-morada', 'cfg-nif', 'cfg-telefone'].forEach(id => expect(html).toContain(`id="${id}"`));
    const valores = { 'cfg-nome': 'Bar X', 'cfg-iva': '14', 'cfg-moeda': 'Kz', 'cfg-morada': 'Rua A 1', 'cfg-nif': '5417000000', 'cfg-telefone': '+244 923 125 060' };
    ctx.document.getElementById = id => ({ value: valores[id] });
    let enviado = null;
    ctx.api = async (m, url, corpo) => { if (m === 'PUT') enviado = { url, corpo }; return {}; };
    await ctx.guardarConfiguracoes();
    expect(enviado.url).toBe('/configuracoes');
    expect(enviado.corpo).toMatchObject({ morada: 'Rua A 1', nif_empresa: '5417000000', telefone: '+244 923 125 060' });
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

describe('Quartos: venda directa pelos botões', () => {
  const agora = Date.now();
  const rooms = [
    { ...q, id: 'a1111111-1111-1111-1111-111111111111', numero: '101', estrela: null, reservas_futuras: [] },
    { ...q, id: 'b1111111-1111-1111-1111-111111111111', numero: '102', status: 'OCUPADO', livre_as: new Date(agora + 3600e3).toISOString(), estrela: 'AMARELA',
      ocupacao: { checkin: new Date(agora - 3600e3).toISOString(), checkout: new Date(agora + 1800e3).toISOString(), fracao: 'DUAS_HORAS' },
      reservas_futuras: [{ id: 'c1111111-1111-1111-1111-111111111111', checkin: new Date(agora + 7200e3).toISOString(), checkout: new Date(agora + 14400e3).toISOString(), fracao: 'DUAS_HORAS' }] },
    { ...q, id: 'd1111111-1111-1111-1111-111111111111', numero: '103', estrela: 'VERMELHA', venda_bloqueada: 'Reserva às 15:00: vendas bloqueadas', reservas_futuras: [] },
    { ...q, id: 'e1111111-1111-1111-1111-111111111111', numero: '104', status: 'LIMPEZA', livre_as: new Date(agora + 600e3).toISOString(), limpeza: { escalado: false }, estrela: null },
  ];
  const comQuartos = u => { const ctx = carregar(u); dados['/quartos'] = rooms; return ctx; };
  afterAll(() => { dados['/quartos'] = [q]; });

  test('já não há «+ Nova Reserva»; cada botão mostra número, tipo, estado e ★ reservado', async () => {
    const html = await render(comQuartos({ nivel_acesso: 'OPERADOR', pode_vender_quartos: true }), 'modulo_quartos');
    expect(html).not.toMatch(/Nova Reserva|modalNovaReserva/);
    expect(html).toContain('>101<');
    expect(html).toMatch(/Disponível/);
    expect(html).toMatch(/quarto-estado">Ocupado<\/div>\s*<div class="quarto-livre">livre às/);
    expect(html).toMatch(/quarto-estado">A arrumar<\/div>\s*<div class="quarto-livre">livre às/);
    expect(html).toMatch(/estrela amarela[^>]*>★ reservado/);
    expect(html).toMatch(/estrela vermelha[^>]*>★ reservado/);
    expect(html).toContain("modalQuarto('a1111111-1111-1111-1111-111111111111')");
  });
  const abrir = async (u, id) => {
    let html = '';
    const ctx = comQuartos(u); ctx.abrirModal = (t, h) => { html = h; };
    await render(ctx, 'modulo_quartos'); ctx.modalQuarto(id);
    return html;
  };
  test('com o perfil: serviços Hora/Noite/Diária e botões Vender / Reservar / Abrir Quarto', async () => {
    const html = await abrir({ nivel_acesso: 'OPERADOR', pode_vender_quartos: true }, rooms[0].id);
    ['Hora', 'Noite', 'Diária', 'Vender', 'Reservar', 'Abrir Quarto'].forEach(t => expect(html).toContain(t));
    expect(html).toMatch(/passoQuarto\('VENDER'\)"/);
    expect(html).not.toMatch(/passoQuarto\('VENDER'\)" disabled/);
    expect(html).toMatch(/disabled data-on-click="passoQuarto\('ABRIR'\)"/); // quarto livre: não há o que abrir
  });
  test('sem o perfil não vende: botões desactivados e explicação', async () => {
    const html = await abrir({ nivel_acesso: 'ADMIN', pode_vender_quartos: false }, rooms[0].id);
    expect(html).toMatch(/<button class="btn-primario" disabled data-on-click="passoQuarto\('VENDER'\)"/);
    expect(html).toContain('Não tem o perfil');
  });
  test('★ vermelha bloqueia a venda mas deixa reservar; quarto ocupado permite abrir', async () => {
    const u = { nivel_acesso: 'OPERADOR', pode_vender_quartos: true };
    const verm = await abrir(u, rooms[2].id);
    expect(verm).toMatch(/disabled data-on-click="passoQuarto\('VENDER'\)"/);
    expect(verm).not.toMatch(/disabled data-on-click="passoQuarto\('RESERVAR'\)"/);
    const ocup = await abrir(u, rooms[1].id);
    expect(ocup).not.toMatch(/disabled data-on-click="passoQuarto\('ABRIR'\)"/);
    expect(ocup).toContain('pedirCancelarReservaQuarto(');
  });
  test('arrumação: só arrumadores (ou a chefia depois do prazo) vêem «Dar como limpo»', async () => {
    expect(await abrir({ nivel_acesso: 'OPERADOR', arruma_quartos: true }, rooms[3].id)).toContain('pedirQuartoLimpo()');
    expect(await abrir({ nivel_acesso: 'GERENTE' }, rooms[3].id)).not.toContain('pedirQuartoLimpo()');
    rooms[3].limpeza = { escalado: true };
    expect(await abrir({ nivel_acesso: 'GERENTE' }, rooms[3].id)).toContain('pedirQuartoLimpo()');
    expect(await abrir({ nivel_acesso: 'OPERADOR', arruma_quartos: true }, rooms[3].id)).not.toContain('pedirQuartoLimpo()');
    rooms[3].limpeza = { escalado: false };
  });
});

describe('Acessos delegados nos formulários de funcionários', () => {
  const meta = (titular, limite) => ({ modulos: ['pedidos', 'financeiro', 'funcionarios'], capacidades: ['vender_quartos'], rotulos: { pedidos: 'Pedidos', financeiro: 'Financeiro', funcionarios: 'Funcionários', vender_quartos: 'Atribuir «vender quartos»' },
    padrao: { OPERADOR: ['pedidos'], GERENTE: ['pedidos', 'financeiro'], ADMIN: ['pedidos', 'financeiro', 'funcionarios', 'vender_quartos'] }, meu_limite: limite, sou_titular: titular });
  test('administrador não titular: o que está fora do limite fica desactivado e lerAcessos só devolve o que pode dar', () => {
    const ctx = carregar({ nivel_acesso: 'ADMIN', titular: false });
    ctx.window._acessosMeta = meta(false, ['pedidos', 'funcionarios']);
    const html = ctx.htmlAcessos('nf', ['pedidos'], 'OPERADOR', false);
    expect(html).toMatch(/id="nf-ac-pedidos" checked >/);
    expect(html).toMatch(/id="nf-ac-financeiro" +disabled/);
    expect(html).not.toContain('vender_quartos'); // capacidades só aparecem ao definir administradores
    expect(html).toContain('titular lhe delegou');
  });
  test('titular a definir um administrador vê também as capacidades que ele poderá atribuir', () => {
    const ctx = carregar({ nivel_acesso: 'ADMIN', titular: true });
    ctx.window._acessosMeta = meta(true, ['pedidos', 'financeiro', 'funcionarios', 'vender_quartos']);
    const html = ctx.htmlAcessos('ef', ['pedidos', 'vender_quartos'], 'ADMIN', false);
    expect(html).toContain('id="ef-ac-vender_quartos" checked');
    expect(html).toContain('limite do administrador');
    expect(html).not.toMatch(/disabled/);
  });
  test('acessos acima do limite: a caixa fica toda bloqueada', () => {
    const ctx = carregar({ nivel_acesso: 'ADMIN', titular: false });
    ctx.window._acessosMeta = meta(false, ['pedidos']);
    expect(ctx.htmlAcessos('ef', ['pedidos', 'financeiro'], 'OPERADOR', true)).toContain('só o titular os pode alterar');
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
    const directos = botoes.filter(b => /^(apagarQuarto|apagarOpcaoLista|emitirNotaCreditoConfirmada|retirarContaConfirmado|cancelarPedidoConfirmado|cancelarSolicitacaoConfirmada|desactivarFuncConfirmado|removerItemDashboard)\(/.test(b)
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

describe('Finanças — documentos fiscais', () => {
  const docs = [
    { id: 'f1', tipo_documento: 'FT', numero_fatura: 'FT 2026/000002', total: '1000.00', iva: '122.81', emitida_em: '2026-11-14T10:00:00Z', nome_cliente: 'Ana' },
    { id: 'f2', tipo_documento: 'FR', numero_fatura: 'FR 2026/000001', total: '500.00', iva: '61.40', emitida_em: '2026-11-14T10:00:00Z', anulada_por_numero: 'NC 2026/000001' },
    { id: 'f3', tipo_documento: 'NC', numero_fatura: 'NC 2026/000001', total: '500.00', iva: '61.40', emitida_em: '2026-11-14T10:00:00Z', documento_origem_numero: 'FR 2026/000001' },
  ];
  const resumo = { pedidos: { receita_total: 0, total_pedidos: 0, pedidos_fechados: 0 }, quartos: { receita_quartos: 0, total_reservas: 0 }, por_categoria: [] };
  function ctxFin(nivel) {
    const ctx = carregar({ nivel_acesso: nivel });
    ctx.formatarData = v => String(v);
    ctx.api = async (m, url, corpo) => {
      if (url.startsWith('/financeiro/resumo')) return resumo;
      if (url === '/financeiro/faturas' && m === 'GET') return docs;
      ctx.enviado = { m, url, corpo };
      return { numero_fatura: 'X 2026/000001' };
    };
    return ctx;
  }

  test('mostra tipo e situação; «Anular» só para chefia e só em FT/FR ainda válidas', async () => {
    const admin = await render(ctxFin('ADMIN'), 'modulo_financeiro');
    expect(admin).toContain('Factura-recibo');
    expect(admin).toContain('Anulada (NC 2026/000001)');
    expect(admin).toContain('Anula FR 2026/000001');
    expect(admin).toContain("pedirNotaCredito('f1')");
    expect(admin).not.toContain("pedirNotaCredito('f2')");
    expect(admin).not.toContain("pedirNotaCredito('f3')");
    const op = await render(ctxFin('OPERADOR'), 'modulo_financeiro');
    expect(op).not.toContain('pedirNotaCredito(');
  });

  test('anular pede motivo e confirmação antes de chamar a API', async () => {
    const ctx = ctxFin('ADMIN');
    await render(ctx, 'modulo_financeiro');
    let html = '';
    ctx.abrirModal = (t, h) => { html = h; };
    ctx.pedirNotaCredito('f1');
    expect(html).toContain("emitirNotaCreditoConfirmada('f1')");
    expect(html).toContain('Sim, confirmar');
    expect(html).toContain('id="nc-motivo"');
    expect(ctx.enviado).toBeUndefined();
    ctx.document.getElementById = () => ({ value: 'curto' });
    await ctx.emitirNotaCreditoConfirmada('f1');
    expect(ctx.enviado).toMatchObject({ m: 'POST', url: '/financeiro/faturas/f1/nota-credito', corpo: { motivo: 'curto' } });
  });

  test('emitir envia tipo, descrição e valor', async () => {
    const ctx = ctxFin('OPERADOR');
    const v = { 'fat-tipo': 'FR', 'fat-desc': 'Aluguer do salão', 'fat-nome': '', 'fat-nif': '', 'fat-total': '25000' };
    ctx.document.getElementById = id => ({ value: v[id] });
    await ctx.emitirFatura();
    expect(ctx.enviado).toMatchObject({ url: '/financeiro/faturas', corpo: { tipo: 'FR', descricao: 'Aluguer do salão', total_manual: 25000 } });
  });
});
