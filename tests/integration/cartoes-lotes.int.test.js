'use strict';
/**
 * Integração — cartões de consumo pré-impressos por lotes: o lote cria códigos sem saldo; o cartão só vale depois de
 * vendido no caixa, que cobra o valor impresso sem desconto.
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, OP, ipN = 1, cuca;
const ip = () => `10.67.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].v);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-lotes' });
  B = await criarTenantFixture({ slug: 'it-lotes-b' });
  OP = await criarTenantFixture({ slug: 'it-lotes-op', nivel: 'OPERADOR' });
  cuca = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',600,'BEBIDA',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
}, 60000);

describe('Lotes de cartões pré-impressos', () => {
  let lote, codigos;

  test('validação e permissões: só a chefia gera lotes; valor e quantidade dentro dos limites', async () => {
    expect((await op(OP, 'post', '/api/caixa/cartoes/lotes', { valor: 3000, quantidade: 5 })).status).toBe(403);
    expect((await op(OP, 'get', '/api/caixa/cartoes/lotes')).status).toBe(403);
    expect((await a('post', '/api/caixa/cartoes/lotes', { valor: 500, quantidade: 5 })).status).toBe(400);
    expect((await a('post', '/api/caixa/cartoes/lotes', { valor: 3000, quantidade: 0 })).status).toBe(400);
    expect((await a('post', '/api/caixa/cartoes/lotes', { valor: 3000, quantidade: 201 })).status).toBe(400);
    expect((await a('post', '/api/caixa/cartoes/lotes', { valor: 3000.5, quantidade: 5 })).status).toBe(400);
  });

  test('gera o lote com o caixa fechado: códigos únicos, por vender e sem saldo; numeração por estabelecimento', async () => {
    const r = await a('post', '/api/caixa/cartoes/lotes', { valor: 3000, quantidade: 12 });
    expect(r.status).toBe(201);
    lote = r.body;
    expect(lote).toMatchObject({ numero: 1, quantidade: 12, vendidos: 0, por_vender: 12 });
    const c = await pool.query(`SELECT codigo, saldo, estado, valor_inicial FROM cartoes_consumo WHERE lote_id = $1`, [lote.id]);
    codigos = c.rows.map(x => x.codigo);
    expect(new Set(codigos).size).toBe(12);
    codigos.forEach(x => expect(x).toMatch(/^CC[A-Z2-9]{8}$/));
    expect(c.rows.every(x => x.estado === 'POR_VENDER' && Number(x.saldo) === 0 && Number(x.valor_inicial) === 3000)).toBe(true);
    expect((await a('post', '/api/caixa/cartoes/lotes', { valor: 5000, quantidade: 1 })).body.numero).toBe(2);
    expect((await op(B, 'post', '/api/caixa/cartoes/lotes', { valor: 2000, quantidade: 1 })).body.numero).toBe(1);
    // os cartões por vender não aparecem na lista de vendidos
    expect((await a('get', '/api/caixa/cartoes')).body.some(x => codigos.includes(x.codigo))).toBe(false);
  });

  test('folha para imprimir em PDF; outro estabelecimento não a vê', async () => {
    const r = await a('get', `/api/caixa/cartoes/lotes/${lote.id}/pdf`).buffer(true).parse((res, cb) => { const b = []; res.on('data', d => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.body.slice(0, 5).toString()).toBe('%PDF-');
    expect((await op(B, 'get', `/api/caixa/cartoes/lotes/${lote.id}/pdf`)).status).toBe(404);
    expect((await a('get', '/api/caixa/cartoes/lotes/nao-e-uuid/pdf')).status).toBe(400);
    const det = await a('get', `/api/caixa/cartoes/lotes/${lote.id}`);
    expect(det.status).toBe(200);
    expect(det.body.cartoes.map(x => x.codigo).sort()).toEqual([...codigos].sort());
    expect((await op(B, 'get', `/api/caixa/cartoes/lotes/${lote.id}`)).status).toBe(404);
    expect((await op(OP, 'get', `/api/caixa/cartoes/lotes/${lote.id}`)).status).toBe(403);
  });

  test('cartão por vender não paga nada; com o caixa fechado também não se vende', async () => {
    expect((await a('post', `/api/caixa/cartoes/${codigos[0]}/vender`, { metodo: 'CASH' })).body.codigo).toBe('CAIXA_FECHADO');
    expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
    const p = await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: cuca, quantidade: 1 }] });
    expect((await a('patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' })).status).toBe(200);
    const r = await a('post', '/api/caixa/receber', { pedido_ids: [p.body.id], metodo: 'CARTAO', codigo_cartao: codigos[0] });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('CARTAO_POR_VENDER');
  });

  test('vender o cartão impresso cobra o valor impresso sem desconto, activa o saldo e não se vende duas vezes', async () => {
    const r = await a('post', `/api/caixa/cartoes/${codigos[1].toLowerCase()}/vender`, { metodo: 'TPA' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ codigo: codigos[1], estado: 'ACTIVO' });
    expect(Number(r.body.saldo)).toBe(3000);
    expect(await num(`SELECT valor AS v FROM caixa_movimentos WHERE cartao_id = $1 AND tipo = 'CARTAO_VENDA' AND metodo = 'TPA'`, [r.body.id])).toBe(3000);
    expect(await num(`SELECT COUNT(*) AS v FROM movimentos_cartao WHERE cartao_id = $1 AND tipo = 'VENDA'`, [r.body.id])).toBe(1);
    const de2 = await a('post', `/api/caixa/cartoes/${codigos[1]}/vender`, { metodo: 'CASH' });
    expect(de2.status).toBe(409);
    expect(de2.body.codigo).toBe('CARTAO_JA_VENDIDO');
    expect((await a('post', '/api/caixa/cartoes/CCZZZZZZZZ/vender', { metodo: 'CASH' })).status).toBe(404);
    expect((await a('post', '/api/caixa/cartoes/XYZ/vender', { metodo: 'CASH' })).status).toBe(400);
    expect((await op(B, 'post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
    expect((await op(B, 'post', `/api/caixa/cartoes/${codigos[2]}/vender`, { metodo: 'CASH' })).status).toBe(404); // de outro estabelecimento
    // agora paga e o saldo desce
    const p = await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: cuca, quantidade: 2 }] });
    expect((await a('patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' })).status).toBe(200);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p.body.id], metodo: 'CARTAO', codigo_cartao: codigos[1] })).status).toBe(200);
    expect(await num(`SELECT saldo AS v FROM cartoes_consumo WHERE codigo = $1`, [codigos[1]])).toBe(1800);
    const c = await a('get', `/api/caixa/cartoes/${codigos[1]}`);
    expect(c.body).toMatchObject({ estado: 'ACTIVO', lote_numero: 1 });
  });

  test('a lista de lotes conta vendidos e por vender; o cartão gerado na hora continua a funcionar', async () => {
    const l = (await a('get', '/api/caixa/cartoes/lotes')).body.find(x => x.id === lote.id);
    expect(l).toMatchObject({ quantidade: 12, vendidos: 1, por_vender: 11 });
    const v = await a('post', '/api/caixa/cartoes', { valor: 3000, metodo: 'CASH' });
    expect(v.status).toBe(201);
    expect(Number(v.body.saldo)).toBe(3000);
    expect(await num(`SELECT valor AS v FROM caixa_movimentos WHERE cartao_id = $1`, [v.body.id])).toBe(3000);
    expect((await a('get', '/api/caixa/cartoes')).body[0].codigo).toBe(v.body.codigo);
  });

  test('duas vendas simultâneas do mesmo cartão: só uma passa', async () => {
    const [r1, r2] = await Promise.all([
      a('post', `/api/caixa/cartoes/${codigos[3]}/vender`, { metodo: 'CASH' }),
      a('post', `/api/caixa/cartoes/${codigos[3]}/vender`, { metodo: 'CASH' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await num(`SELECT COUNT(*) AS v FROM caixa_movimentos m JOIN cartoes_consumo c ON c.id = m.cartao_id WHERE c.codigo = $1`, [codigos[3]])).toBe(1);
  });
});
