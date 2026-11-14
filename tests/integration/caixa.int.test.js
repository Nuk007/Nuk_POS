'use strict';
/** Integração — Caixa do dia: abrir/fechar, Nuk-Coin, cartões de consumo e recebimento de pedidos fechados. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, ipN = 1, cuca, picanha;
const ip = () => `10.66.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const pub = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug).send(body);
const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].v);
async function novoCliente(sufixo) {
  const tel = '94' + String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 7);
  const r = await pub('post', '/api/cliente/cadastrar', { nome: 'Cx ' + sufixo, telefone: tel, pin: '1234', provincia: 'Luanda' });
  expect(r.status).toBe(201);
  return { ...r.body.cliente, pin: '1234' };
}
/** pedido de balcão já fechado, pronto a receber */
async function pedidoFechado(itens) {
  const p = await a('post', '/api/pedidos', { origem: 'BALCAO', itens });
  expect(p.status).toBe(201);
  expect((await a('patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' })).status).toBe(200);
  return p.body;
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-caixa' });
  B = await criarTenantFixture({ slug: 'it-caixa-b' });
  const ins = async (nome, preco, cat) => (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat])).rows[0].id;
  cuca = await ins('Cuca', 600, 'BEBIDA'); picanha = await ins('Picanha', 4500, 'CHURRASCO');
}, 60000);

describe('Caixa fechado: nada que mexa em dinheiro funciona', () => {
  test('carregar, vender cartão e receber → 409 CAIXA_FECHADO', async () => {
    const c = await novoCliente('fechado');
    const r1 = await a('post', '/api/caixa/nukcoin', { cliente_id: c.id, valor: 5000 });
    expect(r1.status).toBe(409); expect(r1.body.codigo).toBe('CAIXA_FECHADO');
    expect(await num(`SELECT nukcoin_saldo AS v FROM clientes WHERE id=$1`, [c.id])).toBe(0); // nada foi carregado
    expect((await a('post', '/api/caixa/cartoes', { valor: 5000 })).status).toBe(409);
    const p = await pedidoFechado([{ produto_id: cuca, quantidade: 1 }]);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CASH' })).status).toBe(409);
  });
});

