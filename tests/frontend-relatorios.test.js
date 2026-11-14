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
