'use strict';
/**
 * Integração (PostgreSQL real) — Folha de Caixa diária (21/11/2026, folha em papel do Clube 3D Resort):
 * abertura, compras/saídas por área, vendas por grupo, J/K, fecho A+J−D, quebras, crédito, configuração e isolamento.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, OP, cuca, frango, piscina, gelo, cucaStock, cliente, n = 1;
const ip = () => `10.31.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });

async function vender(itens, pagamento) {
  const p = (await call(A, 'post', '/api/pedidos', { origem: 'BALCAO', itens })).body;
  await call(A, 'patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' });
  if (pagamento) expect((await call(A, 'post', '/api/caixa/receber', { pedido_ids: [p.id], ...pagamento })).status).toBe(200);
  return p;
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-folha-a' });
  B = await criarTenantFixture({ slug: 'it-folha-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Op','op@it-folha.ao',$2,'Caixa','OPERADOR') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  OP = { token: gerarToken({ id: op, email: 'op@it-folha.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
  const ins = (nome, preco, cat) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat]);
  cuca = (await ins('Cuca garrafa', 500, 'BEBIDA')).rows[0].id;
  frango = (await ins('Frango assado', 10000, 'CHURRASCO')).rows[0].id;
  piscina = (await ins('Piscina adulto', 4000, 'PISCINA')).rows[0].id;
  const st = (nome, cat, custo) => pool.query(`INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, unidade, custo_unitario) VALUES ($1,$2,$3,100,'un',$4) RETURNING id`, [A.tenantId, nome, cat, custo]);
  gelo = (await st('Gelo (saco)', 'OUTRO', null)).rows[0].id;
  cucaStock = (await st('Cuca (grade 24)', 'BEBIDA', 277)).rows[0].id;
  cliente = (await pool.query(`INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1,'Sr. Elias','+244923000111') RETURNING id`, [A.tenantId])).rows[0].id;
  expect((await call(A, 'put', `/api/caixa/conta-corrente/${cliente}`, { ativa: true, limite: 100000 })).status).toBe(200);
  expect((await call(A, 'post', '/api/caixa/abrir', { fundo_inicial: 20000 })).status).toBe(201);
}, 60000);

test('só a chefia vê a folha; dia inválido ou futuro → 400', async () => {
  expect((await call(OP, 'get', '/api/caixa/folha')).status).toBe(403);
  expect((await call(A, 'get', '/api/caixa/folha?dia=2026-02-30')).status).toBe(400);
  expect((await call(A, 'get', '/api/caixa/folha?dia=2099-01-01')).status).toBe(400);
});

test('compras com área, NIF e documento; validações', async () => {
  expect((await call(A, 'post', '/api/compras', { stock_item_id: gelo, quantidade: 4, valor_total: 3000, area: 'GARAGEM' })).status).toBe(400);
  expect((await call(A, 'post', '/api/compras', { stock_item_id: gelo, quantidade: 4, valor_total: 3000, fornecedor_nif: '12' })).status).toBe(400);
  const g = await call(A, 'post', '/api/compras', { stock_item_id: gelo, quantidade: 4, valor_total: 3000, area: 'esplanada_bar', fornecedor: 'Gelo Lda' });
  expect(g.status).toBe(201);
  expect(g.body.compra).toMatchObject({ area: 'ESPLANADA_BAR' });
  const c = await call(A, 'post', '/api/compras', { stock_item_id: cucaStock, quantidade: 1, valor_total: 6650, fornecedor: 'H. Duong', fornecedor_nif: '5000831883', documento: 'FR FR2026/47546' });
  expect(c.status).toBe(201);
  expect(c.body.compra).toMatchObject({ fornecedor_nif: '5000831883', documento: 'FR FR2026/47546', area: null });
  // despesa paga pelo banco (não sai da gaveta) e outra pela gaveta
  expect((await call(A, 'post', '/api/financeiro/despesas', { categoria: 'ENERGIA', descricao: 'Energia paga', valor: 10000 })).status).toBe(201);
  expect((await call(A, 'post', '/api/financeiro/despesas', { categoria: 'OUTRA', descricao: 'Transporte de mota', valor: 4200, pela_gaveta: true, area: 'DIVERSOS' })).status).toBe(201);
  expect((await call(A, 'post', '/api/financeiro/despesas', { categoria: 'OUTRA', descricao: 'x x x', valor: 1, area: 'NADA' })).status).toBe(400);
});

test('a folha do dia bate certo: B/C/D, E..I, J/K, fecho = A + J − D, quebras e crédito', async () => {
  await vender([{ produto_id: cuca, quantidade: 10 }], { metodo: 'CASH' });          // 5 000 dinheiro → F
  await vender([{ produto_id: frango, quantidade: 2 }], { metodo: 'TPA' });          // 20 000 banco → G
  await vender([{ produto_id: piscina, quantidade: 3 }], { metodo: 'CASH' });        // 12 000 dinheiro → H
  await vender([{ produto_id: cuca, quantidade: 6 }], { metodo: 'CONTA', cliente_id: cliente }); // 3 000 a crédito (dívida)
  await vender([{ produto_id: frango, quantidade: 1 }], null);                        // por receber: fora das vendas
  // 2 grades partidas no armazém (quebra ao custo 277)
  expect((await call(A, 'post', `/api/stock/${cucaStock}/movimento`, { tipo: 'DESPERDICIO', quantidade: 2, motivo: 'Cerveja partida' })).status).toBe(201);

  const r = await call(A, 'get', `/api/caixa/folha?dia=${hoje()}`);
  expect(r.status).toBe(200);
  const f = r.body;
  expect(f.abertura.A).toBe(20000);
  // saídas: gelo 3000 (bar, caixa) + cuca 6650 (bar pela categoria de stock, caixa) + energia 10000 (técnica, banco) + mota 4200 (diversos, caixa)
  expect(f.saidas).toMatchObject({ B: 23850, C: 10000, D: 13850, total: 23850 });
  expect(f.saidas.por_area).toEqual({ ESPLANADA_BAR: 9650, TECNICA: 10000, DIVERSOS: 4200 });
  expect(f.saidas.linhas.find(s => s.documento === 'FR FR2026/47546')).toMatchObject({ fornecedor_nif: '5000831883', area: 'ESPLANADA_BAR' });
  expect(f.vendas).toMatchObject({ F: 8000, G: 20000, H: 12000, I: 0, E: 0, total: 40000, a_credito: 3000, descontos: 0 });
  expect(f.vendas.grupos.BEBIDAS.linhas[0]).toMatchObject({ produto: 'Cuca garrafa', preco: 500, quantidade: 16, valor: 8000 });
  expect(f.entradas.J).toBe(17000);
  expect(f.entradas.K).toBe(20000);
  expect(f.fecho.calculado).toBe(20000 + 17000 - 13850);
  expect(f.fecho.declarado).toBeNull();
  expect(f.quebras.total).toBe(13300); // ao custo actual: a compra de hoje pôs o custo da grade em 6 650
  expect(f.por_receber).toMatchObject({ n: 1, valor: 10000 });
  expect(f.alertas.join(' ')).toMatch(/ainda está aberto/);
  // fecho calculado = esperado na gaveta do Caixa
  const esp = (await pool.query(`SELECT s.fundo_inicial + COALESCE((SELECT SUM(valor) FROM caixa_movimentos m WHERE m.sessao_id = s.id AND m.metodo = 'CASH'), 0) AS v
                                    FROM caixa_sessoes s WHERE s.tenant_id = $1 AND s.fechada_em IS NULL`, [A.tenantId])).rows[0].v;
  expect(Number(esp)).toBe(f.fecho.calculado);
});

test('configuração: grupos e áreas configuráveis (só ADMIN), repor volta ao padrão', async () => {
  expect((await call(OP, 'put', '/api/caixa/folha/config', { grupos: { CHURRASCO: 'OUTROS' } })).status).toBe(403);
  expect((await call(A, 'put', '/api/caixa/folha/config', { grupos: { CHURRASCO: 'PETISCOS' } })).status).toBe(400);
  expect((await call(A, 'put', '/api/caixa/folha/config', { areas_despesa: { ENERGIA: 'GARAGEM' } })).status).toBe(400);
  const g = await call(A, 'put', '/api/caixa/folha/config', { grupos: { BEBIDA: 'BEBIDAS', CHURRASCO: 'OUTROS', PISCINA: 'PISCINA' }, areas_despesa: { ENERGIA: 'HOTEL' } });
  expect(g.status).toBe(200);
  const f = (await call(A, 'get', '/api/caixa/folha')).body;
  expect(f.vendas).toMatchObject({ E: 20000, G: 0 });
  expect(f.saidas.por_area.HOTEL).toBe(10000);
  expect((await call(A, 'put', '/api/caixa/folha/config', { repor: true })).body.configurado).toBe(false);
  expect((await call(A, 'get', '/api/caixa/folha')).body.vendas.G).toBe(20000);
});

test('PDF A4 da folha e isolamento entre estabelecimentos', async () => {
  const pdf = await call(A, 'get', `/api/caixa/folha.pdf?dia=${hoje()}`).buffer(true).parse((res, cb) => { const b = []; res.on('data', c => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
  expect(pdf.status).toBe(200);
  expect(pdf.headers['content-type']).toMatch(/pdf/);
  expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
  if (process.env.GUARDAR_PDF) require('fs').writeFileSync(process.env.GUARDAR_PDF, pdf.body);
  const fb = (await call(B, 'get', '/api/caixa/folha')).body;
  expect(fb).toMatchObject({ abertura: { A: 0 }, saidas: { B: 0 }, vendas: { total: 0 }, entradas: { J: 0, K: 0 } });
  expect(fb.alertas.join(' ')).toMatch(/Não houve abertura/);
});
