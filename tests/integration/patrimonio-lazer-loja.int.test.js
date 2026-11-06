'use strict';
/** Integração — Património (bens, depreciação, abate) e vendas de Lazer e Loja. */
const request = require('supertest');
const { app } = require('../../server/app');
const { valorActual } = require('../../server/services/patrimonio.service');

let A, B, ipN = 1, bem, cuca, bilhar, camisa, maco;
const ip = () => `10.99.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const anosAtras = n => { const d = new Date(Date.now() + 3600000); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-pat' });
  B = await criarTenantFixture({ slug: 'it-pat-b' });
  const ins = async (nome, preco, cat) => (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat])).rows[0].id;
  cuca = await ins('Cuca', 600, 'BEBIDA'); bilhar = await ins('Bilhar 1h', 2000, 'LAZER'); camisa = await ins('Camisa', 8000, 'LOJA'); maco = await ins('Maço', 1500, 'CIGARROS');
  await pool.query(`INSERT INTO listas_opcoes (tenant_id, lista, valor, ordem) VALUES ($1,'CATEGORIA_PRODUTO','LAZER',99) ON CONFLICT DO NOTHING`, [A.tenantId]);
});

describe('Depreciação (função pura)', () => {
  test('linear até zero; abatido vale 0; data de hoje não deprecia', () => {
    const b = { valor_aquisicao: 1000, data_aquisicao: '2020-01-01', vida_util_anos: 10, estado: 'BOM' };
    expect(valorActual(b, '2025-01-01')).toBeCloseTo(500, 0);
    expect(valorActual(b, '2040-01-01')).toBe(0);
    expect(valorActual(b, '2020-01-01')).toBe(1000);
    expect(valorActual({ ...b, estado: 'ABATIDO' }, '2021-01-01')).toBe(0);
  });
});

describe('Património', () => {
  test('regista com código automático, valida e isola por estabelecimento', async () => {
    const ok = { nome: 'Gerador 20kVA', categoria: 'EQUIPAMENTO', localizacao: 'Casa das máquinas', data_aquisicao: anosAtras(5), valor_aquisicao: 1000000, vida_util_anos: 10 };
    expect((await a('post', '/api/patrimonio', { ...ok, nome: ' ' })).status).toBe(400);
    expect((await a('post', '/api/patrimonio', { ...ok, categoria: 'NAOEXISTE' })).status).toBe(400);
    expect((await a('post', '/api/patrimonio', { ...ok, vida_util_anos: 0 })).status).toBe(400);
    expect((await a('post', '/api/patrimonio', { ...ok, valor_aquisicao: -1 })).status).toBe(400);
    expect((await a('post', '/api/patrimonio', { ...ok, data_aquisicao: '2999-01-01' })).status).toBe(400);
    const r = await a('post', '/api/patrimonio', ok);
    expect(r.status).toBe(201); bem = r.body;
    expect(bem.codigo).toBe('PAT-0001');
    expect(bem.valor_actual).toBeGreaterThan(490000); expect(bem.valor_actual).toBeLessThan(510000);
    expect((await a('post', '/api/patrimonio', { ...ok, nome: 'Mesa' })).body.codigo).toBe('PAT-0002');
    expect((await op(B, 'post', '/api/patrimonio', ok)).body.codigo).toBe('PAT-0001'); // sequência por estabelecimento
    expect((await op(B, 'get', '/api/patrimonio')).body).toHaveLength(1);
    expect((await op(B, 'patch', `/api/patrimonio/${bem.id}`, { nome: 'roubado' })).status).toBe(404);
  });
  test('corrige dados; estado só Bom/Regular/Mau; resumo soma os activos', async () => {
    expect((await a('patch', `/api/patrimonio/${bem.id}`, { estado: 'ABATIDO' })).status).toBe(400);
    expect((await a('patch', `/api/patrimonio/${bem.id}`, {})).status).toBe(400);
    const r = await a('patch', `/api/patrimonio/${bem.id}`, { estado: 'MAU', localizacao: 'Armazém' });
    expect(r.status).toBe(200); expect(r.body.estado).toBe('MAU');
    const s = (await a('get', '/api/patrimonio/resumo')).body;
    expect(s).toMatchObject({ bens: 2, em_mau_estado: 1, valor_aquisicao: 2000000 });
    expect(s.por_categoria.EQUIPAMENTO.bens).toBe(2);
  });
  test('abater exige motivo, é definitivo e tira o bem do resumo', async () => {
    expect((await a('post', `/api/patrimonio/${bem.id}/abater`, {})).status).toBe(400);
    expect((await op(B, 'post', `/api/patrimonio/${bem.id}/abater`, { motivo: 'x' })).status).toBe(404);
    const r = await a('post', `/api/patrimonio/${bem.id}/abater`, { motivo: 'Avariado sem reparação' });
    expect(r.status).toBe(200); expect(r.body.estado).toBe('ABATIDO'); expect(r.body.valor_actual).toBe(0);
    expect((await a('post', `/api/patrimonio/${bem.id}/abater`, { motivo: 'outra vez' })).status).toBe(404);
    expect((await a('patch', `/api/patrimonio/${bem.id}`, { nome: 'x' })).status).toBe(404);
    expect((await a('get', '/api/patrimonio/resumo')).body.bens).toBe(1);
    expect((await a('get', '/api/patrimonio?estado=ABATIDO')).body).toHaveLength(1);
    expect((await a('get', '/api/patrimonio?estado=ACTIVOS')).body).toHaveLength(1);
  });
});

describe('Lazer e Loja', () => {
  test('Lazer só vende produtos de lazer; a venda nasce FECHADA e aguarda recebimento', async () => {
    expect((await a('post', '/api/pedidos', { origem: 'LAZER', itens: [{ produto_id: cuca, quantidade: 1 }] })).status).toBe(400);
    const r = await a('post', '/api/pedidos', { origem: 'LAZER', itens: [{ produto_id: bilhar, quantidade: 2 }] });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('FECHADO'); expect(r.body.origem).toBe('LAZER'); expect(Number(r.body.total)).toBe(4000);
    await a('post', '/api/caixa/abrir', { fundo_inicial: 0 });
    const por = (await a('get', '/api/caixa/por-receber')).body;
    expect(por.map(p => p.id)).toContain(r.body.id);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [r.body.id], metodo: 'CASH', valor_entregue: 5000 })).body).toMatchObject({ total: 4000, troco: 1000 });
  });
  test('Loja vende loja e cigarros, não bebidas nem lazer', async () => {
    expect((await a('post', '/api/pedidos', { origem: 'LOJA', itens: [{ produto_id: camisa, quantidade: 1 }, { produto_id: maco, quantidade: 2 }] })).status).toBe(201);
    expect((await a('post', '/api/pedidos', { origem: 'LOJA', itens: [{ produto_id: cuca, quantidade: 1 }] })).status).toBe(400);
    expect((await a('post', '/api/pedidos', { origem: 'LOJA', itens: [{ produto_id: bilhar, quantidade: 1 }] })).status).toBe(400);
  });
  test('Balcão continua a nascer ABERTO (cozinha) e a origem inválida é recusada', async () => {
    const r = await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: cuca, quantidade: 1 }] });
    expect(r.body.status).toBe('ABERTO');
    expect((await a('post', '/api/pedidos', { origem: 'SPA', itens: [{ produto_id: cuca, quantidade: 1 }] })).status).toBe(400);
  });
});
