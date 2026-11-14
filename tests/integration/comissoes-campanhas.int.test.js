'use strict';
/** Integração (PostgreSQL real) — comissões do pessoal no relatório e campanhas (datas + desconto geral). */
const request = require('supertest');
const { app } = require('../../server/app');

let A, cuca, picanha, n = 1;
const ip = () => `10.13.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const dia = d => d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
const hoje = () => dia(new Date());
const maisDias = k => dia(new Date(Date.now() + k * 86400e3));

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-comis-a' });
  const ins = (nome, preco, cat) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat]);
  cuca = (await ins('Cuca', 600, 'BEBIDA')).rows[0].id;
  picanha = (await ins('Picanha', 4500, 'CHURRASCO')).rows[0].id;
}, 60000);

describe('Comissões', () => {
  test('ADMIN define a comissão (0–100) e o relatório calcula-a sobre as vendas fechadas', async () => {
    const f = await call(A, 'post', '/api/funcionarios', { nome: 'Garçom Zé', email: 'ze@it-comis-a.ao', password: '123456', nivel_acesso: 'OPERADOR', comissao_pct: 5 });
    expect(f.status).toBe(201);
    expect(Number(f.body.comissao_pct)).toBe(5);
    expect((await call(A, 'put', `/api/funcionarios/${f.body.id}`, { comissao_pct: 101 })).status).toBe(400);
    const ze = { token: require('../../server/middleware/auth').gerarToken({ id: f.body.id, email: 'ze@it-comis-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
    const p = await call(ze, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: picanha, quantidade: 2 }] });
    await call(ze, 'patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' });
    expect((await call(A, 'put', `/api/funcionarios/${f.body.id}`, { comissao_pct: 2.5 })).status).toBe(200);
    const r = await call(A, 'get', `/api/relatorios/vendas?de=${hoje()}&ate=${hoje()}`);
    expect(r.body.por_funcionario.find(x => x.nome === 'Garçom Zé')).toMatchObject({ valor: 9000, comissao_pct: 2.5, comissao: 225 });
  });
});

describe('Campanhas (tabela com datas e desconto geral)', () => {
  test('validações das datas e do desconto', async () => {
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'Natal', data_inicio: '2026-12-25', data_fim: '2026-12-01' })).status).toBe(400);
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'Natal', desconto_pct: 100 })).status).toBe(400);
    expect((await call(A, 'post', '/api/precos/tabelas', { nome: 'Natal', data_inicio: '25/12/2026' })).status).toBe(400);
  });

  test('campanha futura não se aplica; em curso aplica o desconto geral e respeita preços próprios', async () => {
    const futura = (await call(A, 'post', '/api/precos/tabelas', { nome: 'Futura', data_inicio: maisDias(3), data_fim: maisDias(10), desconto_pct: 50, prioridade: 90 })).body;
    expect((await call(A, 'get', '/api/precos/actuais?origem=BALCAO')).body.tabela).toBeNull();
    const camp = (await call(A, 'post', '/api/precos/tabelas', { nome: 'Semana da casa', data_inicio: hoje(), data_fim: maisDias(6), desconto_pct: 10, prioridade: 20 })).body;
    await call(A, 'put', `/api/precos/tabelas/${camp.id}/precos`, { precos: [{ produto_id: cuca, preco: 500 }] });
    const a = await call(A, 'get', '/api/precos/actuais?origem=BALCAO');
    expect(a.body).toMatchObject({ tabela: { nome: 'Semana da casa' }, desconto_pct: 10 });
    const p = await call(A, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: picanha, quantidade: 1 }, { produto_id: cuca, quantidade: 2 }] });
    expect(Number(p.body.total)).toBe(4050 + 1000); // picanha −10%; cuca com preço próprio
    // passa a acabar ontem → deixa de se aplicar; editar com fim antes do início → 400
    expect((await call(A, 'put', `/api/precos/tabelas/${camp.id}`, { data_inicio: maisDias(-5), data_fim: maisDias(-1) })).status).toBe(200);
    expect((await call(A, 'get', '/api/precos/actuais?origem=BALCAO')).body.tabela).toBeNull();
    expect((await call(A, 'put', `/api/precos/tabelas/${futura.id}`, { data_fim: maisDias(1) })).status).toBe(400);
  });
});
