'use strict';
/** Integração — listas configuráveis por estabelecimento (tipos de quarto, categorias, unidades). */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, G, ipN = 1;
const ip = () => `10.10.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const quarto = (o = {}) => ({ numero: '1', tipo: 'STANDARD', preco_2h: 1, preco_pernoite: 2, preco_diaria: 3, ...o });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-listas-a' });
  B = await criarTenantFixture({ slug: 'it-listas-b' });
  G = await criarTenantFixture({ slug: 'it-listas-g', nivel: 'OPERADOR' });
}, 60000);

describe('Listas configuráveis', () => {
  test('cada estabelecimento recebe os valores padrão', async () => {
    const r = await op(A, 'get', '/api/listas/TIPO_QUARTO');
    expect(r.status).toBe(200);
    expect(r.body.map(o => o.valor)).toEqual(['STANDARD', 'SUPERIOR', 'SUITE', 'SUITE_PRESIDENCIAL', 'VIP_EXECUTIVO']);
    expect((await op(A, 'get', '/api/listas/NAO_EXISTE')).status).toBe(404);
    const todas = await op(A, 'get', '/api/listas');
    expect(Object.keys(todas.body).sort()).toEqual(['CATEGORIA_PATRIMONIO', 'CATEGORIA_PRODUTO', 'CATEGORIA_STOCK', 'TIPO_QUARTO', 'UNIDADE_STOCK']);
  });
  test('tipo de quarto novo: sem estar na lista é recusado; depois de acrescentado é aceite', async () => {
    expect((await op(A, 'post', '/api/quartos', quarto({ tipo: 'CHALE' }))).status).toBe(400);
    const c = await op(A, 'post', '/api/listas/TIPO_QUARTO', { nome: 'Chalé familiar' });
    expect(c.status).toBe(201);
    expect(c.body.valor).toBe('CHALE_FAMILIAR');
    expect((await op(A, 'post', '/api/quartos', quarto({ tipo: 'CHALE_FAMILIAR' }))).status).toBe(201);
    expect((await op(A, 'post', '/api/listas/TIPO_QUARTO', { nome: 'chale familiar' })).status).toBe(409);
    expect((await op(A, 'post', '/api/listas/TIPO_QUARTO', { nome: '  ' })).status).toBe(400);
  });
  test('isolamento: a lista de A não vale para B', async () => {
    expect((await op(B, 'post', '/api/quartos', quarto({ tipo: 'CHALE_FAMILIAR' }))).status).toBe(400);
    const l = await op(B, 'get', '/api/listas/TIPO_QUARTO');
    expect(l.body.map(o => o.valor)).not.toContain('CHALE_FAMILIAR');
  });
  test('só ADMIN configura; qualquer perfil lê', async () => {
    expect((await op(G, 'post', '/api/listas/TIPO_QUARTO', { nome: 'X' })).status).toBe(403);
    expect((await op(G, 'get', '/api/listas/TIPO_QUARTO')).status).toBe(200);
  });
  test('categoria de produto e categoria/unidade de stock usam as listas', async () => {
    expect((await op(A, 'post', '/api/produtos', { nome: 'Gelado', preco: 500, categoria: 'GELADOS' })).status).toBe(400);
    expect((await op(A, 'post', '/api/listas/CATEGORIA_PRODUTO', { nome: 'Gelados' })).status).toBe(201);
    expect((await op(A, 'post', '/api/produtos', { nome: 'Gelado', preco: 500, categoria: 'GELADOS' })).status).toBe(201);
    const st = { nome: 'Sal', categoria: 'TEMPERO', unidade: 'saco', stock_atual: 1, stock_minimo: 0 };
    expect((await op(A, 'post', '/api/stock', st)).status).toBe(400);
    expect((await op(A, 'post', '/api/listas/UNIDADE_STOCK', { nome: 'saco' })).status).toBe(201);
    expect((await op(A, 'post', '/api/stock', st)).status).toBe(201);
  });
  test('opção em uso não se apaga; desactivada deixa de ser aceite para novos registos', async () => {
    const l = (await op(A, 'get', '/api/listas/CATEGORIA_PRODUTO')).body.find(o => o.valor === 'GELADOS');
    expect((await op(A, 'delete', `/api/listas/CATEGORIA_PRODUTO/${l.id}`)).status).toBe(409);
    expect((await op(A, 'put', `/api/listas/CATEGORIA_PRODUTO/${l.id}`, { ativo: false })).status).toBe(200);
    expect((await op(A, 'post', '/api/produtos', { nome: 'Gelado 2', preco: 500, categoria: 'GELADOS' })).status).toBe(400);
    const livre = (await op(A, 'post', '/api/listas/CATEGORIA_PRODUTO', { nome: 'Temporária' })).body;
    expect((await op(A, 'delete', `/api/listas/CATEGORIA_PRODUTO/${livre.id}`)).status).toBe(204);
  });
  test('categorias já usadas por dados antigos entram na lista do estabelecimento', async () => {
    const C = await criarTenantFixture({ slug: 'it-listas-c' });
    await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Velho',100,'ANTIGA',true,true)`, [C.tenantId]);
    const l = await op(C, 'get', '/api/listas/CATEGORIA_PRODUTO');
    expect(l.body.map(o => o.valor)).toContain('ANTIGA');
  });
});