describe('Abrir, receber e fechar', () => {
  test('abre com fundo; segunda abertura → 409; estado mostra o resumo', async () => {
    const r = await a('post', '/api/caixa/abrir', { fundo_inicial: 10000 });
    expect(r.status).toBe(201);
    expect((await a('post', '/api/caixa/abrir', {})).status).toBe(409);
    const e = (await a('get', '/api/caixa')).body;
    expect(e.aberta).toBe(true); expect(e.resumo.dinheiro_esperado).toBe(10000);
  });
  test('Nuk-Coin: carrega, regista no caixa na forma escolhida; valor ou método inválido recusados', async () => {
    const c = await novoCliente('coin');
    expect((await a('post', '/api/caixa/nukcoin', { cliente_id: c.id, valor: 7777 })).status).toBe(400);
    expect((await a('post', '/api/caixa/nukcoin', { cliente_id: c.id, valor: 5000, metodo: 'NUKCOIN' })).status).toBe(400);
    expect((await a('post', '/api/caixa/nukcoin', { cliente_id: c.id, valor: 20000, metodo: 'TPA' })).body.saldo_atual).toBe(20000);
    expect((await a('post', '/api/caixa/nukcoin', { cliente_id: c.id, valor: 5000 })).status).toBe(200); // dinheiro por omissão
    const e = (await a('get', '/api/caixa')).body.resumo;
    expect(e.por_metodo.TPA).toBe(20000); expect(e.por_metodo.CASH).toBe(5000);
    expect(e.dinheiro_esperado).toBe(15000); // fundo 10000 + 5000 em dinheiro; o TPA não entra na gaveta
  });
  test('cartão de consumo: vende com código, paga um pedido e o saldo desce; saldo insuficiente recusado', async () => {
    expect((await a('post', '/api/caixa/cartoes', { valor: 500 })).status).toBe(400);
    const v = await a('post', '/api/caixa/cartoes', { valor: 6000, metodo: 'CASH' });
    expect(v.status).toBe(201); expect(v.body.codigo).toMatch(/^CC[A-Z2-9]{8}$/); expect(Number(v.body.saldo)).toBe(6000);
    const p1 = await pedidoFechado([{ produto_id: picanha, quantidade: 1 }]); // 4500
    const r = await a('post', '/api/caixa/receber', { pedido_ids: [p1.id], metodo: 'CARTAO', codigo_cartao: v.body.codigo.toLowerCase() });
    expect(r.status).toBe(200); expect(r.body.saldo_restante).toBe(1500);
    const p2 = await pedidoFechado([{ produto_id: picanha, quantidade: 1 }]);
    const nega = await a('post', '/api/caixa/receber', { pedido_ids: [p2.id], metodo: 'CARTAO', codigo_cartao: v.body.codigo });
    expect(nega.status).toBe(400); expect(nega.body.saldo_atual).toBe(1500);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p2.id], metodo: 'CARTAO', codigo_cartao: 'CCXXXXXXXX' })).status).toBe(404);
    expect((await op(B, 'get', `/api/caixa/cartoes/${v.body.codigo}`)).status).toBe(404); // outro estabelecimento não vê o cartão
    expect(await num(`SELECT saldo AS v FROM cartoes_consumo WHERE id=$1`, [v.body.id])).toBe(1500);
    expect(await num(`SELECT COUNT(*) AS v FROM movimentos_cartao WHERE cartao_id=$1`, [v.body.id])).toBe(2); // VENDA + CONSUMO
  });
  test('receber: só pedidos fechados; dinheiro com troco; nunca duas vezes; some da lista por receber', async () => {
    const aberto = await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: cuca, quantidade: 1 }] });
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [aberto.body.id], metodo: 'CASH' })).status).toBe(409);
    const p = await pedidoFechado([{ produto_id: cuca, quantidade: 2 }]); // 1200
    expect((await a('get', '/api/caixa/por-receber')).body.map(x => x.id)).toContain(p.id);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CASH', valor_entregue: 1000 })).status).toBe(400);
    const r = await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CASH', valor_entregue: 2000 });
    expect(r.body).toMatchObject({ total: 1200, troco: 800, pedidos: 1 });
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CASH' })).status).toBe(409);
    expect((await a('get', '/api/caixa/por-receber')).body.map(x => x.id)).not.toContain(p.id);
    expect((await op(B, 'post', '/api/caixa/receber', { pedido_ids: [aberto.body.id], metodo: 'CASH' })).status).toBe(409); // B tem o caixa fechado
  });
  test('receber com Nuk-Coin exige PIN (403, nunca 401) e debita; duas mesas de uma vez', async () => {
    const c = await novoCliente('paga');
    await a('post', '/api/caixa/nukcoin', { cliente_id: c.id, valor: 5000, metodo: 'CASH' });
    const mk = async () => { const p = await a('post', '/api/pedidos', { origem: 'TAKEAWAY', cliente_id: c.id, itens: [{ produto_id: cuca, quantidade: 1 }] }); return p; };
    // o take away exige uso anterior: o primeiro fecho dá-lho
    const ant = await pool.query(`INSERT INTO pedidos (tenant_id, cliente_id, status, total, origem, validado_em) VALUES ($1,$2,'FECHADO',0,'BALCAO',NOW()) RETURNING id`, [A.tenantId, c.id]);
    const p1 = await mk(); const p2 = await mk();
    expect(p1.status).toBe(201);
    for (const p of [p1, p2]) await a('patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' });
    const ids = [p1.body.id, p2.body.id];
    expect((await a('post', '/api/caixa/receber', { pedido_ids: ids, metodo: 'NUKCOIN' })).status).toBe(403);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: ids, metodo: 'NUKCOIN', pin: '9999' })).status).toBe(403);
    expect(await num(`SELECT nukcoin_saldo AS v FROM clientes WHERE id=$1`, [c.id])).toBe(5000);
    const r = await a('post', '/api/caixa/receber', { pedido_ids: ids, metodo: 'NUKCOIN', pin: c.pin });
    expect(r.body).toMatchObject({ total: 1200, saldo_restante: 3800 });
    expect(await num(`SELECT nukcoin_saldo AS v FROM clientes WHERE id=$1`, [c.id])).toBe(3800);
    expect(await num(`SELECT SUM(valor) AS v FROM movimentos_nukcoin WHERE cliente_id=$1 AND tipo='CONSUMO'`, [c.id])).toBe(1200);
    expect(ant.rows).toHaveLength(1);
  });
  test('pedido remoto pago com Nuk-Coin já nasce pago (não aparece por receber)', async () => {
    const c = await novoCliente('remoto-coin');
    await a('post', '/api/caixa/nukcoin', { cliente_id: c.id, valor: 5000 });
    const p = await pub('post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: cuca, quantidade: 1 }], cliente_id: c.id, metodo_pagamento: 'NUKCOIN', pin: c.pin });
    expect(p.status).toBe(201);
    await a('patch', `/api/pedidos/${p.body.pedido_id}/status`, { status: 'FECHADO' });
    expect((await a('get', '/api/caixa/por-receber')).body.map(x => x.id)).not.toContain(p.body.pedido_id);
  });
  test('pagamento misto: dinheiro + TPA com troco da parte em dinheiro; esperado só conta o dinheiro', async () => {
    const p1 = await pedidoFechado([{ produto_id: picanha, quantidade: 1 }]); // 4500
    const p2 = await pedidoFechado([{ produto_id: cuca, quantidade: 2 }]);    // 1200
    const ids = [p1.id, p2.id];
    const antes = (await a('get', '/api/caixa')).body.resumo.dinheiro_esperado;
    // soma errada, forma repetida, valor nulo e forma inválida → 400 e nada gravado
    expect((await a('post', '/api/caixa/receber', { pedido_ids: ids, pagamentos: [{ metodo: 'CASH', valor: 1000 }, { metodo: 'TPA', valor: 1000 }] })).status).toBe(400);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: ids, pagamentos: [{ metodo: 'CASH', valor: 2700 }, { metodo: 'CASH', valor: 3000 }] })).status).toBe(400);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: ids, pagamentos: [{ metodo: 'CASH', valor: 0 }, { metodo: 'TPA', valor: 5700 }] })).status).toBe(400);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: ids, pagamentos: [{ metodo: 'CHEQUE', valor: 5700 }] })).status).toBe(400);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: ids, pagamentos: [{ metodo: 'CASH', valor: 2000, valor_entregue: 1500 }, { metodo: 'TPA', valor: 3700 }] })).status).toBe(400);
    expect(await num(`SELECT COUNT(*) AS v FROM caixa_movimentos WHERE pedido_id = ANY($1)`, [ids])).toBe(0);

    const r = await a('post', '/api/caixa/receber', { pedido_ids: ids, pagamentos: [{ metodo: 'CASH', valor: 2000, valor_entregue: 5000 }, { metodo: 'TPA', valor: 3700 }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 5700, metodo: 'MISTO', troco: 3000 });
    expect(r.body.pagamentos).toEqual([{ metodo: 'CASH', valor: 2000 }, { metodo: 'TPA', valor: 3700 }]);
    // livro-razão: por forma, soma certa; cada pedido recebido pelo seu total
    const porMetodo = Object.fromEntries((await pool.query(`SELECT metodo, SUM(valor)::numeric v FROM caixa_movimentos WHERE pedido_id = ANY($1) GROUP BY metodo`, [ids])).rows.map(x => [x.metodo, Number(x.v)]));
    expect(porMetodo).toEqual({ CASH: 2000, TPA: 3700 });
    for (const p of [p1, p2]) {
      expect(await num(`SELECT SUM(valor) AS v FROM caixa_movimentos WHERE pedido_id = $1`, [p.id])).toBe(Number(p.total));
      expect((await pool.query(`SELECT pago_metodo FROM pedidos WHERE id=$1`, [p.id])).rows[0].pago_metodo).toBe('MISTO');
    }
    expect((await a('get', '/api/caixa')).body.resumo.dinheiro_esperado).toBe(antes + 2000);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: ids, pagamentos: [{ metodo: 'TPA', valor: 5700 }] })).status).toBe(409);
  });

  test('pagamento misto com Nuk-Coin: PIN exigido e só a parte indicada sai do saldo', async () => {
    const c = await novoCliente('misto');
    await a('post', '/api/caixa/nukcoin', { cliente_id: c.id, valor: 5000, metodo: 'CASH' });
    const p = await pedidoFechado([{ produto_id: picanha, quantidade: 2 }]); // 9000
    const sem = await a('post', '/api/caixa/receber', { pedido_ids: [p.id], pagamentos: [{ metodo: 'NUKCOIN', valor: 5000, cliente_id: c.id }, { metodo: 'TPA', valor: 4000 }] });
    expect(sem.status).toBe(403);
    const mais = await a('post', '/api/caixa/receber', { pedido_ids: [p.id], pagamentos: [{ metodo: 'NUKCOIN', valor: 6000, cliente_id: c.id, pin: c.pin }, { metodo: 'TPA', valor: 3000 }] });
    expect(mais.status).toBe(400); // saldo insuficiente para a parte Nuk-Coin
    const r = await a('post', '/api/caixa/receber', { pedido_ids: [p.id], pagamentos: [{ metodo: 'NUKCOIN', valor: 5000, cliente_id: c.id, pin: c.pin }, { metodo: 'TPA', valor: 4000 }] });
    expect(r.status).toBe(200);
    expect(r.body.saldo_restante).toBe(0);
    expect(await num(`SELECT nukcoin_saldo AS v FROM clientes WHERE id=$1`, [c.id])).toBe(0);
    expect(await num(`SELECT nukcoin_pago AS v FROM pedidos WHERE id=$1`, [p.id])).toBe(5000);
  });

  test('fechar: calcula esperado e diferença; depois tudo recusa até novo turno; histórico guarda', async () => {
    const antes = (await a('get', '/api/caixa')).body.resumo.dinheiro_esperado;
    expect((await a('post', '/api/caixa/fechar', {})).status).toBe(400);
    const r = await a('post', '/api/caixa/fechar', { contado: antes - 500, observacoes: 'faltam 500' });
    expect(r.status).toBe(200);
    expect(Number(r.body.sessao.esperado)).toBe(antes); expect(Number(r.body.sessao.diferenca)).toBe(-500);
    expect((await a('get', '/api/caixa')).body.aberta).toBe(false);
    expect((await a('post', '/api/caixa/fechar', { contado: 1 })).status).toBe(409);
    expect((await a('post', '/api/caixa/cartoes', { valor: 5000 })).status).toBe(409);
    expect((await a('get', '/api/caixa/sessoes')).body[0].fechada_em).toBeTruthy();
    expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201); // novo turno
  });
});
