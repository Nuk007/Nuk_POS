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
