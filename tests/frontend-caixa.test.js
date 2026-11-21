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
    fmtQtd: q => (Number.isInteger(Number(q)) ? `${Number(q)}×` : `${q} kg`), formatarMoeda: v => `${v} Kz`, toast: (...a) => { ctx._toast = a; }, abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {},
    carregarModulo: m => { ctx._modulo = m; }, esc: v => String(v ?? '').replace(/'/g, '&#39;'),
    NUKCOIN_VALORES: [5000, 10000],
  };
  ctx._chamadas = chamadas; ctx._els = els;
  vm.createContext(ctx);
  vm.runInContext(require('./frontend-ficheiros').lerGrupo('caixa'), ctx);
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

  test('fecho com contas por pagar: mostra a lista e leva a Receber mesas, sem formulário de fecho', async () => {
    const pendencias = { n: 2, total: 4200, contas: [
      { id: 'p1', origem: 'MESA', status: 'FECHADO', total: 1200, mesa_numero: 'M04' },
      { id: 'p2', origem: 'REMOTA', status: 'ABERTO', total: 3000, por_validar: true }] };
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [], pendencias } });
    await ctx.modulo_caixa({ innerHTML: '' });
    ctx.modalFecharCaixa();
    expect(ctx._modal).toContain('existem 2 contas');
    expect(ctx._modal).toContain('Mesa M04');
    expect(ctx._modal).toContain('remoto por validar');
    expect(ctx._modal).toContain("carregarModulo('recebimentos')");
    expect(ctx._modal).not.toContain('fecharCaixa()');
  });

  test('contagem que não bate certo: pede justificação e só envia com ela', async () => {
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [], pendencias: { n: 0, total: 0, contas: [] } } });
    await ctx.modulo_caixa({ innerHTML: '' });
    ctx.modalFecharCaixa();
    expect(ctx._modal).toContain('cx-just');
    Object.assign(ctx._els, { 'cx-contado': { value: '1200' }, 'cx-obs': { value: '' }, 'cx-just': { value: 'curta' }, 'cx-dif': { style: {} }, 'cx-just-campo': { style: {} } });
    ctx.actualizarDiferencaCaixa();
    expect(ctx._els['cx-just-campo'].hidden).toBe(false);
    expect(ctx._els['cx-dif'].textContent).toContain('Faltam 300 Kz');
    await ctx.fecharCaixa();
    expect(ctx._chamadas.some(c => c[1] === '/caixa/fechar')).toBe(false);
    expect(ctx._toast[0]).toMatch(/justificação/);
    ctx._els['cx-just'].value = 'Troco dado a mais à mesa 4';
    await ctx.fecharCaixa();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/fechar', { contado: 1200, observacoes: '', justificacao: 'Troco dado a mais à mesa 4' }]);
  });

  test('servidor recusa por conta nova entretanto: mostra a lista em vez do erro solto', async () => {
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [], pendencias: { n: 0, total: 0, contas: [] } } });
    await ctx.modulo_caixa({ innerHTML: '' });
    ctx.api = async () => { throw Object.assign(new Error('x'), { codigo: 'CONTAS_POR_PAGAR', dados: { pendencias: { n: 1, total: 600, contas: [{ id: 'p', status: 'FECHADO', total: 600, quarto_numero: '7' }] } } }); };
    vm.runInContext('void 0', ctx);
    Object.assign(ctx._els, { 'cx-contado': { value: '1500' }, 'cx-obs': { value: '' }, 'cx-just': { value: '' } });
    await ctx.fecharCaixa();
    expect(ctx._modal).toContain('Quarto 7');
    expect(ctx._modal).toContain('existe 1 conta');
  });

  test('cliente saiu sem pagar: só a chefia vê o botão; exige motivo e envia as contas da mesa', async () => {
    const lista = [{ id: 'p1', mesa_numero: 'M04', total: 1200, itens: [] }, { id: 'p2', mesa_numero: 'M04', total: 600, itens: [] }];
    let ctx = carregar({ '/caixa': { aberta: true }, '/caixa/por-receber': lista });
    let el = { innerHTML: '' };
    await ctx.modulo_recebimentos(el);
    expect(el.innerHTML).not.toContain('pedirPerdaConta');
    ctx = carregar({ '/caixa': { aberta: true }, '/caixa/por-receber': lista, '/caixa/perdas': { contas: 2, total: 1800 } });
    ctx.NUK = { utilizador: { nivel_acesso: 'GERENTE' }, moduloActual: 'recebimentos' };
    ctx.modalConfirmar = (t, texto, fn, arg) => { ctx._modal = texto; ctx._conf = [fn, arg]; };
    el = { innerHTML: '' };
    await ctx.modulo_recebimentos(el);
    expect(el.innerHTML).toContain('pedirPerdaConta(0)');
    ctx.pedirPerdaConta(0);
    expect(ctx._modal).toContain('Mesa M04'); expect(ctx._modal).toContain('Não pode ser desfeito');
    expect(ctx._conf).toEqual(['registarPerdaConfirmada', 'p1,p2']);
    ctx._els['perda-motivo'] = { value: 'curto' };
    await ctx.registarPerdaConfirmada('p1,p2');
    expect(ctx._chamadas.some(c => c[1] === '/caixa/perdas')).toBe(false);
    ctx._els['perda-motivo'].value = 'Cliente da mesa 4 saiu sem pagar';
    await ctx.registarPerdaConfirmada('p1,p2');
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/perdas', { pedido_ids: ['p1', 'p2'], motivo: 'Cliente da mesa 4 saiu sem pagar' }]);
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

  const TIPOS = [{ id: 't1', valor: 3000, nome: null, ativo: true, por_vender: 12 }, { id: 't2', valor: 6000, nome: 'Piscina', ativo: true, por_vender: 0 }];

  test('Cartões: grelha de botões como os quartos (valor, nome, impressos por vender); sem lotes para o operador', async () => {
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/cartoes': [], '/caixa/cartoes/tipos': TIPOS });
    const el = { innerHTML: '' };
    await ctx.modulo_cartoes(el);
    expect(el.innerHTML).toContain('grid-cards');
    expect(el.innerHTML).toContain('quarto-card cartao-card DISPONIVEL');
    expect(el.innerHTML).toContain('modalVenderCartoes(3000)');
    expect(el.innerHTML).toContain('12 impressos por vender');
    expect(el.innerHTML).toContain('Piscina');
    expect(el.innerHTML).toContain('quarto-card cartao-card ESGOTADO'); // 6000 sem impressos: vermelho
    expect(el.innerHTML).toContain('modalProduzirCartoes(6000)'); // tocado abre a produção, não a venda
    expect(el.innerHTML).not.toContain('modalVenderCartoes(6000)');
    expect(el.innerHTML).not.toContain('gerarLoteCartoes()');
    expect(ctx._chamadas.some(c => c[1] === '/caixa/cartoes/lotes')).toBe(false);
  });

  test('Cartões: sem cartões configurados manda para Configurações', async () => {
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/cartoes': [], '/caixa/cartoes/tipos': [] });
    const el = { innerHTML: '' };
    await ctx.modulo_cartoes(el);
    expect(el.innerHTML).toContain('Configurações → Cartões de consumo');
  });

  test('Venda pela grelha: quantidade gera os campos dos códigos, total = quantidade × valor, valida antes de enviar', async () => {
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/cartoes': [], '/caixa/cartoes/tipos': TIPOS });
    await ctx.modulo_cartoes({ innerHTML: '' });
    ctx.modalVenderCartoes(3000);
    expect(ctx._modal).toContain('vcValidar()');
    expect(ctx._els['vc-codigos'].innerHTML).toContain('vc-cod-0');
    ctx.vcQtd(1); ctx.vcQtd(1);
    expect(ctx._els['vc-codigos'].innerHTML).toContain('vc-cod-2');
    expect(ctx._els['vc-total'].innerHTML).toContain('9000 Kz');
    expect(ctx._els['vc-total'].innerHTML).toContain('3 × 3000 Kz');
    ctx.vcQtd(-1);
    expect(ctx._els['vc-codigos'].innerHTML).not.toContain('vc-cod-2');
    ctx.vcQtdDefinir('999');
    expect(ctx._els['vc-qtd'].value).toBe(50);
    ctx.vcQtdDefinir('2');
    ctx._els['vc-metodo'] = { value: 'TPA' };
    await ctx.vcValidar();
    expect(ctx._toast[0]).toContain('Falta o código do cartão 1');
    ctx.vcCodigo(0, 'ccab-cdefgh'); ctx.vcCodigo(1, 'CCABCDEFGH');
    await ctx.vcValidar();
    expect(ctx._toast[0]).toContain('repetido');
    ctx.vcCodigo(1, 'CC1234');
    await ctx.vcValidar();
    expect(ctx._toast[0]).toContain('cartão 2 inválido');
    expect(ctx._chamadas.some(c => c[0] === 'POST')).toBe(false);
    ctx.vcCodigo(1, 'CCZZZZ2222');
    ctx.api = async (m, u, b) => { ctx._chamadas.push([m, u, b]); return { quantidade: 2, total: 6000, cartoes: [{ codigo: 'CCABCDEFGH' }, { codigo: 'CCZZZZ2222' }] }; };
    await ctx.vcValidar();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/cartoes/vender', { valor: 3000, metodo: 'TPA', codigos: ['CCABCDEFGH', 'CCZZZZ2222'] }]);
    expect(ctx._modal).toContain('6000 Kz');
    expect(ctx._modal).toContain('CCZZZZ2222');
    expect(ctx._modulo).toBe('cartoes');
  });

  test('Caixa → Cartões nunca gera códigos (só vende), nem para o Administrador, com o caixa aberto ou fechado', async () => {
    for (const aberta of [true, false]) {
      const ctx = carregar({ '/caixa': { aberta }, '/caixa/cartoes': [], '/caixa/cartoes/tipos': TIPOS });
      ctx.NUK = { utilizador: { nivel_acesso: 'ADMIN' } };
      const el = { innerHTML: '' };
      await ctx.modulo_cartoes(el);
      expect(el.innerHTML).not.toMatch(/gerarLoteCartoes|venderCartao\(|Gerar/);
      expect(typeof ctx.venderCartao).toBe('undefined');
      expect(typeof ctx.gerarLoteCartoes).toBe('undefined');
      expect(ctx._chamadas.some(c => c[0] === 'POST')).toBe(false);
    }
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/cartoes': [], '/caixa/cartoes/tipos': TIPOS });
    const el = { innerHTML: '' };
    await ctx.modulo_cartoes(el);
    expect(el.innerHTML).toContain('Esgotado · toque para imprimir mais');
  });

  // Produção de cartões no Caixa (21/11/2026): credenciais → cartão e quantidade → folhas A4 completas
  function comFetch(ctx, resposta) {
    ctx.NUK = { token: 'tk' };
    ctx._fetch = [];
    ctx.fetch = async (url, o) => { ctx._fetch.push([url, JSON.parse(o.body)]); return resposta; };
    ctx.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
    ctx.document.createElement = () => ({ click() { ctx._descarregado = this.download; }, remove() {} });
    ctx.document.body = { appendChild() {} };
  }
  const pdfOk = { ok: true, status: 201, headers: { get: h => ({ 'X-Lote-Numero': '7', 'X-Lote-Quantidade': '20' })[h] }, blob: async () => 'pdf' };

  test('Produção: pede as credenciais primeiro e só depois o cartão e a quantidade (10 por omissão)', async () => {
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/cartoes': [], '/caixa/cartoes/tipos': TIPOS, '/caixa/cartoes/producao/autorizar': { nome: 'Ana Admin' } });
    await ctx.modulo_cartoes({ innerHTML: '' });
    ctx.modalProduzirCartoes(6000);
    expect(ctx._modal).toContain('pc-email');
    expect(ctx._modal).toContain('pc-senha');
    expect(ctx._modal).not.toContain('pc-qtd');
    ctx._els['pc-email'] = { value: '' }; ctx._els['pc-senha'] = { value: '' };
    await ctx.pcAutorizar();
    expect(ctx._chamadas.some(c => c[1] === '/caixa/cartoes/producao/autorizar')).toBe(false);
    ctx._els['pc-email'] = { value: ' ana@x.ao ' }; ctx._els['pc-senha'] = { value: '246810' };
    await ctx.pcAutorizar();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/cartoes/producao/autorizar', { email: 'ana@x.ao', palavra_passe: '246810' }]);
    expect(ctx._modal).toContain('Autorizado por <b>Ana Admin</b>');
    expect(ctx._modal).toMatch(/<option value="6000" selected>/);
    expect(ctx._modal).toContain('value="10"');
  });

  test('Produção: menos de uma folha corrige para 10; 13 pergunta reduzir (10) ou avançar (20); folha completa imprime logo', async () => {
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/cartoes': [], '/caixa/cartoes/tipos': TIPOS, '/caixa/cartoes/producao/autorizar': { nome: 'Ana Admin' } });
    comFetch(ctx, pdfOk);
    await ctx.modulo_cartoes({ innerHTML: '' });
    ctx.modalProduzirCartoes(6000);
    ctx._els['pc-email'] = { value: 'ana@x.ao' }; ctx._els['pc-senha'] = { value: '246810' };
    await ctx.pcAutorizar();
    ctx._els['pc-valor'] = { value: '6000' };
    ctx._els['pc-qtd'] = { value: '4' };
    ctx.pcPedir();
    expect(ctx._els['pc-qtd'].value).toBe(10);
    expect(ctx._toast[0]).toMatch(/mínimo é 10/);
    expect(ctx._fetch).toHaveLength(0);
    ctx._els['pc-qtd'] = { value: '13' };
    ctx.pcPedir();
    expect(ctx._modal).toContain('pcProduzir(10)');
    expect(ctx._modal).toContain('Reduzir para 10 (1 folha A4)');
    expect(ctx._modal).toContain('Avançar com 20 (2 folhas A4 completas)');
    expect(ctx._fetch).toHaveLength(0); // nada se gera sem a escolha
    await ctx.pcProduzir(20);
    expect(ctx._fetch).toEqual([['/api/caixa/cartoes/producao', { email: 'ana@x.ao', palavra_passe: '246810', valor: 6000, quantidade: 20 }]]);
    expect(ctx._descarregado).toBe('cartoes-lote-7.pdf');
    expect(ctx._modal).toContain('Lote N.º <b>7</b>');
    expect(ctx._modal).toContain('2 folhas A4 · autorizado por Ana Admin');
    expect(ctx.window._prodCartoes).toBeNull(); // a palavra-passe não fica guardada
    // 5 cartões abaixo de uma folha só têm a opção de avançar
    ctx.pcPerguntarFolhas(5, 0, 10);
    expect(ctx._modal).not.toContain('Reduzir');
  });

  test('Produção: recusa do servidor volta às credenciais e mostra o motivo', async () => {
    const ctx = carregar({ '/caixa': { aberta: true }, '/caixa/cartoes': [], '/caixa/cartoes/tipos': TIPOS, '/caixa/cartoes/producao/autorizar': { nome: 'Rui' } });
    comFetch(ctx, { ok: false, status: 403, json: async () => ({ erro: 'Rui não está autorizado a imprimir cartões.', codigo: 'SEM_PERFIL_CARTOES' }) });
    ctx.modalProduzirCartoes(3000);
    ctx._els['pc-email'] = { value: 'rui@x.ao' }; ctx._els['pc-senha'] = { value: '135790' };
    await ctx.pcAutorizar();
    await ctx.pcProduzir(10);
    expect(ctx._toast[0]).toMatch(/não está autorizado/);
    expect(ctx._modal).toContain('pc-email');
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
    expect(el.innerHTML.match(/modalReceber\(\d+\)"/g)).toHaveLength(2);       // «Receber tudo» por mesa/balcão
    expect(el.innerHTML.match(/modalReceber\(0,\d+\)"/g)).toHaveLength(2);     // a mesa M01 tem duas contas: «Receber esta»
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

describe('Dividir conta (frontend)', () => {
  const pedidos = [{ id: 'p1', total: '6900', mesa_numero: 'M01', itens: [{ id: 'i1', produto_nome: 'Picanha', quantidade: 1, preco_unitario: 4500 }, { id: 'i2', produto_nome: 'Cuca', quantidade: 4, preco_unitario: 600 }], desconto: 0, nukcoin_pago: 0 }];
  test('separa itens escolhidos e envia por pedido', async () => {
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [] }, '/caixa/por-receber': pedidos, '/caixa/dividir': { original: {}, nova: {} } });
    const el = { innerHTML: '' };
    await ctx.modulo_recebimentos(el);
    expect(el.innerHTML).toContain('modalDividir(0)');
    ctx.modalDividir(0);
    ctx.divisaoQtd(1, 1); ctx.divisaoQtd(1, 1);
    expect(ctx._els['dv-total'].textContent).toContain('1200');
    await ctx.confirmarDividir();
    expect(ctx._chamadas).toContainEqual(['POST', '/caixa/dividir', { pedido_id: 'p1', itens: [{ item_id: 'i2', quantidade: 2 }] }]);
  });
  test('mesa com duas contas: «Receber esta» recebe só uma', async () => {
    const duas = [{ ...pedidos[0], id: 'pA', total: '4500' }, { ...pedidos[0], id: 'pB', total: '2400' }];
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [] }, '/caixa/por-receber': duas, '/caixa/receber': { total: 2400 } });
    const el = { innerHTML: '' };
    await ctx.modulo_recebimentos(el);
    expect(el.innerHTML).toContain('modalReceber(0,1)');
    ctx.modalReceber(0, 1);
    ctx._els['rc-metodo'] = { value: 'TPA' };
    await ctx.confirmarReceber();
    expect(ctx._chamadas.find(c => c[1] === '/caixa/receber')[2]).toEqual({ pedido_ids: ['pB'], metodo: 'TPA' });
  });
});

describe('Factura-recibo no Caixa (frontend)', () => {
  const duas = [{ id: 'pA', total: '4500', mesa_numero: 'M02', itens: [] }, { id: 'pB', total: '2400', mesa_numero: 'M02', itens: [] }];
  test('com a opção marcada, depois de receber emite uma FR para os pedidos todos e descarrega o PDF', async () => {
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [] }, '/caixa/por-receber': duas, '/caixa/receber': { total: 6900 }, '/caixa/faturar': { id: 'f1', numero_fatura: 'FR 2026/000001' } });
    const pdfs = []; ctx.descarregarPdf = (...a) => pdfs.push(a);
    await ctx.modulo_recebimentos({ innerHTML: '' });
    ctx.modalReceber(0);
    expect(ctx._modal).toContain('Emitir factura-recibo');
    ctx._els['rc-metodo'] = { value: 'TPA' };
    ctx._els['rc-fr'] = { checked: true }; ctx._els['rc-fr-nif'] = { value: '5417000000' }; ctx._els['rc-fr-nome'] = { value: ' Ana ' };
    await ctx.confirmarReceber();
    await new Promise(r => setTimeout(r, 0));
    const ordem = ctx._chamadas.map(c => c[1]);
    expect(ordem.indexOf('/caixa/receber')).toBeLessThan(ordem.indexOf('/caixa/faturar'));
    expect(ctx._chamadas.find(c => c[1] === '/caixa/faturar')[2]).toEqual({ pedido_ids: ['pA', 'pB'], nif_cliente: '5417000000', nome_cliente: 'Ana' });
    expect(pdfs[0][0]).toBe('/caixa/faturas/f1/pdf');
  });
  test('NIF inválido não recebe nem factura; sem a opção não há factura', async () => {
    const ctx = carregar({ '/caixa': { aberta: true, sessao, resumo, movimentos: [] }, '/caixa/por-receber': duas, '/caixa/receber': { total: 6900 } });
    await ctx.modulo_recebimentos({ innerHTML: '' });
    ctx.modalReceber(0);
    ctx._els['rc-metodo'] = { value: 'TPA' };
    ctx._els['rc-fr'] = { checked: true }; ctx._els['rc-fr-nif'] = { value: '!!' }; ctx._els['rc-fr-nome'] = { value: '' };
    await ctx.confirmarReceber();
    expect(ctx._chamadas.some(c => c[1] === '/caixa/receber')).toBe(false);
    ctx._els['rc-fr'].checked = false;
    await ctx.confirmarReceber();
    await new Promise(r => setTimeout(r, 0));
    expect(ctx._chamadas.some(c => c[1] === '/caixa/receber')).toBe(true);
    expect(ctx._chamadas.some(c => c[1] === '/caixa/faturar')).toBe(false);
  });

  test('Movimentos: pesquisa de hoje, tabela com n.º/referência/funcionário, totais e rasto do cartão', async () => {
    const mov = { data: [{ numero: '7', criado_em: '2026-11-20T09:00:00Z', tipo: 'COMPRA', metodo: 'CASH', valor: '-1500', descricao: 'Compra pontual', referencia: 'Compra: Carvão', operador: 'Ana' },
      { numero: '6', criado_em: '2026-11-20T08:00:00Z', tipo: 'CARTAO_VENDA', metodo: 'TPA', valor: '3000', referencia: 'Cartão CCABCDEFGH', cartao_codigo: 'CCABCDEFGH', operador: 'Rui' }],
      page: 1, limit: 50, total: 2, totais: { entradas: 3000, saidas: -1500, liquido: 1500, por_metodo: [{ metodo: 'CASH', valor: -1500, n: 1 }] } };
    const ctx = carregar({});
    ctx.URLSearchParams = URLSearchParams;
    ctx.api = async (m, u) => { ctx._chamadas.push([m, u]); return u.startsWith('/caixa/auditoria/movimentos') ? mov : {}; };
    const res = { innerHTML: '' };
    ctx._els['mv-resultado'] = res;
    await ctx.modulo_movimentos({ innerHTML: '' });
    const url = ctx._chamadas.find(c => c[1].startsWith('/caixa/auditoria/movimentos'))[1];
    expect(url).toMatch(/de=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}&page=1&limit=50/);
    expect(res.innerHTML).toContain('<b>7</b>');
    expect(res.innerHTML).toContain('Compra: Carvão');
    expect(res.innerHTML).toContain('Ana');
    expect(res.innerHTML).toContain('texto-perigo');
    expect(res.innerHTML).toContain("rastoCartao('CCABCDEFGH')");
    // filtro por forma e cartão
    Object.assign(ctx._els, { 'mv-de': { value: '' }, 'mv-ate': { value: '' }, 'mv-tipo': { value: '' }, 'mv-metodo': { value: 'TPA' }, 'mv-numero': { value: '' }, 'mv-cartao': { value: 'ccabcdefgh' } });
    await ctx.pesquisarMovimentos();
    expect(ctx._chamadas[ctx._chamadas.length - 1][1]).toBe('/caixa/auditoria/movimentos?metodo=TPA&cartao=CCABCDEFGH&page=1&limit=50');
  });

  test('Movimentos: verificação íntegra e com problemas; exportar CSV descarrega com o filtro', async () => {
    const ctx = carregar({ '/caixa/auditoria/verificar': { ok: false, movimentos: 9, ultimo_numero: 9, problemas: [{ texto: 'Movimento n.º 2: o conteúdo do movimento foi alterado' }] } });
    ctx.URLSearchParams = URLSearchParams;
    await ctx.verificarLivroCaixa();
    expect(ctx._modal).toContain('Movimento n.º 2');
    const pdfs = []; ctx.descarregarPdf = (c, n) => pdfs.push([c, n]);
    Object.assign(ctx._els, { 'mv-de': { value: '2026-11-01' }, 'mv-ate': { value: '2026-11-20' }, 'mv-tipo': { value: 'DESPESA' }, 'mv-metodo': { value: '' }, 'mv-numero': { value: '' }, 'mv-cartao': { value: '' } });
    ctx.exportarMovimentos();
    expect(pdfs[0]).toEqual(['/caixa/auditoria/movimentos.csv?de=2026-11-01&ate=2026-11-20&tipo=DESPESA', 'movimentos-caixa-2026-11-01_2026-11-20.csv']);
  });
});
