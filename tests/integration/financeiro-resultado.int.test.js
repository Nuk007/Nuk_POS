'use strict';
/** Integração (PostgreSQL real) — resultado do período, margem por produto e despesas. */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, OP, picanha, cuca, n = 1;
const ip = () => `10.18.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });

async function vender(prod, qtd, receber = true) {
  const p = (await call(A, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: prod, quantidade: qtd }] })).body;
  await call(A, 'patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' });
  if (receber) expect((await call(A, 'post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'TPA' })).status).toBe(200);
  return p;
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-fin-a' });
  B = await criarTenantFixture({ slug: 'it-fin-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Op','op@it-fin-a.ao',$2,'Caixa','OPERADOR') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  OP = { token: gerarToken({ id: op, email: 'op@it-fin-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
  const ins = (nome, preco, cat) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat]);
  picanha = (await ins('Picanha', 4500, 'CHURRASCO')).rows[0].id;
  cuca = (await ins('Cuca', 600, 'BEBIDA')).rows[0].id;
  // receita: 0,3 kg de carne a 6000 Kz/kg = 1800 Kz por picanha; a Cuca não tem receita
  const carne = (await pool.query(`INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, unidade, custo_unitario) VALUES ($1,'Carne','CARNE',100,'kg',6000) RETURNING id`, [A.tenantId])).rows[0].id;
  await pool.query(`INSERT INTO produto_ingredientes (produto_id, stock_item_id, quantidade) VALUES ($1,$2,0.3)`, [picanha, carne]);
  expect((await call(A, 'post', '/api/caixa/abrir', { fundo_inicial: 10000 })).status).toBe(201);
}, 60000);

test('só a chefia vê o resultado (OPERADOR → 403)', async () => {
  expect((await call(OP, 'get', '/api/financeiro/resultado')).status).toBe(403);
  expect((await call(OP, 'post', '/api/financeiro/despesas', { categoria: 'RENDA', descricao: 'Renda', valor: 1 })).status).toBe(403);
});

test('receita = cobrado; custo pela receita de stock; margem por produto; produto sem receita assinalado', async () => {
  await vender(picanha, 2);       // 9000 receita, 3600 custo
  await vender(cuca, 3);          // 1800 receita, sem receita de stock
  await vender(picanha, 1, false); // fechado por receber: não entra na receita
  const r = (await call(A, 'get', `/api/financeiro/resultado?de=${hoje()}&ate=${hoje()}`)).body;
  expect(r.receita).toMatchObject({ vendas: 10800, total: 10800, pedidos: 2 });
  expect(r.por_receber.valor).toBe(4500);
  expect(r.custo_vendas).toBe(3600);
  expect(r.margem_bruta).toBe(7200);
  expect(r.receita_sem_custo).toBe(1800);
  expect(r.por_produto.find(p => p.nome === 'Picanha')).toMatchObject({ quantidade: 2, receita: 9000, custo_unitario: 1800, custo: 3600, margem: 5400, margem_pct: 60 });
  expect(r.por_produto.find(p => p.nome === 'Cuca').sem_receita).toBe(true);
  expect(r.resultado).toBe(10800 - 3600);
  expect((await call(B, 'get', '/api/financeiro/resultado')).body.receita.total).toBe(0);
});

test('despesas: validações, pela gaveta tira dinheiro do caixa, anular devolve; entram no resultado', async () => {
  expect((await call(A, 'post', '/api/financeiro/despesas', { categoria: 'FESTA', descricao: 'x', valor: 10 })).status).toBe(400);
  expect((await call(A, 'post', '/api/financeiro/despesas', { categoria: 'RENDA', descricao: 'Renda', valor: 10, data: '2099-01-01' })).status).toBe(400);
  const renda = await call(A, 'post', '/api/financeiro/despesas', { categoria: 'RENDA', descricao: 'Renda de Novembro', valor: 50000 });
  expect(renda.status).toBe(201);
  const antes = (await call(A, 'get', '/api/caixa')).body.resumo.dinheiro_esperado;
  expect((await call(A, 'post', '/api/financeiro/despesas', { categoria: 'ENERGIA', descricao: 'Gás', valor: antes + 1, pela_gaveta: true })).status).toBe(409);
  const gas = await call(A, 'post', '/api/financeiro/despesas', { categoria: 'ENERGIA', descricao: 'Botija de gás', valor: 3000, pela_gaveta: true });
  expect(gas.status).toBe(201);
  expect((await call(A, 'get', '/api/caixa')).body.resumo.dinheiro_esperado).toBe(antes - 3000);
  let r = (await call(A, 'get', `/api/financeiro/resultado?de=${hoje()}&ate=${hoje()}`)).body;
  expect(r.total_despesas).toBe(53000);
  expect(r.despesas.find(d => d.categoria === 'RENDA').valor).toBe(50000);
  expect(r.caixa.saidas.DESPESA).toBe(3000);
  expect((await call(A, 'post', `/api/financeiro/despesas/${gas.body.id}/anular`, { motivo: '' })).status).toBe(400);
  expect((await call(B, 'post', `/api/financeiro/despesas/${gas.body.id}/anular`, { motivo: 'engano' })).status).toBe(404);
  expect((await call(A, 'post', `/api/financeiro/despesas/${gas.body.id}/anular`, { motivo: 'Lançada em duplicado' })).status).toBe(200);
  expect((await call(A, 'post', `/api/financeiro/despesas/${gas.body.id}/anular`, { motivo: 'outra vez' })).status).toBe(409);
  expect((await call(A, 'get', '/api/caixa')).body.resumo.dinheiro_esperado).toBe(antes);
  r = (await call(A, 'get', `/api/financeiro/resultado?de=${hoje()}&ate=${hoje()}`)).body;
  expect(r.total_despesas).toBe(50000);
  const lista = (await call(A, 'get', `/api/financeiro/despesas?de=${hoje()}&ate=${hoje()}`)).body;
  expect(lista.find(d => d.id === gas.body.id).motivo_anulacao).toBe('Lançada em duplicado');
});
