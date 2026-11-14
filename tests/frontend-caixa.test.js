'use strict';
/** Ecrãs da Caixa do dia em vm, sem navegador. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ler = f => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
function carregar(dados) {
  const chamadas = [], els = {};
  const el = id => els[id] || (els[id] = { innerHTML: '', value: '', textContent: '', style: {} });
  const ctx = {
    console, window: {}, setTimeout, Promise, Intl, Date,
    document: { getElementById: el, querySelectorAll: () => [] },
    api: async (m, url, corpo) => { chamadas.push([m, url, corpo]); return url in dados ? dados[url] : {}; },
    formatarMoeda: v => `${v} Kz`, toast: (...a) => { ctx._toast = a; }, abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {},
    carregarModulo: m => { ctx._modulo = m; }, esc: v => String(v ?? '').replace(/'/g, '&#39;'),
    NUKCOIN_VALORES: [5000, 10000],
  };
  ctx._chamadas = chamadas; ctx._els = els;
  vm.createContext(ctx);
  vm.runInContext(ler('caixa.js'), ctx);
  return ctx;
}
const sessao = { id: 's1', aberta_em: '2026-11-06T08:00:00Z' };
const resumo = { fundo_inicial: 1000, dinheiro_recebido: 500, dinheiro_esperado: 1500, por_metodo: { CASH: 500, TPA: 300 } };

describe('Caixa do dia (frontend)', () => {
  test('caixa fechado: oferece abrir com fundo e não faz nada sem confirmação', async () => {
    const ctx = carregar({ '/caixa': { aberta: false }, '/caixa/sessoes': [] });
    const el = { innerHTML: '' };
    await ctx.modulo_caixa(el);
    expect(el.innerHTML).toContain('abrirCaixa()');
    ctx._els['cx-fundo'] = { value: '2000' };
    await ctx.abrirCaixa();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/abrir', { fundo_inicial: 2000 }]);
  });

  test('caixa aberto: mostra esperado, movimentos e fecho exige confirmação com contagem', async () => {
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [{ tipo: 'RECEBIMENTO', metodo: 'CASH', valor: 500, criado_em: '2026-11-06T09:00:00Z', mesa_numero: 'M01' }] } });
    const el = { innerHTML: '' };
    await ctx.modulo_caixa(el);
    expect(el.innerHTML).toContain('1500 Kz');
    expect(el.innerHTML).toContain('Mesa M01');
    expect(el.innerHTML).toContain('modalFecharCaixa()');
    ctx.modalFecharCaixa();
    expect(ctx._modal).toContain('fecharCaixa()');
    ctx._els['cx-contado'] = { value: '' }; ctx._els['cx-obs'] = { value: '' };
    await ctx.fecharCaixa();
    expect(ctx._chamadas.some(c => c[1] === '/caixa/fechar')).toBe(false); // sem contagem não fecha
    ctx._els['cx-contado'].value = '1500';
    await ctx.fecharCaixa();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/fechar', { contado: 1500, observacoes: '' }]);
  });

  test('Nuk-Coin e cartões: com caixa fechado mostram o aviso em vez do formulário', async () => {
    for (const m of ['modulo_nukcoin', 'modulo_cartoes', 'modulo_recebimentos']) {
      const ctx = carregar({ '/caixa': { aberta: false } });
      const el = { innerHTML: '' };
      await ctx[m](el);
      expect(el.innerHTML).toContain('fechado');
      expect(el.innerHTML).toContain("carregarModulo('caixa')");
    }
  });

  test('Nuk-Coin: procura cliente e carrega com a forma de pagamento escolhida', async () => {
    const ctx = carregar({ '/caixa': { aberta: true }, '/clientes?q=ana&limit=10': { data: [{ id: 'c1', nome: 'Ana', nukcoin_saldo: 100 }] }, '/caixa/nukcoin': { saldo_atual: 5100 } });
    await ctx.modulo_nukcoin({ innerHTML: '' });
    ctx._els['nc-q'] = { value: 'ana' }; ctx._els['nc-res'] = { innerHTML: '' };
    await ctx.nukcoinProcurar();
    expect(ctx._els['nc-res'].innerHTML).toContain('nukcoinEscolher(0)');
    ctx.nukcoinEscolher(0);
    ctx._els['nc-metodo'] = { value: 'TPA' };
    await ctx.nukcoinCarregar(5000);
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/nukcoin', { cliente_id: 'c1', valor: 5000, metodo: 'TPA' }]);
  });

  test('Cartões: venda mostra o código para entregar ao cliente', async () => {
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/cartoes': [], });
    await ctx.modulo_cartoes({ innerHTML: '' });
    ctx._els['cc-metodo'] = { value: 'CASH' };
    ctx.api = async (m, u, b) => { ctx._chamadas.push([m, u, b]); return { codigo: 'CCABCDEFGH', saldo: 10000 }; };
    await ctx.venderCartao(10000);
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/cartoes', { valor: 10000, metodo: 'CASH' }]);
    expect(ctx._modal).toContain('CCABCDEFGH');
  });

  test('Receber: agrupa por mesa, calcula troco e envia o corpo esperado (PIN e cartão)', async () => {
    const pedidos = [
      { id: 'a', origem: 'MESA', total: 1000, mesa_numero: 'M01', cliente_id: 'c1', itens: [{ produto_nome: 'Cuca', quantidade: 2 }] },
      { id: 'b', origem: 'MESA', total: 500, mesa_numero: 'M01', itens: [] },
      { id: 'c', origem: 'BALCAO', total: 300, itens: [] },
    ];
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/por-receber': pedidos, '/caixa/receber': { total: 1500, troco: 500 } });
    const el = { innerHTML: '' };
    await ctx.modulo_recebimentos(el);
    expect(el.innerHTML).toContain('Mesa M01');
    expect(el.innerHTML).toContain('Balcão');
    expect(el.innerHTML.match(/modalReceber\(/g)).toHaveLength(2);
    ctx.modalReceber(0);
    const totalMesa = 1500;
    ctx._els['rc-entregue'] = { value: '2000' }; ctx._els['rc-troco'] = { textContent: '' };
    ctx.receberTroco();
    expect(ctx._els['rc-troco'].textContent).toContain('500 Kz');
    ctx._els['rc-metodo'] = { value: 'CASH' };
    await ctx.confirmarReceber();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/receber', { pedido_ids: ['a', 'b'], metodo: 'CASH', valor_entregue: 2000 }]);
    ctx._els['rc-metodo'].value = 'NUKCOIN'; ctx._els['rc-pin-v'] = { value: '1234' };
    await ctx.confirmarReceber();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/receber', { pedido_ids: ['a', 'b'], metodo: 'NUKCOIN', pin: '1234', cliente_id: 'c1' }]);
    ctx._els['rc-metodo'].value = 'CARTAO'; ctx._els['rc-codigo'] = { value: 'CCABCDEFGH' };
    await ctx.confirmarReceber();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/receber', { pedido_ids: ['a', 'b'], metodo: 'CARTAO', codigo_cartao: 'CCABCDEFGH' }]);
    expect(totalMesa).toBe(1500);
  });
});

describe('Compras pontuais (frontend)', () => {
  function carregarCompras(dados) {
    const ctx = carregar(dados);
    ctx.modalConfirmar = (t, x, f, ...a) => { ctx._confirmar = [f, ...a]; };
    vm.runInContext(ler('compras.js'), ctx);
    return ctx;
  }
  test('caixa fechado: pede para abrir o caixa', async () => {
    const ctx = carregarCompras({ '/caixa': { aberta: false } });
    const el = { innerHTML: '' };
    await ctx.modulo_compras(el);
    expect(el.innerHTML).toContain("carregarModulo('caixa')");
  });
  test('regista a compra com o corpo esperado e anular pede confirmação', async () => {
    const ctx = carregarCompras({
      '/caixa': { aberta: true, resumo }, '/stock?limit=500': { data: [{ id: 'i1', nome: 'Farinha', unidade: 'kg' }] },
      '/compras': [{ id: 'c1', item_nome: 'Farinha', unidade: 'kg', quantidade: '5', valor_total: '2000', criado_em: '2026-11-06T10:00:00Z', sessao_aberta: true }],
      '/compras/c1/anular': { anulada: true },
    });
    ctx.api = (m, u, b) => { ctx._chamadas.push([m, u, b]); return Promise.resolve(ctx._dados[u] || {}); };
    ctx._dados = { '/caixa': { aberta: true, resumo }, '/stock?limit=500': { data: [{ id: 'i1', nome: 'Farinha', unidade: 'kg' }] }, '/compras': [{ id: 'c1', item_nome: 'Farinha', unidade: 'kg', quantidade: '5', valor_total: '2000', criado_em: '2026-11-06T10:00:00Z', sessao_aberta: true }], '/compras/c1/anular': {} };
    const el = { innerHTML: '' };
    await ctx.modulo_compras(el);
    expect(el.innerHTML).toContain('registarCompra()');
    expect(el.innerHTML).toContain("pedirAnularCompra('c1')");
    for (const [k, v] of Object.entries({ 'cp-item': 'i1', 'cp-qtd': '5', 'cp-valor': '2000', 'cp-forn': ' Mercado ', 'cp-obs': '' })) ctx._els[k] = { value: v };
    ctx.api = async (m, u, b) => { ctx._chamadas.push([m, u, b]); return { item: 'Farinha', dinheiro_na_gaveta: 3000 }; };
    await ctx.registarCompra();
    expect(ctx._chamadas).toContainEqual(['POST', '/compras', { stock_item_id: 'i1', quantidade: 5, valor_total: 2000, fornecedor: 'Mercado', observacoes: undefined }]);
    ctx.pedirAnularCompra('c1');
    expect(ctx._confirmar).toEqual(['anularCompra', 'c1']);
    expect(ctx._chamadas.some(c => c[1].endsWith('/anular'))).toBe(false); // só anula depois de confirmar
    await ctx.anularCompra('c1');
    expect(ctx._chamadas).toContainEqual(['POST', '/compras/c1/anular', undefined]);
  });
});

describe('Pagamento misto no Receber mesas', () => {
  async function abrirConta() {
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [] }, '/caixa/por-receber': [{ id: 'p1', total: '10000', mesa_numero: 'M01', itens: [] }], '/caixa/receber': { total: 10000, pagamentos: [{ metodo: 'CASH', valor: 4000 }, { metodo: 'TPA', valor: 6000 }] } });
    await ctx.modulo_recebimentos({ innerHTML: '' });
    ctx.modalReceber(0);
    return ctx;
  }

  test('dividir mostra duas formas, «Resto» completa o total e envia pagamentos', async () => {
    const ctx = await abrirConta();
    expect(ctx._modal).toContain('receberMisto()');
    ctx.receberMisto();
    const html = ctx._els['rc-misto'].innerHTML;
    expect(html).toContain('parcelaValor(0,this.value)');
    expect(html).toContain('parcelaResto(1)');
    ctx.parcelaValor(0, '4000');
    expect(ctx._els['rc-falta'].innerHTML).toContain('6000');
    ctx.parcelaResto(1);
    expect(ctx._els['rc-falta'].innerHTML).toContain('Soma certa');
    ctx._els['rc-entregue'].value = '5000';
    ctx.receberTroco();
    expect(ctx._els['rc-troco'].textContent).toContain('1000');
    await ctx.confirmarReceber();
    const env = ctx._chamadas.find(c => c[1] === '/caixa/receber');
    expect(env[2]).toEqual({ pedido_ids: ['p1'], pagamentos: [{ metodo: 'CASH', valor: 4000, valor_entregue: 5000 }, { metodo: 'TPA', valor: 6000 }] });
  });

  test('não envia com a soma errada', async () => {
    const ctx = await abrirConta();
    ctx.receberMisto();
    ctx.parcelaValor(0, '3000');
    ctx.parcelaValor(1, '3000');
    await ctx.confirmarReceber();
    expect(ctx._chamadas.find(c => c[1] === '/caixa/receber')).toBeUndefined();
    expect(ctx._toast[1]).toBe('erro');
  });
});

describe('Contas correntes (frontend)', () => {
  const lista = [{ id: 'c1', nome: 'Empresa Lda', telefone: '+244', conta_corrente_ativa: true, limite_credito: 20000, saldo: 12000, disponivel: 8000 },
    { id: 'c2', nome: 'Antiga', conta_corrente_ativa: false, limite_credito: 0, saldo: 0, disponivel: 0 }];
  test('lista dívidas; «Receber pagamento» só com dívida; pagamento envia valor e forma', async () => {
    const ctx = carregar({ '/caixa/conta-corrente': lista, '/caixa/conta-corrente/c1/pagamentos': { pago: 5000, saldo: 7000 } });
    const el = { innerHTML: '' };
    await ctx.modulo_contas(el);
    expect(el.innerHTML).toContain("modalPagarConta('c1')");
    expect(el.innerHTML).not.toContain("modalPagarConta('c2')");
    expect(el.innerHTML).toContain('Conta retirada');
    ctx.modalPagarConta('c1');
    ctx._els['ccp-valor'] = { value: '5000' }; ctx._els['ccp-metodo'] = { value: 'TPA' }; ctx._els['ccp-obs'] = { value: '' };
    await ctx.confirmarPagarConta('c1');
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/conta-corrente/c1/pagamentos', { valor: 5000, metodo: 'TPA', observacoes: '' }]);
  });
  test('Receber com «Conta corrente» envia o cliente escolhido', async () => {
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [] }, '/caixa/conta-corrente': lista, '/caixa/por-receber': [{ id: 'p1', total: '5000', cliente_id: 'c1', itens: [] }], '/caixa/receber': { total: 5000 } });
    await ctx.modulo_recebimentos({ innerHTML: '' });
    ctx.modalReceber(0);
    expect(ctx._modal).toContain('Conta corrente (crédito)');
    await ctx.mostrarConta(true);
    expect(ctx._els['rc-conta-cli'].innerHTML).toContain('value="c1" selected');
    expect(ctx._els['rc-conta-cli'].innerHTML).not.toContain('c2');
    ctx._els['rc-metodo'] = { value: 'CONTA' }; ctx._els['rc-conta-cli'].value = 'c1';
    await ctx.confirmarReceber();
    expect(ctx._chamadas.find(c => c[1] === '/caixa/receber')[2]).toEqual({ pedido_ids: ['p1'], metodo: 'CONTA', cliente_id: 'c1' });
  });
});
