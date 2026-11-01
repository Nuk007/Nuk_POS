'use strict';
/** Integração — configuração de quartos: criar, editar, apagar, permissões e isolamento. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, G, ipN = 1;
const ip = () => `10.9.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const corpo = (o = {}) => ({ numero: '101', tipo: 'SUITE', andar: 1, preco_2h: 15000, preco_pernoite: 30000, preco_diaria: 45000, ...o });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-quartos-a' });
  B = await criarTenantFixture({ slug: 'it-quartos-b' });
  G = await criarTenantFixture({ slug: 'it-quartos-g', nivel: 'OPERADOR' });
}, 60000);

describe('Quartos — configuração', () => {
  let id;
  test('cria quarto e aparece na listagem com preços', async () => {
    const r = await op(A, 'post', '/api/quartos', corpo());
    expect(r.status).toBe(201);
    id = r.body.id;
    const l = await op(A, 'get', '/api/quartos');
    const q = l.body.find(x => x.id === id);
    expect(q.numero).toBe('101');
    expect(Number(q.preco_pernoite)).toBe(30000);
    expect(q.status).toBe('DISPONIVEL');
  });
  test('validações e número duplicado', async () => {
    expect((await op(A, 'post', '/api/quartos', corpo({ numero: '' }))).status).toBe(400);
    expect((await op(A, 'post', '/api/quartos', corpo({ numero: '102', tipo: 'X' }))).status).toBe(400);
    expect((await op(A, 'post', '/api/quartos', corpo({ numero: '102', preco_2h: -1 }))).status).toBe(400);
    expect((await op(A, 'post', '/api/quartos', corpo({ numero: '102', preco_diaria: '' }))).status).toBe(400);
    expect((await op(A, 'post', '/api/quartos', corpo())).status).toBe(409);
  });
  test('o mesmo número pode existir noutro estabelecimento', async () => {
    expect((await op(B, 'post', '/api/quartos', corpo())).status).toBe(201);
  });
  test('edita preços e tipo', async () => {
    const r = await op(A, 'put', `/api/quartos/${id}`, { preco_2h: 20000, tipo: 'VIP_EXECUTIVO' });
    expect(r.status).toBe(200);
    expect(Number(r.body.preco_2h)).toBe(20000);
    expect(r.body.tipo).toBe('VIP_EXECUTIVO');
    expect((await op(A, 'put', `/api/quartos/${id}`, {})).status).toBe(400);
  });
  test('perfil sem permissão não configura', async () => {
    expect((await op(G, 'post', '/api/quartos', corpo({ numero: '900' }))).status).toBe(403);
    expect((await op(G, 'put', `/api/quartos/${id}`, { preco_2h: 1 })).status).toBe(403);
  });
  test('isolamento: outro estabelecimento não edita nem apaga', async () => {
    expect((await op(B, 'put', `/api/quartos/${id}`, { preco_2h: 1 })).status).toBe(404);
    expect((await op(B, 'delete', `/api/quartos/${id}`)).status).toBe(404);
  });
  test('apaga quarto sem histórico; recusa com reservas', async () => {
    const r2 = await op(A, 'post', '/api/quartos', corpo({ numero: '103' }));
    expect((await op(A, 'delete', `/api/quartos/${r2.body.id}`)).status).toBe(204);
    await pool.query(
      `INSERT INTO reservas (tenant_id, quarto_id, nome_hospede, fracao, checkin, checkout, valor_total)
       VALUES ($1,$2,'Teste','DUAS_HORAS',NOW(),NOW()+INTERVAL '2 hours',20000)`, [A.tenantId, id]);
    const d = await op(A, 'delete', `/api/quartos/${id}`);
    expect(d.status).toBe(409);
  });
});
