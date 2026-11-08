'use strict';
/** Integração — mesa e quarto ficam «em uso» até a conta ser paga no Caixa; cancelar só nos primeiros 5 minutos. */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../../server/app');
const vendas = require('../../server/services/quartos-vendas.service');

let A, B, vendedor, arrumador, produto, ipN = 1;
const ip = () => `10.77.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const com = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const estadoMesa = async id => (await pool.query(`SELECT status FROM mesas WHERE id=$1`, [id])).rows[0].status;
const estadoQuarto = async id => (await pool.query(`SELECT status FROM quartos WHERE id=$1`, [id])).rows[0].status;
let seq = 0;
async function pessoa(T, nivel, flags = {}) {
  const email = `cpp${++seq}@${T.slug}.ao`;
  const id = (await pool.query(
    `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, nivel_acesso, pode_vender_quartos, arruma_quartos)
     VALUES ($1,$2,$3,'x',$4,$5,$6) RETURNING id`, [T.tenantId, email, email, nivel, !!flags.vende, !!flags.arruma])).rows[0].id;
  return { token: jwt.sign({ id, email, nivel_acesso: nivel, tenantId: T.tenantId }, process.env.JWT_SECRET, { expiresIn: '1h' }), id, slug: T.slug, tenantId: T.tenantId };
}
const mesa = async (numero) => (await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,$2,4) RETURNING id`, [A.tenantId, numero])).rows[0].id;
const quarto = async (numero) => (await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,$2,'SUITE',15000,30000,45000) RETURNING id`, [A.tenantId, numero])).rows[0].id;
async function receber(pedidoIds) {
  const r = await com(A, 'post', '/api/caixa/receber', { pedido_ids: pedidoIds, metodo: 'CASH' });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-cpp-a' });
  B = await criarTenantFixture({ slug: 'it-cpp-b' });
  vendedor = await pessoa(A, 'OPERADOR', { vende: true });
  arrumador = await pessoa(A, 'OPERADOR', { arruma: true });
  await pool.query(`INSERT INTO caixa_sessoes (tenant_id, aberta_por, fundo_inicial) VALUES ($1,$2,0)`, [A.tenantId, A.userId]);
  produto = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',600,'BEBIDA',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
}, 60000);

describe('Mesa: em uso até pagar', () => {
  test('fechar não liberta; receber no Caixa liberta; não se põe LIVRE à mão com conta por pagar', async () => {
    const m = await mesa('C1');
    const p = (await com(A, 'post', '/api/pedidos', { origem: 'MESA', mesa_id: m, itens: [{ produto_id: produto, quantidade: 2 }] })).body;
    expect(await estadoMesa(m)).toBe('OCUPADA');
    await com(A, 'patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' });
    expect(await estadoMesa(m)).toBe('OCUPADA');

    const manual = await com(A, 'patch', `/api/mesas/${m}/status`, { status: 'LIVRE' });
    expect(manual.status).toBe(409);
    expect(manual.body.codigo).toBe('CONTA_POR_PAGAR');
    expect(await estadoMesa(m)).toBe('OCUPADA');

    await receber([p.id]);
    expect(await estadoMesa(m)).toBe('LIVRE');
  });
  test('duas contas na mesa: só fica livre quando as duas estão pagas', async () => {
    const m = await mesa('C2');
    const ped = async () => (await com(A, 'post', '/api/pedidos', { origem: 'MESA', mesa_id: m, itens: [{ produto_id: produto, quantidade: 1 }] })).body;
    const p1 = await ped(), p2 = await ped();
    for (const p of [p1, p2]) await com(A, 'patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' });
    await receber([p1.id]);
    expect(await estadoMesa(m)).toBe('OCUPADA');
    await receber([p2.id]);
    expect(await estadoMesa(m)).toBe('LIVRE');
  });
  test('cancelar após 5 minutos → 409 e a mesa continua em uso', async () => {
    const m = await mesa('C3');
    const p = (await com(A, 'post', '/api/pedidos', { origem: 'MESA', mesa_id: m, itens: [{ produto_id: produto, quantidade: 1 }] })).body;
    await pool.query(`UPDATE pedidos SET criado_em = NOW() - INTERVAL '5 minutes 30 seconds' WHERE id = $1`, [p.id]);
    const r = await com(A, 'patch', `/api/pedidos/${p.id}/status`, { status: 'CANCELADO' });
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/5 minutos/);
    expect(await estadoMesa(m)).toBe('OCUPADA');
  });
});

describe('Quarto: consumos por pagar mantêm o quarto em uso', () => {
  test('consumo só num quarto ocupado; arrumar com conta por pagar → POR_PAGAR; pagar → DISPONIVEL', async () => {
    const q = await quarto('C-10');
    // quarto livre: não se regista consumo
    const sem = await com(A, 'post', '/api/pedidos', { origem: 'QUARTO', quarto_id: q, itens: [{ produto_id: produto, quantidade: 1 }] });
    expect(sem.status).toBe(409);
    expect((await com(A, 'post', '/api/pedidos', { origem: 'QUARTO', itens: [{ produto_id: produto, quantidade: 1 }] })).status).toBe(400);

    await vendas.vender({ tenantId: A.tenantId, userId: vendedor.id, quartoId: q, fracao: 'DUAS_HORAS' });
    const ped = await com(A, 'post', '/api/pedidos', { origem: 'QUARTO', quarto_id: q, itens: [{ produto_id: produto, quantidade: 3 }] });
    expect(ped.status).toBe(201);
    await com(A, 'patch', `/api/pedidos/${ped.body.id}/status`, { status: 'FECHADO' });

    // sai antes da hora e é arrumado, mas há consumos por pagar
    await vendas.abrirQuarto({ tenantId: A.tenantId, userId: vendedor.id, quartoId: q });
    expect(await estadoQuarto(q)).toBe('LIMPEZA');
    const limpo = await vendas.marcarLimpo({ tenantId: A.tenantId, userId: arrumador.id, quartoId: q });
    expect(limpo.status).toBe('POR_PAGAR');
    expect(await estadoQuarto(q)).toBe('POR_PAGAR');
    await expect(vendas.vender({ tenantId: A.tenantId, userId: vendedor.id, quartoId: q, fracao: 'DUAS_HORAS' })).rejects.toMatchObject({ statusCode: 409 });

    // aparece no Caixa com o número do quarto; ao pagar fica disponível
    const lista = (await com(A, 'get', '/api/caixa/por-receber')).body;
    expect(lista.find(x => x.id === ped.body.id).quarto_numero).toBe('C-10');
    await receber([ped.body.id]);
    expect(await estadoQuarto(q)).toBe('DISPONIVEL');
  });
  test('sem consumos por pagar, arrumar deixa o quarto logo disponível', async () => {
    const q = await quarto('C-11');
    await vendas.vender({ tenantId: A.tenantId, userId: vendedor.id, quartoId: q, fracao: 'DUAS_HORAS' });
    await vendas.abrirQuarto({ tenantId: A.tenantId, userId: vendedor.id, quartoId: q });
    expect((await vendas.marcarLimpo({ tenantId: A.tenantId, userId: arrumador.id, quartoId: q })).status).toBe('DISPONIVEL');
  });
  test('cancelar o consumo nos 5 min não deixa conta por pagar; quarto de outro estabelecimento → 404', async () => {
    const q = await quarto('C-12');
    await vendas.vender({ tenantId: A.tenantId, userId: vendedor.id, quartoId: q, fracao: 'DUAS_HORAS' });
    const ped = (await com(A, 'post', '/api/pedidos', { origem: 'QUARTO', quarto_id: q, itens: [{ produto_id: produto, quantidade: 1 }] })).body;
    expect((await com(A, 'patch', `/api/pedidos/${ped.id}/status`, { status: 'CANCELADO' })).status).toBe(200);
    await vendas.abrirQuarto({ tenantId: A.tenantId, userId: vendedor.id, quartoId: q });
    expect((await vendas.marcarLimpo({ tenantId: A.tenantId, userId: arrumador.id, quartoId: q })).status).toBe('DISPONIVEL');
    expect((await com(B, 'post', '/api/pedidos', { origem: 'QUARTO', quarto_id: q, itens: [{ produto_id: produto, quantidade: 1 }] })).status).toBeGreaterThanOrEqual(400);
  });
});
