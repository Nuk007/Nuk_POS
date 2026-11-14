'use strict';
/** Ecrã de Relatórios em vm, sem navegador. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function carregar(nivel, dados) {
  const chamadas = [];
  const ctx = {
    console, window: {}, Promise, Date, NUK: { utilizador: { nivel_acesso: nivel } },
    document: { getElementById: id => ({ value: { 'rel-de': '2026-11-01', 'rel-ate': '2026-11-14' }[id] || '' }) },
    api: async (m, url) => { chamadas.push(url); const k = Object.keys(dados).find(x => url.startsWith(x)); return k ? dados[k] : {}; },
    formatarMoeda: v => `${v} Kz`, toast: (...a) => { ctx._toast = a; }, esc: v => String(v ?? ''), carregarModulo: m => { ctx._modulo = m; },
  };
  ctx._chamadas = chamadas;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/relatorios.js'), 'utf8'), ctx);
  return ctx;
}
const rel = {
  totais: { pedidos: 2, valor: 12000, ticket_medio: 6000, descontos: 0, cancelados: 1, valor_cancelado: 12000, por_receber: 0 },
  recebido_por_forma: { TPA: 6000, CONTA: 6000 }, caixa_por_forma: {},
  por_funcionario: [{ nome: 'Ana', pedidos: 2, valor: 12000, cancelamentos: 1 }],
  por_produto: [{ nome: 'Mufete', quantidade: 2, valor: 12000 }], por_hora: [{ hora: 13, pedidos: 2, valor: 12000 }],
  cancelamentos: [{ origem: 'MESA', mesa: 'M01', total: 12000, cancelado_por_nome: 'Ana', motivo_cancelamento: 'Desistiu', criado_em: '2026-11-14T12:00:00Z' }],
};

describe('Relatórios (frontend)', () => {
  test('OPERADOR não vê; chefia vê formas, funcionários, cancelamentos e talões Z', async () => {
    const op = carregar('OPERADOR', {}); const e1 = { innerHTML: '' };
    await op.modulo_relatorios(e1);
    expect(e1.innerHTML).toMatch(/só para administradores/);
    const ctx = carregar('GERENTE', { '/relatorios/vendas': rel, '/caixa/sessoes': [{ id: 's1-abcdefgh', aberta_em: '2026-11-14T08:00:00Z', fechada_em: null }] });
    const el = { innerHTML: '' };
    await ctx.modulo_relatorios(el);
    expect(el.innerHTML).not.toMatch(/erro-msg/);
    ['Conta corrente', 'Ana', 'Mufete', 'Desistiu', 'Talão Z', "/relatorios/caixa/s1-abcdefgh/talao.pdf"].forEach(t => expect(el.innerHTML).toContain(t));
  });
  test('filtro de datas e atalhos mudam o período', () => {
    const ctx = carregar('ADMIN', {});
    ctx.aplicarFiltroRelatorio();
    expect(ctx.window._relFiltro).toEqual({ de: '2026-11-01', ate: '2026-11-14' });
    ctx.periodoRelatorio('mes');
    expect(ctx.window._relFiltro.de.endsWith('-01')).toBe(true);
  });
});

describe('Resumo de ontem (frontend)', () => {
  const base = { texto: '📊 Resumo de Casa — 13/11/2026\nReceita: 15 000 Kz', link_whatsapp: 'https://wa.me/244923111222?text=x', config: { ativo: true, telefone: '923111222' } };
  function comCaixa(dados) {
    const ctx = carregar('ADMIN', dados);
    const box = { innerHTML: '' };
    ctx.document.getElementById = id => (id === 'rel-resumo' ? box : { value: '' });
    return { ctx, box };
  }
  test('mostra o texto e a ligação wa.me; sem API oficial não há «Enviar agora»', async () => {
    const { ctx, box } = comCaixa({ '/relatorios/resumo-diario': { ...base, whatsapp_oficial: false, envio: { estado: 'SO_APP' } } });
    await ctx.carregarResumoDiario();
    expect(box.innerHTML).toContain('Receita: 15 000 Kz');
    expect(box.innerHTML).toContain('href="https://wa.me/244923111222?text=x"');
    expect(box.innerHTML).not.toContain('enviarResumoAgora');
    expect(box.innerHTML).toContain('disponível só aqui');
  });
  test('com API oficial e número, «Enviar agora» chama o servidor', async () => {
    const { ctx, box } = comCaixa({ '/relatorios/resumo-diario': { ...base, whatsapp_oficial: true, envio: null } });
    await ctx.carregarResumoDiario();
    expect(box.innerHTML).toContain("enviarResumoAgora()");
    await ctx.enviarResumoAgora();
    expect(ctx._chamadas).toContain('/relatorios/resumo-diario/enviar');
  });
});

describe('Cadeia (frontend)', () => {
  const fs2 = require('fs'), path2 = require('path'), vm2 = require('vm');
  function cadeia(nivel, dados) {
    const els = {};
    const ctx = {
      console, window: {}, Promise, NUK: { utilizador: { nivel_acesso: nivel } }, location: { reload() { ctx._recarregou = true; } },
      localStorage: { setItem() {} }, document: { getElementById: id => els[id] || (els[id] = { innerHTML: '', value: '', style: {}, textContent: '' }) },
      api: async (m, url, corpo) => { (ctx._chamadas = ctx._chamadas || []).push([m, url, corpo]); const k = Object.keys(dados).find(x => url.startsWith(x)); if (dados[k] instanceof Error) throw dados[k]; return dados[k]; },
      formatarMoeda: v => `${v} Kz`, toast: (...a) => { ctx._toast = a; }, esc: v => String(v ?? ''), abrirModal: (t, h) => { ctx._modal = h; },
    };
    ctx._els = els;
    vm2.createContext(ctx);
    vm2.runInContext(fs2.readFileSync(path2.join(__dirname, '../public/js/cadeia.js'), 'utf8'), ctx);
    return ctx;
  }
  const lista = { actual: 'ta', cadeia: { nome: 'Grupo X' }, estabelecimentos: [{ tenant_id: 'ta', nome: 'Casa A', actual: true, nivel_acesso: 'ADMIN' }, { tenant_id: 'tb', nome: 'Casa B', actual: false, nivel_acesso: 'ADMIN' }] };
  test('botão 🏢 só com mais de um estabelecimento; troca envia a palavra-passe e recarrega', async () => {
    const ctx = cadeia('ADMIN', { '/cadeia/estabelecimentos': lista, '/cadeia/trocar': { token: 'novo', funcionario: { nome: 'Dono' } } });
    await ctx.cadeiaArrancar();
    expect(ctx._els['btn-cadeia'].style.display).toBe('');
    expect(ctx._els['btn-cadeia'].textContent).toContain('Casa A');
    ctx.modalCadeia();
    expect(ctx._modal).toContain("pedirTrocaEstabelecimento('tb')");
    ctx.pedirTrocaEstabelecimento('tb');
    ctx._els['cadeia-pp'].value = '222222';
    await ctx.confirmarTrocaEstabelecimento();
    expect(ctx._chamadas).toContainEqual(['POST', '/cadeia/trocar', { tenant_id: 'tb', palavra_passe: '222222' }]);
    expect(ctx.NUK.token).toBe('novo');
    expect(ctx._recarregou).toBe(true);
    const so = cadeia('ADMIN', { '/cadeia/estabelecimentos': { ...lista, estabelecimentos: [lista.estabelecimentos[0]] } });
    await so.cadeiaArrancar();
    expect(so._els['btn-cadeia'].style.display).toBe('none');
  });
  test('consolidado: tabela com total para ADMIN; sem cadeia não mostra nada', async () => {
    const ctx = cadeia('ADMIN', { '/cadeia/consolidado': { cadeia: { nome: 'Grupo X' }, estabelecimentos: [{ nome: 'Casa A', receita: 10, pedidos: 1, ticket_medio: 10, despesas: 0, resultado: 10, por_receber: 0, actual: true }, { nome: 'Casa B', receita: 7, pedidos: 1, ticket_medio: 7, despesas: 0, resultado: 7, por_receber: 0 }], total: { receita: 17, pedidos: 2, ticket_medio: 8, despesas: 0, resultado: 17, por_receber: 0 } } });
    await ctx.carregarConsolidadoCadeia('2026-11-13', '2026-11-13');
    expect(ctx._els['rel-cadeia'].innerHTML).toContain('Total');
    expect(ctx._els['rel-cadeia'].innerHTML).toContain('17 Kz');
    const sem = cadeia('ADMIN', { '/cadeia/consolidado': Object.assign(new Error('sem cadeia'), {}) });
    await sem.carregarConsolidadoCadeia('2026-11-13', '2026-11-13');
    expect(sem._els['rel-cadeia'].innerHTML).toBe('');
  });
});
