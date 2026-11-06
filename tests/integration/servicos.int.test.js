'use strict';
/** Integração — Serviços: itens, avarias/danos e prazos de manutenção. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, ipN = 1, sala;
const ip = () => `10.88.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const dia = d => { const x = new Date(Date.now() + d * 86400000 + 3600000); return x.toISOString().slice(0, 10); };

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-servicos' });
  B = await criarTenantFixture({ slug: 'it-servicos-b' });
});

describe('Itens', () => {
  test('cadastra físico e móvel; valida tipo e nome; isolado por estabelecimento', async () => {
    expect((await a('post', '/api/servicos/ativos', { nome: '', tipo: 'FISICA' })).status).toBe(400);
    expect((await a('post', '/api/servicos/ativos', { nome: 'X', tipo: 'OUTRO' })).status).toBe(400);
    const r = await a('post', '/api/servicos/ativos', { nome: 'Sala principal', tipo: 'FISICA', localizacao: 'Piso 0' });
    expect(r.status).toBe(201); sala = r.body.id;
    expect((await a('post', '/api/servicos/ativos', { nome: 'Carrinha', tipo: 'MOVEL' })).status).toBe(201);
    expect((await a('get', '/api/servicos/ativos')).body).toHaveLength(2);
    expect((await op(B, 'get', '/api/servicos/ativos')).body).toHaveLength(0);
    expect((await op(B, 'patch', `/api/servicos/ativos/${sala}`, { nome: 'roubado' })).status).toBe(404);
    expect((await a('patch', '/api/servicos/ativos/xx', { nome: 'a' })).status).toBe(400);
  });
});

describe('Avarias e danos', () => {
  let oc;
  test('reporta, valida e ordena por prioridade', async () => {
    expect((await a('post', '/api/servicos/ocorrencias', { tipo: 'NADA', titulo: 'x' })).status).toBe(400);
    expect((await a('post', '/api/servicos/ocorrencias', { tipo: 'AVARIA', titulo: ' ' })).status).toBe(400);
    expect((await a('post', '/api/servicos/ocorrencias', { tipo: 'AVARIA', titulo: 'x', prioridade: 'MAXIMA' })).status).toBe(400);
    expect((await op(B, 'post', '/api/servicos/ocorrencias', { tipo: 'AVARIA', titulo: 'x', ativo_id: sala })).status).toBe(404);
    await a('post', '/api/servicos/ocorrencias', { tipo: 'DANO', titulo: 'Cadeira partida', prioridade: 'BAIXA', ativo_id: sala });
    const r = await a('post', '/api/servicos/ocorrencias', { tipo: 'AVARIA', titulo: 'Ar condicionado parado', prioridade: 'URGENTE', ativo_id: sala });
    expect(r.status).toBe(201); oc = r.body.id;
    const l = (await a('get', '/api/servicos/ocorrencias?estado=ABERTAS')).body;
    expect(l.map(x => x.titulo)).toEqual(['Ar condicionado parado', 'Cadeira partida']);
    expect(l[0].ativo_nome).toBe('Sala principal');
    expect((await a('get', '/api/servicos/resumo')).body).toMatchObject({ abertas: 2, urgentes: 1 });
  });
  test('fluxo de estados: resolver exige texto; fechada não volta a mexer; outro estabelecimento não toca', async () => {
    expect((await op(B, 'patch', `/api/servicos/ocorrencias/${oc}`, { estado: 'EM_CURSO' })).status).toBe(404);
    expect((await a('patch', `/api/servicos/ocorrencias/${oc}`, { estado: 'EM_CURSO' })).status).toBe(200);
    expect((await a('patch', `/api/servicos/ocorrencias/${oc}`, { estado: 'RESOLVIDA' })).status).toBe(400);
    expect((await a('patch', `/api/servicos/ocorrencias/${oc}`, { estado: 'ABERTA' })).status).toBe(400);
    const r = await a('patch', `/api/servicos/ocorrencias/${oc}`, { estado: 'RESOLVIDA', resolucao: 'Trocado o compressor' });
    expect(r.status).toBe(200); expect(r.body.resolvido_em).toBeTruthy();
    expect((await a('patch', `/api/servicos/ocorrencias/${oc}`, { estado: 'EM_CURSO' })).status).toBe(409);
    expect((await a('get', '/api/servicos/resumo')).body.abertas).toBe(1);
  });
});

describe('Prazos de manutenção', () => {
  let plano;
  test('cria plano, valida e lista por prazo com dias restantes', async () => {
    expect((await a('post', '/api/servicos/manutencoes', { ativo_id: sala, descricao: 'Revisão AC', periodicidade_dias: 0 })).status).toBe(400);
    expect((await a('post', '/api/servicos/manutencoes', { descricao: 'Revisão AC', periodicidade_dias: 30 })).status).toBe(400);
    expect((await op(B, 'post', '/api/servicos/manutencoes', { ativo_id: sala, descricao: 'x', periodicidade_dias: 30 })).status).toBe(404);
    const atrasada = await a('post', '/api/servicos/manutencoes', { ativo_id: sala, descricao: 'Extintores', periodicidade_dias: 180, primeira_em: dia(-3) });
    expect(atrasada.status).toBe(201);
    const r = await a('post', '/api/servicos/manutencoes', { ativo_id: sala, descricao: 'Revisão AC', periodicidade_dias: 30 });
    expect(r.status).toBe(201); plano = r.body.id;
    const l = (await a('get', '/api/servicos/manutencoes')).body;
    expect(l.map(x => x.descricao)).toEqual(['Extintores', 'Revisão AC']);
    expect(l[0].dias_restantes).toBe(-3); expect(l[1].dias_restantes).toBe(30);
    expect((await a('get', '/api/servicos/resumo')).body).toMatchObject({ atrasadas: 1, proximas: 0 });
  });
  test('registar realizada empurra o prazo pela periodicidade, guarda histórico e recusa datas futuras', async () => {
    expect((await a('post', `/api/servicos/manutencoes/${plano}/realizada`, { data: dia(2) })).status).toBe(400);
    expect((await a('post', `/api/servicos/manutencoes/${plano}/realizada`, { data: 'ontem' })).status).toBe(400);
    expect((await op(B, 'post', `/api/servicos/manutencoes/${plano}/realizada`, {})).status).toBe(404);
    const r = await a('post', `/api/servicos/manutencoes/${plano}/realizada`, { data: dia(-1), observacoes: 'Filtros limpos' });
    expect(r.status).toBe(200); expect(r.body.ultima_em).toBe(dia(-1)); expect(r.body.proxima_em).toBe(dia(29));
    const h = (await a('get', `/api/servicos/manutencoes/${plano}/historico`)).body;
    expect(h).toHaveLength(1); expect(h[0].observacoes).toBe('Filtros limpos');
  });
  test('desactivar plano tira-o da lista; item desactivado não aceita novos planos', async () => {
    expect((await a('patch', `/api/servicos/manutencoes/${plano}`, { ativo: false })).status).toBe(200);
    expect((await a('get', '/api/servicos/manutencoes')).body.map(x => x.id)).not.toContain(plano);
    await a('patch', `/api/servicos/ativos/${sala}`, { ativo: false });
    expect((await a('post', '/api/servicos/manutencoes', { ativo_id: sala, descricao: 'x', periodicidade_dias: 10 })).status).toBe(409);
  });
});
