'use strict';
/**
 * Integração (PostgreSQL real) — portal do cliente:
 *  1. Pedidos de convidado (sem conta) chegam ao servidor e ficam no estabelecimento certo.
 *  2. Solicitações de serviços/eventos chegam ao POS, isoladas por estabelecimento.
 *  3. O estabelecimento vem SEMPRE do slug/JWT: um `tenantId` no corpo do pedido é ignorado.
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, ipN = 1, cucaA, cucaB;
const ip = () => `10.11.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const pub = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', T.slug).send(body);
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const telAleatorio = () => '92' + String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 7);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-portal-a' });
  B = await criarTenantFixture({ slug: 'it-portal-b' });
  const prod = async (T, nome, preco) => (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,'BEBIDA',true,true) RETURNING id`, [T.tenantId, nome, preco])).rows[0].id;
  cucaA = await prod(A, 'Cuca A', 600);
  cucaB = await prod(B, 'Cuca B', 700);
}, 60000);

describe('Pedido de convidado (sem conta)', () => {
  test('é gravado no estabelecimento certo, sem cliente, com a mesa indicada', async () => {
    await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade, status) VALUES ($1, '7', 4, 'LIVRE')`, [A.tenantId]);
    const r = await pub(A, 'post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cucaA, quantidade: 2 }], metodo_pagamento: 'CASH', mesa_ref: '7' });
    expect(r.status).toBe(201);
    expect(r.body.total_final).toBe(1200);
    const p = (await pool.query(`SELECT tenant_id, cliente_id, mesa_id, status, total FROM pedidos WHERE id=$1`, [r.body.pedido_id])).rows[0];
    expect(p.tenant_id).toBe(A.tenantId);
    expect(p.cliente_id).toBeNull();
    expect(p.mesa_id).not.toBeNull();
    expect(Number(p.total)).toBe(1200);
  });
  test('mesa inexistente é recusada (sem pedido gravado); a mesa aceita-se sem distinguir maiúsculas', async () => {
    const antes = Number((await pool.query(`SELECT COUNT(*) FROM pedidos WHERE tenant_id=$1`, [A.tenantId])).rows[0].count);
    const mau = await pub(A, 'post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cucaA, quantidade: 1 }], metodo_pagamento: 'CASH', mesa_ref: 'ZZ99' });
    expect(mau.status).toBe(400);
    expect(mau.body.erro).toMatch(/mesa/i);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM pedidos WHERE tenant_id=$1`, [A.tenantId])).rows[0].count)).toBe(antes);
    await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade, status) VALUES ($1, 'M03', 4, 'LIVRE')`, [A.tenantId]);
    const bom = await pub(A, 'post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cucaA, quantidade: 1 }], metodo_pagamento: 'CASH', mesa_ref: ' m03 ' });
    expect(bom.status).toBe(201);
  });
  test('convidado não pode pagar com Nuk-Coin e nada fica gravado', async () => {
    const antes = Number((await pool.query(`SELECT COUNT(*) FROM pedidos WHERE tenant_id=$1`, [A.tenantId])).rows[0].count);
    const r = await pub(A, 'post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cucaA, quantidade: 1 }], metodo_pagamento: 'NUKCOIN' });
    expect(r.status).toBe(400);
    const depois = Number((await pool.query(`SELECT COUNT(*) FROM pedidos WHERE tenant_id=$1`, [A.tenantId])).rows[0].count);
    expect(depois).toBe(antes);
  });
});

describe('Solicitações do portal (serviços e eventos)', () => {
  const corpo = (extra = {}) => ({ tipo: 'EVENTO', nome_servico: 'Casamento', nome: 'Maria Silva', telefone: '923111222', ...extra });

  test('o cliente pede e a equipa vê na caixa de entrada, com o contacto', async () => {
    const r = await pub(A, 'post', '/api/cliente/solicitacao', corpo());
    expect(r.status).toBe(201);
    expect(r.body.solicitacao.status).toBe('PENDENTE');
    const l = await op(A, 'get', '/api/solicitacoes-portal?status=PENDENTE');
    expect(l.status).toBe(200);
    const s = l.body.data.find(x => x.id === r.body.solicitacao.id);
    expect(s).toMatchObject({ tipo: 'EVENTO', nome_servico: 'Casamento', nome_contacto: 'Maria Silva', telefone_contacto: '923111222' });
    expect(l.body.total).toBeGreaterThanOrEqual(1);
    expect((await op(A, 'get', '/api/solicitacoes-portal/pendentes')).body.pendentes).toBeGreaterThanOrEqual(1);
  });
  test('valida tipo, serviço, nome e telefone', async () => {
    for (const extra of [{ tipo: 'OUTRO' }, { nome_servico: ' ' }, { nome: '' }, { telefone: '12345' }]) {
      expect((await pub(A, 'post', '/api/cliente/solicitacao', corpo(extra))).status).toBe(400);
    }
  });
  test('isolamento: o outro estabelecimento não vê nem altera', async () => {
    const r = await pub(A, 'post', '/api/cliente/solicitacao', corpo({ tipo: 'SERVICO', nome_servico: 'Sauna' }));
    const id = r.body.solicitacao.id;
    const lb = await op(B, 'get', '/api/solicitacoes-portal');
    expect(lb.body.data.find(x => x.id === id)).toBeUndefined();
    expect((await op(B, 'patch', `/api/solicitacoes-portal/${id}/status`, { status: 'CONFIRMADA' })).status).toBe(404);
  });
  test('confirmar e cancelar; estado inválido → 400; sem JWT → 401', async () => {
    const id = (await pub(A, 'post', '/api/cliente/solicitacao', corpo({ tipo: 'HOSPEDAGEM', nome_servico: 'Pernoite' }))).body.solicitacao.id;
    const ok = await op(A, 'patch', `/api/solicitacoes-portal/${id}/status`, { status: 'CONFIRMADA' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CONFIRMADA');
    expect((await op(A, 'patch', `/api/solicitacoes-portal/${id}/status`, { status: 'XPTO' })).status).toBe(400);
    expect((await request(app).get('/api/solicitacoes-portal').set('X-Forwarded-For', ip())).status).toBe(401);
  });
  test('um tenantId no corpo é ignorado: a solicitação fica no estabelecimento do slug', async () => {
    const r = await pub(A, 'post', '/api/cliente/solicitacao', corpo({ tenantId: B.tenantId }));
    expect(r.status).toBe(201);
    const t = (await pool.query(`SELECT tenant_id FROM solicitacoes_portal WHERE id=$1`, [r.body.solicitacao.id])).rows[0].tenant_id;
    expect(t).toBe(A.tenantId);
  });
});

describe('O estabelecimento nunca vem do corpo do pedido', () => {
  let cliente;
  beforeAll(async () => {
    const tel = telAleatorio();
    const r = await pub(A, 'post', '/api/cliente/cadastrar', { nome: 'Cliente Isolado', telefone: tel, pin: '4321', provincia: 'Luanda' });
    expect(r.status).toBe(201);
    cliente = { ...r.body.cliente, telefone: tel, pin: '4321' };
  });
  test('login no estabelecimento B com "tenantId": null não encontra clientes do A', async () => {
    const r = await pub(B, 'post', '/api/cliente/login', { telefone: cliente.telefone, pin: cliente.pin, tenantId: null });
    expect(r.status).toBe(401);
  });
  test('login no estabelecimento B com o tenantId do A no corpo também falha', async () => {
    const r = await pub(B, 'post', '/api/cliente/login', { telefone: cliente.telefone, pin: cliente.pin, tenantId: A.tenantId });
    expect(r.status).toBe(401);
  });
  test('pedido no estabelecimento B não consegue encomendar produtos do A', async () => {
    const r = await pub(B, 'post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cucaA, quantidade: 1 }], metodo_pagamento: 'CASH', tenantId: null });
    expect(r.status).toBe(400);
    const r2 = await pub(B, 'post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cucaA, quantidade: 1 }], metodo_pagamento: 'CASH', tenantId: A.tenantId });
    expect(r2.status).toBe(400);
  });
  test('cadastro no B com "tenantId": null não cria o cliente sem estabelecimento', async () => {
    const tel = telAleatorio();
    const r = await pub(B, 'post', '/api/cliente/cadastrar', { nome: 'Novo B', telefone: tel, pin: '1111', provincia: 'Luanda', tenantId: null });
    expect(r.status).toBe(201);
    const t = (await pool.query(`SELECT tenant_id FROM clientes WHERE telefone=$1`, [tel])).rows[0].tenant_id;
    expect(t).toBe(B.tenantId);
  });
});
