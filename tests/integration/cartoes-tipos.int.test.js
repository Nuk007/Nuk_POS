'use strict';
/** Integração — cartões configurados (botões do Caixa) e venda de vários cartões impressos pelos códigos. */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, OP, ipN = 1;
const ip = () => `10.69.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].v);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-ctipos' });
  B = await criarTenantFixture({ slug: 'it-ctipos-b' });
  OP = await criarTenantFixture({ slug: 'it-ctipos-op', nivel: 'OPERADOR' });
}, 60000);

describe('Cartões configurados', () => {
  test('a 1.ª leitura semeia os valores do dono; contagem de impressos por vender por valor', async () => {
    const r = await a('get', '/api/caixa/cartoes/tipos');
    expect(r.status).toBe(200);
    expect(r.body.map(t => Number(t.valor))).toEqual([2000, 3000, 5000, 6000, 12000, 15000, 20000, 25000]);
    expect(r.body.every(t => t.por_vender === 0 && t.ativo)).toBe(true);
    await a('post', '/api/caixa/cartoes/lotes', { valor: 3000, quantidade: 7 });
    const r2 = await a('get', '/api/caixa/cartoes/tipos');
    expect(r2.body.find(t => Number(t.valor) === 3000).por_vender).toBe(7);
    // isolamento: o outro estabelecimento tem os seus
    expect((await op(B, 'get', '/api/caixa/cartoes/tipos')).body.every(t => t.por_vender === 0)).toBe(true);
  });

  test('só o ADMIN cria e muda; valor válido e único; desactivar esconde do Caixa mas não apaga', async () => {
    expect((await op(OP, 'post', '/api/caixa/cartoes/tipos', { valor: 4000 })).status).toBe(403);
    expect((await a('post', '/api/caixa/cartoes/tipos', { valor: 500 })).status).toBe(400);
    expect((await a('post', '/api/caixa/cartoes/tipos', { valor: 3000 })).status).toBe(409);
    const c = await a('post', '/api/caixa/cartoes/tipos', { valor: 4000, nome: '  Cartão piscina ' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ nome: 'Cartão piscina', ativo: true });
    expect((await op(B, 'put', `/api/caixa/cartoes/tipos/${c.body.id}`, { ativo: false })).status).toBe(404);
    expect((await a('put', `/api/caixa/cartoes/tipos/${c.body.id}`, { ativo: 'nao' })).status).toBe(400);
    expect((await a('put', `/api/caixa/cartoes/tipos/${c.body.id}`, {})).status).toBe(400);
    expect((await a('put', `/api/caixa/cartoes/tipos/${c.body.id}`, { ativo: false })).body.ativo).toBe(false);
    expect((await a('get', '/api/caixa/cartoes/tipos')).body.some(t => t.id === c.body.id)).toBe(false);
    expect((await a('get', '/api/caixa/cartoes/tipos?todos=1')).body.find(t => t.id === c.body.id)).toMatchObject({ ativo: false });
  });
});

describe('Venda de vários cartões impressos pelos códigos', () => {
  let codigos, de5000;
  beforeAll(async () => {
    const lotes = (await a('get', '/api/caixa/cartoes/lotes')).body;
    codigos = (await a('get', `/api/caixa/cartoes/lotes/${lotes.find(l => Number(l.valor) === 3000).id}`)).body.cartoes.map(c => c.codigo);
    const l5 = (await a('post', '/api/caixa/cartoes/lotes', { valor: 5000, quantidade: 1 })).body;
    de5000 = (await a('get', `/api/caixa/cartoes/lotes/${l5.id}`)).body.cartoes[0].codigo;
  });

  test('validações: caixa fechado, lista vazia, a mais, códigos inválidos ou repetidos', async () => {
    expect((await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: codigos.slice(0, 2) })).body.codigo).toBe('CAIXA_FECHADO');
    expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
    expect((await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: [] })).status).toBe(400);
    expect((await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: Array(51).fill(codigos[0]) })).status).toBe(400);
    expect((await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: ['XX'] })).status).toBe(400);
    const rep = await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: [codigos[0], codigos[0].toLowerCase()] });
    expect(rep.status).toBe(400);
    expect(rep.body.erro).toContain('repetido');
    expect((await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'OURO', codigos: [codigos[0]] })).status).toBe(400);
  });

  test('tudo ou nada: um código de outro valor, desconhecido ou de outro estabelecimento não vende nenhum', async () => {
    const outro = await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: [codigos[0], de5000] });
    expect(outro.status).toBe(409);
    expect(outro.body).toMatchObject({ codigo: 'CARTAO_OUTRO_VALOR', codigos: [de5000] });
    const desconhecido = await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: [codigos[0], 'CCZZZZZZZZ'] });
    expect(desconhecido.status).toBe(404);
    expect(desconhecido.body.erro).toContain('CCZZZZZZZZ');
    expect((await op(B, 'post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
    expect((await op(B, 'post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: [codigos[0]] })).status).toBe(404);
    expect(await num(`SELECT COUNT(*) AS v FROM cartoes_consumo WHERE codigo = ANY($1) AND estado = 'ACTIVO'`, [codigos])).toBe(0);
    expect(await num(`SELECT COUNT(*) AS v FROM caixa_movimentos WHERE tenant_id = $1`, [A.tenantId])).toBe(0);
  });

  test('vende 3 cartões: cada um com o valor impresso de saldo, um movimento numerado por cartão, total 9 000 Kz', async () => {
    const r = await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'TPA', codigos: codigos.slice(0, 3).map(c => c.toLowerCase()) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ quantidade: 3, total: 9000, metodo: 'TPA' });
    expect(r.body.cartoes.map(c => c.codigo)).toEqual(codigos.slice(0, 3));
    expect(r.body.cartoes.every(c => Number(c.saldo) === 3000 && c.estado === 'ACTIVO')).toBe(true);
    const m = (await pool.query(`SELECT numero, valor, metodo FROM caixa_movimentos WHERE tenant_id = $1 ORDER BY numero`, [A.tenantId])).rows;
    expect(m.map(x => [Number(x.numero), Number(x.valor), x.metodo])).toEqual([[1, 3000, 'TPA'], [2, 3000, 'TPA'], [3, 3000, 'TPA']]);
    expect((await a('get', '/api/caixa/cartoes/tipos')).body.find(t => Number(t.valor) === 3000).por_vender).toBe(4);
    const de2 = await a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: [codigos[3], codigos[1]] });
    expect(de2.status).toBe(409);
    expect(de2.body).toMatchObject({ codigo: 'CARTAO_JA_VENDIDO', codigos: [codigos[1]] });
    expect((await a('get', `/api/caixa/cartoes/${codigos[3]}`)).body.estado).toBe('POR_VENDER'); // nada vendido
    expect((await a('get', '/api/caixa/auditoria/verificar')).body.ok).toBe(true);
  });

  test('duas vendas simultâneas com um cartão em comum: só uma passa', async () => {
    const [r1, r2] = await Promise.all([
      a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: [codigos[3], codigos[4]] }),
      a('post', '/api/caixa/cartoes/vender', { valor: 3000, metodo: 'CASH', codigos: [codigos[4], codigos[5]] }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await num(`SELECT COUNT(*) AS v FROM caixa_movimentos m JOIN cartoes_consumo c ON c.id = m.cartao_id WHERE c.codigo = $1`, [codigos[4]])).toBe(1);
  });
});
