'use strict';
/** Integração (PostgreSQL real) — níveis de preço (tabelas) aplicados pelo servidor, e prato do dia. */
const request = require('supertest');
const { app } = require('../../server/app');
const { agoraLuanda } = require('../../server/services/precos.service');

let A, B, cuca, picanha, n = 1;
const ip = () => `10.12.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const hh = h => `${String((h + 24) % 24).padStart(2, '0')}:00`;

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-precos-a' });
  B = await criarTenantFixture({ slug: 'it-precos-b' });
  const ins = (t, nome, preco, cat) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [t, nome, preco, cat]);
  cuca = (await ins(A.tenantId, 'Cuca', 600, 'BEBIDA')).rows[0].id;
  picanha = (await ins(A.tenantId, 'Picanha', 4500, 'CHURRASCO')).rows[0].id;
  await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,'M01',4)`, [A.tenantId]);
}, 60000);

describe('Configuração das tabelas (só ADMIN)', () => {
  test('validações, nome único e máximo de 5', async () => {
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'X' })).status).toBe(400);
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'Noite', hora_inicio: '22:00' })).status).toBe(400);
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'Noite', origens: ['CHEQUE'] })).status).toBe(400);
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'Noite', dias: [7] })).status).toBe(400);
    const ids = [];
    for (const nome of ['T1', 'T2', 'T3', 'T4', 'T5']) {
      const r = await call(A, 'post', '/api/precos/tabelas', { nome, ativa: false });
      expect(r.status).toBe(201); ids.push(r.body.id);
    }
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'T6' })).status).toBe(409);
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'T1' })).status).toBe(409);
    for (const id of ids) expect((await call(A, 'delete', `/api/precos/tabelas/${id}`)).status).toBe(200);
    expect((await call(B, 'delete', `/api/precos/tabelas/${ids[0]}`)).status).toBe(404);
  });
});

describe('Preço aplicado no pedido', () => {
  let esplanada;
  test('tabela só da Mesa: Mesa paga o preço da tabela, Balcão o preço normal; produto sem preço na tabela = normal', async () => {
    esplanada = (await call(A, 'post', '/api/precos/tabelas', { nome: 'Esplanada', origens: ['MESA'] })).body;
    expect((await call(A, 'put', `/api/precos/tabelas/${esplanada.id}/precos`, { precos: [{ produto_id: cuca, preco: 800 }] })).status).toBe(200);
    const actual = await call(A, 'get', '/api/precos/actuais?origem=MESA');
    expect(actual.body.tabela.nome).toBe('Esplanada');
    expect(actual.body.precos[cuca]).toBe(800);
    expect((await call(A, 'get', '/api/precos/actuais?origem=BALCAO')).body.tabela).toBeNull();

    const mesa = (await pool.query(`SELECT id FROM mesas WHERE tenant_id=$1`, [A.tenantId])).rows[0].id;
    const pm = await call(A, 'post', '/api/pedidos', { origem: 'MESA', mesa_id: mesa, itens: [{ produto_id: cuca, quantidade: 2 }, { produto_id: picanha, quantidade: 1 }] });
    expect(pm.status).toBe(201);
    expect(Number(pm.body.total)).toBe(800 * 2 + 4500);
    expect(pm.body.tabela_preco_id).toBe(esplanada.id);
    const pb = await call(A, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: cuca, quantidade: 2 }] });
    expect(Number(pb.body.total)).toBe(1200);
    expect(pb.body.tabela_preco_id).toBeNull();
  });

  test('horário: fora da janela não se aplica; dentro aplica; prioridade decide entre duas', async () => {
    const h = Number(agoraLuanda().hora.slice(0, 2));
    const fora = (await call(A, 'post', '/api/precos/tabelas', { nome: 'Fora de horas', hora_inicio: hh(h + 2), hora_fim: hh(h + 3), prioridade: 50 })).body;
    await call(A, 'put', `/api/precos/tabelas/${fora.id}/precos`, { precos: [{ produto_id: cuca, preco: 100 }] });
    const happy = (await call(A, 'post', '/api/precos/tabelas', { nome: 'Happy hour', hora_inicio: hh(h - 1), hora_fim: hh(h + 1), prioridade: 10 })).body;
    await call(A, 'put', `/api/precos/tabelas/${happy.id}/precos`, { precos: [{ produto_id: cuca, preco: 450 }] });
    // Mesa: Happy hour (prioridade 10) ganha à Esplanada (1); Fora de horas não serve
    let a = await call(A, 'get', '/api/precos/actuais?origem=MESA');
    expect(a.body.tabela.nome).toBe('Happy hour');
    const pb = await call(A, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: cuca, quantidade: 1 }] });
    expect(Number(pb.body.total)).toBe(450);
    // desligar a Happy hour volta à Esplanada na Mesa
    expect((await call(A, 'put', `/api/precos/tabelas/${happy.id}`, { ativa: false })).status).toBe(200);
    a = await call(A, 'get', '/api/precos/actuais?origem=MESA');
    expect(a.body.tabela.nome).toBe('Esplanada');
  });

  test('portal (Remota) também usa o nível em vigor', async () => {
    const t = (await call(A, 'post', '/api/precos/tabelas', { nome: 'Pedidos QR', origens: ['REMOTA'], prioridade: 99 })).body;
    await call(A, 'put', `/api/precos/tabelas/${t.id}/precos`, { precos: [{ produto_id: picanha, preco: 4000 }] });
    const r = await request(app).post('/api/cliente/pedido-restaurante').set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug)
      .send({ itens: [{ produto_id: picanha, quantidade: 1 }], metodo_pagamento: 'CASH' });
    expect(r.status).toBe(201);
    const p = (await pool.query(`SELECT total, tabela_preco_id FROM pedidos WHERE id=$1`, [r.body.pedido_id])).rows[0];
    expect(Number(p.total)).toBe(4000);
    expect(p.tabela_preco_id).toBe(t.id);
  });

  test('preços de produtos de outro estabelecimento são recusados (404)', async () => {
    const pB = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Outro',1,'BEBIDA',true,true) RETURNING id`, [B.tenantId])).rows[0].id;
    expect((await call(A, 'put', `/api/precos/tabelas/${esplanada.id}/precos`, { precos: [{ produto_id: pB, preco: 1 }] })).status).toBe(404);
  });
});

describe('Prato do dia', () => {
  test('marca e desmarca; aparece nos produtos; outro estabelecimento → 404', async () => {
    expect((await call(A, 'put', `/api/precos/prato-do-dia/${picanha}`, { ativo: 'sim' })).status).toBe(400);
    expect((await call(A, 'put', `/api/precos/prato-do-dia/${picanha}`, { ativo: true })).body.prato_do_dia).toBe(true);
    const ps = await call(A, 'get', '/api/produtos');
    expect((Array.isArray(ps.body) ? ps.body : ps.body.data).find(p => p.id === picanha).prato_do_dia).toBe(true);
    expect((await call(B, 'put', `/api/precos/prato-do-dia/${picanha}`, { ativo: false })).status).toBe(404);
  });
});
