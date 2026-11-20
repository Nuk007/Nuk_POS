'use strict';
/**
 * Integração — regras do dono de 20/11/2026: o Balcão só vende as categorias configuradas (por omissão Bebida,
 * Cocktail e Piscina) e a estadia; a conta das mesas não inclui os quartos.
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, ipN = 1, P = {}, mesa, quarto;
const ip = () => `10.68.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const a = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${A.token}`).send(body);
const pub = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug).send(body);
const balcao = itens => a('post', '/api/pedidos', { origem: 'BALCAO', itens });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-balcao', balcaoTudo: false });
  await pool.query(`UPDATE funcionarios SET pode_vender_quartos = true WHERE id = $1`, [A.userId]);
  const ins = async (nome, preco, cat) => (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat])).rows[0].id;
  P.cuca = await ins('Cuca', 600, 'BEBIDA'); P.mojito = await ins('Mojito', 2500, 'COCKTAIL'); P.piscina = await ins('Entrada piscina', 3000, 'PISCINA');
  P.picanha = await ins('Picanha', 4500, 'CHURRASCO'); P.toalha = await ins('Toalha extra', 1000, 'SERVICO_QUARTO');
  mesa = (await pool.query(`INSERT INTO mesas (tenant_id, numero, capacidade) VALUES ($1,'M01',4) RETURNING id`, [A.tenantId])).rows[0].id;
  quarto = (await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, status, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,'101','SUITE','DISPONIVEL',5000,15000,25000) RETURNING id`, [A.tenantId])).rows[0].id;
  expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
}, 60000);

describe('Balcão: só as categorias configuradas', () => {
  test('por omissão: Bebida, Cocktail e Piscina vendem; comida e serviços de quarto recusados (nada gravado)', async () => {
    expect((await a('get', '/api/pedidos/balcao/categorias')).body.categorias).toEqual(['BEBIDA', 'COCKTAIL', 'PISCINA']);
    expect((await balcao([{ produto_id: P.cuca, quantidade: 1 }, { produto_id: P.mojito, quantidade: 1 }, { produto_id: P.piscina, quantidade: 2 }])).status).toBe(201);
    const antes = Number((await pool.query(`SELECT COUNT(*) AS n FROM pedidos WHERE tenant_id = $1`, [A.tenantId])).rows[0].n);
    const r = await balcao([{ produto_id: P.cuca, quantidade: 1 }, { produto_id: P.picanha, quantidade: 1 }]);
    expect(r.status).toBe(400); expect(r.body.erro).toMatch(/O Balcão só vende: Bebida, Cocktail, Piscina/);
    expect((await balcao([{ produto_id: P.toalha, quantidade: 1 }])).status).toBe(400);
    expect(Number((await pool.query(`SELECT COUNT(*) AS n FROM pedidos WHERE tenant_id = $1`, [A.tenantId])).rows[0].n)).toBe(antes);
  });
  test('o Administrador muda a lista; categoria inexistente ou lista vazia recusadas', async () => {
    expect((await a('put', '/api/configuracoes/balcao', { categorias: [] })).status).toBe(400);
    expect((await a('put', '/api/configuracoes/balcao', { categorias: ['NAO_EXISTE'] })).status).toBe(400);
    const r = await a('put', '/api/configuracoes/balcao', { categorias: ['bebida'] });
    expect(r.status).toBe(200); expect(r.body.categorias).toEqual(['BEBIDA']);
    expect((await balcao([{ produto_id: P.piscina, quantidade: 1 }])).status).toBe(400);
    expect((await balcao([{ produto_id: P.cuca, quantidade: 1 }])).status).toBe(201);
    expect((await a('put', '/api/configuracoes/balcao', { categorias: ['BEBIDA', 'COCKTAIL', 'PISCINA'] })).status).toBe(200);
  });
  test('a categoria PISCINA existe na lista do estabelecimento', async () => {
    const l = (await a('get', '/api/listas')).body.CATEGORIA_PRODUTO.opcoes.map(o => o.valor);
    expect(l).toContain('PISCINA');
  });
  test('o Balcão também vende a estadia (venda do quarto pelos botões)', async () => {
    const r = await a('post', `/api/quartos/${quarto}/vender`, { fracao: 'DUAS_HORAS', nome_hospede: 'Cliente Balcão' });
    expect([200, 201]).toContain(r.status);
    expect((await pool.query(`SELECT status FROM quartos WHERE id = $1`, [quarto])).rows[0].status).toBe('OCUPADO');
  });
});

describe('A conta das mesas não inclui os quartos', () => {
  test('a mesa não pede serviços de quarto (operador e portal)', async () => {
    const r = await a('post', '/api/pedidos', { origem: 'MESA', mesa_id: mesa, itens: [{ produto_id: P.toalha, quantidade: 1 }] });
    expect(r.status).toBe(400); expect(r.body.erro).toMatch(/mesa não pode incluir serviços de quarto/);
    const rp = await pub('post', '/api/cliente/pedido-restaurante', { mesa_ref: 'M01', itens: [{ produto_id: P.toalha, quantidade: 1 }] });
    expect(rp.status).toBe(400);
    // sem mesa, o portal continua a aceitar serviços de quarto
    expect((await pub('post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: P.toalha, quantidade: 1 }] })).status).toBe(201);
  });
  test('um pedido nunca é de uma mesa e de um quarto ao mesmo tempo (base de dados)', async () => {
    await expect(pool.query(`INSERT INTO pedidos (tenant_id, mesa_id, quarto_id, status, total, origem) VALUES ($1,$2,$3,'FECHADO',100,'MESA')`, [A.tenantId, mesa, quarto]))
      .rejects.toThrow(/pedidos_mesa_ou_quarto/);
  });
  test('mesa e quarto nunca se recebem juntos (409 MESA_E_QUARTO); em separado, sim', async () => {
    const pm = (await a('post', '/api/pedidos', { origem: 'MESA', mesa_id: mesa, itens: [{ produto_id: P.picanha, quantidade: 1 }] })).body;
    expect((await a('patch', `/api/pedidos/${pm.id}/status`, { status: 'FECHADO' })).status).toBe(200);
    const pq = await a('post', '/api/pedidos', { origem: 'QUARTO', quarto_id: quarto, itens: [{ produto_id: P.toalha, quantidade: 1 }] });
    expect(pq.status).toBe(201);
    expect((await a('patch', `/api/pedidos/${pq.body.id}/status`, { status: 'FECHADO' })).status).toBe(200);
    const r = await a('post', '/api/caixa/receber', { pedido_ids: [pm.id, pq.body.id], metodo: 'TPA' });
    expect(r.status).toBe(409); expect(r.body.codigo).toBe('MESA_E_QUARTO');
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM pedidos WHERE id = ANY($1::uuid[]) AND pago_em IS NOT NULL`, [[pm.id, pq.body.id]])).rows[0].n).toBe(0);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [pm.id], metodo: 'TPA' })).status).toBe(200);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [pq.body.id], metodo: 'TPA' })).status).toBe(200);
  });
});
