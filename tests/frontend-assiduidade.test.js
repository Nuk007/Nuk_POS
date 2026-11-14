'use strict';
/** Botão de assiduidade e ecrã da chefia, em vm. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function carregar(nivel, dados) {
  const els = {}, chamadas = [];
  const el = id => els[id] || (els[id] = { innerHTML: '', value: '', textContent: '', style: {} });
  const ctx = {
    console, window: {}, Promise, Date, NUK: { utilizador: { nivel_acesso: nivel, modulos: ['rh'] } },
    document: { getElementById: el },
    api: async (m, url, corpo) => { chamadas.push([m, url, corpo]); const k = Object.keys(dados).find(x => url.startsWith(x)); return k ? dados[k] : {}; },
    toast: (...a) => { ctx._toast = a; }, esc: v => String(v ?? ''), carregarModulo() {}, fecharModal() {},
    abrirModal: (t, h) => { ctx._modal = h; }, modalConfirmar: (t, x, f) => { ctx._confirmar = f; },
  };
  ctx._els = els; ctx._chamadas = chamadas;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/assiduidade.js'), 'utf8'), ctx);
  return ctx;
}

describe('Assiduidade (frontend)', () => {
  test('fora de serviço: o botão regista a entrada; em serviço: a saída pede confirmação', async () => {
    const ctx = carregar('OPERADOR', { '/ponto': { em_servico: false } });
    await ctx.actualizarPonto();
    expect(ctx._els['btn-ponto'].textContent).toContain('Registar entrada');
    await ctx.clicarPonto();
    expect(ctx._chamadas).toContainEqual(['POST', '/ponto/entrada', undefined]);
    const c2 = carregar('OPERADOR', { '/ponto': { em_servico: true, registo: { entrada_em: '2026-11-14T08:00:00Z' } } });
    await c2.actualizarPonto();
    expect(c2._els['btn-ponto'].textContent).toContain('Saída');
    await c2.clicarPonto();
    expect(c2._confirmar).toBe('registarSaidaPonto');
    expect(c2._chamadas.find(c => c[1] === '/ponto/saida')).toBeUndefined();
  });
  test('ecrã da chefia mostra horas e permite corrigir saídas em aberto', async () => {
    const ctx = carregar('GERENTE', { '/ponto/relatorio': { por_funcionario: [{ nome: 'Rui', cargo: 'Empregado', dias: 2, horas: 15.5, em_aberto: 1 }], registos: [{ id: 'r1', nome: 'Rui', entrada_em: '2026-11-13T08:00:00Z', saida_em: null, horas: null, esquecido: true }] } });
    const el = { innerHTML: '' };
    await ctx.modulo_assiduidade(el);
    expect(el.innerHTML).toContain('15,5 h');
    expect(el.innerHTML).toContain('Saída esquecida');
    expect(el.innerHTML).toContain("modalCorrigirSaida('r1')");
    ctx.modalCorrigirSaida('r1');
    ctx._els['cs-saida'] = { value: '2026-11-13T17:00' }; ctx._els['cs-obs'] = { value: 'Esqueceu-se' };
    await ctx.corrigirSaidaPonto('r1');
    expect(ctx._chamadas).toContainEqual(['PATCH', '/ponto/r1/saida', { saida_em: '2026-11-13T16:00:00.000Z', observacoes: 'Esqueceu-se' }]);
  });
});
