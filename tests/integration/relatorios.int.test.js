'use strict';
/** Integração (PostgreSQL real) — relatórios de gestão, talão Z e registo de cancelamentos. */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, OP, prodA, sessaoId, n = 1;
const ip = () => `10.10.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-rel-a' });
  B = await criarTenantFixture({ slug: 'it-rel-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Operadora Ana','op@it-rel-a.ao',$2,'Caixa','OPERADOR') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  OP = { id: op, token: gerarToken({ id: op, email: 'op@it-rel-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
  prodA = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Mufete',6000,'CHURRASCO',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
  sessaoId = (await call(A, 'post', '/api/caixa/abrir', { fundo_inicial: 1000 })).body.sessao?.id;
  if (!sessaoId) sessaoId = (await pool.query(`SELECT id FROM caixa_sessoes WHERE tenant_id=$1 AND fechada_em IS NULL`, [A.tenantId])).rows[0].id;
  // 2 vendas da operadora (uma recebida em TPA, outra em dinheiro) e 1 cancelamento com motivo
  for (const metodo of ['TPA', 'CASH']) {
    const p = await call(OP, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: prodA, quantidade: 1 }] });
    await call(OP, 'patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' });
    expect((await call(OP, 'post', '/api/caixa/receber', { pedido_ids: [p.body.id], metodo })).status).toBe(200);
  }
  const c = await call(OP, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: prodA, quantidade: 2 }] });
  expect((await call(OP, 'patch', `/api/pedidos/${c.body.id}/status`, { status: 'CANCELADO', motivo: 'Cliente desistiu' })).status).toBe(200);
}, 60000);

describe('Cancelamentos ficam registados', () => {
  test('guarda quem cancelou, quando e o motivo; motivo longo → 400', async () => {
    const r = (await pool.query(`SELECT cancelado_por, cancelado_em, motivo_cancelamento FROM pedidos WHERE tenant_id=$1 AND status='CANCELADO'`, [A.tenantId])).rows[0];
    expect(r).toMatchObject({ cancelado_por: OP.id, motivo_cancelamento: 'Cliente desistiu' });
    expect(r.cancelado_em).toBeTruthy();
    const p = await call(OP, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: prodA, quantidade: 1 }] });
    expect((await call(OP, 'patch', `/api/pedidos/${p.body.id}/status`, { status: 'CANCELADO', motivo: 'x'.repeat(201) })).status).toBe(400);
    expect((await call(OP, 'patch', `/api/pedidos/${p.body.id}/status`, { status: 'CANCELADO' })).status).toBe(200); // sem motivo continua possível
  });
});

describe('Relatório de vendas', () => {
  test('só chefia (OPERADOR → 403); datas inválidas → 400', async () => {
    expect((await call(OP, 'get', '/api/relatorios/vendas')).status).toBe(403);
    expect((await call(A, 'get', '/api/relatorios/vendas?de=2026-13-01')).status).toBe(400);
    expect((await call(A, 'get', '/api/relatorios/vendas?de=2026-02-01&ate=2026-01-01')).status).toBe(400);
    expect((await call(A, 'get', '/api/relatorios/vendas?de=2024-01-01&ate=2026-01-01')).status).toBe(400);
  });

  test('totais, formas, funcionário, produto, hora e cancelamentos do dia', async () => {
    const r = await call(A, 'get', `/api/relatorios/vendas?de=${hoje()}&ate=${hoje()}`);
    expect(r.status).toBe(200);
    expect(r.body.totais).toMatchObject({ pedidos: 2, valor: 12000, ticket_medio: 6000, cancelados: 2, por_receber: 0 });
    expect(r.body.recebido_por_forma).toEqual({ TPA: 6000, CASH: 6000 });
    expect(r.body.por_funcionario[0]).toMatchObject({ nome: 'Operadora Ana', pedidos: 2, valor: 12000, cancelamentos: 2 });
    expect(r.body.por_produto[0]).toMatchObject({ nome: 'Mufete', quantidade: 2, valor: 12000 });
    expect(r.body.por_hora.reduce((a, h) => a + h.valor, 0)).toBe(12000);
    expect(r.body.cancelamentos.map(c => c.motivo_cancelamento)).toContain('Cliente desistiu');
    expect(r.body.cancelamentos[0].cancelado_por_nome).toBe('Operadora Ana');
  });

  test('isolamento: outro estabelecimento não vê nada', async () => {
    const r = await call(B, 'get', '/api/relatorios/vendas');
    expect(r.body.totais.pedidos).toBe(0);
    expect(r.body.cancelamentos).toEqual([]);
  });
});

describe('Fecho de caixa (Z)', () => {
  test('relatório da sessão e talão em PDF; outro estabelecimento → 404', async () => {
    const z = await call(A, 'get', `/api/relatorios/caixa/${sessaoId}`);
    expect(z.status).toBe(200);
    expect(z.body.por_metodo).toEqual({ TPA: 6000, CASH: 6000 });
    expect(z.body.dinheiro_esperado).toBe(7000);
    expect(z.body.por_funcionario.find(f => f.metodo === 'CASH')).toMatchObject({ nome: 'Operadora Ana', valor: 6000 });
    const pdf = await request(app).get(`/api/relatorios/caixa/${sessaoId}/talao.pdf`).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${A.token}`)
      .buffer().parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 5).toString()).toBe('%PDF-');
    expect((await call(B, 'get', `/api/relatorios/caixa/${sessaoId}`)).status).toBe(404);
  });
});
