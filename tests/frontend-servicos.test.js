'use strict';
/** Ecrãs de Serviços em vm, sem navegador. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ler = f => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
function carregar(dados) {
  const chamadas = [], els = {};
  const el = id => els[id] || (els[id] = { innerHTML: '', value: '', textContent: '', style: {} });
  const ctx = {
    console, window: {}, setTimeout, Promise, Date, Intl,
    document: { getElementById: el, querySelectorAll: () => [] },
    api: async (m, url, corpo) => { chamadas.push([m, url, corpo]); return url in dados ? dados[url] : {}; },
    toast: (...a) => { ctx._toast = a; }, abrirModal: (t, h) => { ctx._modal = h; }, fecharModal() {},
    carregarModulo: m => { ctx._modulo = m; }, esc: v => String(v ?? '').replace(/</g, '&lt;'),
    modalConfirmar: (t, x, f, ...a) => { ctx._confirmar = [f, ...a]; },
  };
  ctx._chamadas = chamadas; ctx._els = els;
  vm.createContext(ctx);
  vm.runInContext(ler('servicos.js'), ctx);
  return ctx;
}
const oc = { id: 'o1', tipo: 'AVARIA', titulo: 'AC parado', prioridade: 'URGENTE', estado: 'ABERTA', criado_em: '2026-11-06T10:00:00Z', ativo_nome: 'Sala' };

describe('Serviços (frontend)', () => {
  test('lista por resolver; reportar valida o título e envia o corpo esperado', async () => {
    const ctx = carregar({ '/servicos/ocorrencias?estado=ABERTAS': [oc], '/servicos/ativos': [{ id: 'a1', nome: 'Sala', tipo: 'FISICA', ativo: true }] });
    const el = { innerHTML: '' };
    await ctx.modulo_servicos(el);
    expect(el.innerHTML).toContain('AC parado');
    expect(el.innerHTML).toContain('ocorrenciaEmCurso(0)');
    ctx.modalNovaOcorrencia();
    expect(ctx._modal).toContain('Sala');
    for (const [k, v] of Object.entries({ 'oc-tipo': 'AVARIA', 'oc-titulo': '  ', 'oc-desc': '', 'oc-prio': 'ALTA', 'oc-ativo': 'a1' })) ctx._els[k] = { value: v };
    await ctx.criarOcorrencia();
    expect(ctx._chamadas.some(c => c[0] === 'POST')).toBe(false);
    ctx._els['oc-titulo'].value = 'AC parado';
    await ctx.criarOcorrencia();
    expect(ctx._chamadas).toContainEqual(['POST', '/servicos/ocorrencias', { tipo: 'AVARIA', titulo: 'AC parado', descricao: undefined, prioridade: 'ALTA', ativo_id: 'a1' }]);
  });
  test('cancelar pede confirmação e exige motivo; resolver exige texto', async () => {
    const ctx = carregar({ '/servicos/ocorrencias?estado=ABERTAS': [oc], '/servicos/ativos': [] });
    await ctx.modulo_servicos({ innerHTML: '' });
    ctx.pedirCancelarOcorrencia(0);
    expect(ctx._confirmar).toEqual(['modalFecharOcorrencia', 0, 'CANCELADA']);
    expect(ctx._chamadas.some(c => c[0] === 'PATCH')).toBe(false);
    ctx.modalFecharOcorrencia(0, 'RESOLVIDA');
    ctx._els['oc-res'] = { value: ' ' };
    await ctx.fecharOcorrencia();
    expect(ctx._chamadas.some(c => c[0] === 'PATCH')).toBe(false);
    ctx._els['oc-res'].value = 'Trocado o compressor';
    await ctx.fecharOcorrencia();
    expect(ctx._chamadas).toContainEqual(['PATCH', '/servicos/ocorrencias/o1', { estado: 'RESOLVIDA', resolucao: 'Trocado o compressor' }]);
  });
  test('prazos: assinala atrasadas e regista como feita', async () => {
    const ctx = carregar({ '/servicos/manutencoes': [{ id: 'm1', descricao: 'Extintores', ativo_nome: 'Sala', ativo_tipo: 'FISICA', periodicidade_dias: 180, proxima_em: '2026-11-03', ultima_em: null, dias_restantes: -3 }], '/servicos/manutencoes/m1/realizada': { proxima_em: '2027-05-05' } });
    const el = { innerHTML: '' };
    await ctx.modulo_manutencao(el);
    expect(el.innerHTML).toContain('Atrasada 3 dias');
    expect(el.innerHTML).toContain('03/11/2026');
    ctx.modalManutencaoFeita(0);
    ctx._els['mf-data'] = { value: '' }; ctx._els['mf-obs'] = { value: '' };
    await ctx.manutencaoFeita();
    expect(ctx._chamadas).toContainEqual(['POST', '/servicos/manutencoes/m1/realizada', { data: undefined, observacoes: undefined }]);
  });
  test('configurações: desactivar item e plano passa por confirmação', () => {
    const ctx = carregar({});
    const html = ctx.htmlConfigServicos([{ id: 'a1', nome: 'Sala', tipo: 'FISICA', ativo: true }], [{ id: 'p1', descricao: 'Revisão', ativo_nome: 'Sala', periodicidade_dias: 30 }]);
    expect(html).toContain('pedirDesativarAtivo(0)'); expect(html).toContain('pedirDesativarPlano(0)');
    ctx.pedirDesativarAtivo(0); expect(ctx._confirmar).toEqual(['desativarAtivo', 0]);
    ctx.pedirDesativarPlano(0); expect(ctx._confirmar).toEqual(['desativarPlano', 0]);
    expect(ctx._chamadas).toHaveLength(0);
  });
});
