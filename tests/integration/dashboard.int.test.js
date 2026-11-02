'use strict';
/** Integração — itens configuráveis do dashboard e comparação com ontem e o dia homólogo (dias de Luanda). */
const request = require('supertest');
const { app } = require('../../server/app');
const svc = require('../../server/services/dashboard.service');

let A, B, G, OP, ipN = 1, shisha, cigarro;
const ip = () => `10.12.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const hoje = svc.diaLuanda();
const ts = (dia, h = 12) => new Date(`${dia}T${String(h).padStart(2, '0')}:00:00+01:00`);

async function venda(T, dia, produtoId, qtd, preco, status = 'FECHADO', h = 12) {
  const p = (await pool.query(`INSERT INTO pedidos (tenant_id, status, total, criado_em) VALUES ($1,$2,$3,$4) RETURNING id`, [T.tenantId, status, qtd * preco, ts(dia, h)])).rows[0].id;
  await pool.query(`INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES ($1,$2,$3,$4)`, [p, produtoId, qtd, preco]);
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-dash-a' });
  B = await criarTenantFixture({ slug: 'it-dash-b' });
  G = await criarTenantFixture({ slug: 'it-dash-g', nivel: 'OPERADOR' });
  // operador do MESMO estabelecimento A (G é de outro estabelecimento)
  const jwt = require('jsonwebtoken');
  const op1 = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, nivel_acesso) VALUES ($1,'Op','op@it-dash-a.ao','x','OPERADOR') RETURNING id`, [A.tenantId])).rows[0].id;
  OP = { token: jwt.sign({ id: op1, email: 'op@it-dash-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  const prod = async (nome, cat, preco) => (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat])).rows[0].id;
  shisha = await prod('Shisha Maçã', 'SHISHA', 8000);
  cigarro = await prod('Cigarro Marlboro', 'OUTRO', 1000);
  const dias = { h: hoje, o: svc.somaDias(hoje, -1), s: svc.somaDias(hoje, -7), x: svc.somaDias(hoje, -3) };
  await venda(A, dias.h, shisha, 2, 8000);            // hoje: 2 shishas = 16 000
  await venda(A, dias.o, shisha, 5, 8000);            // ontem: 5 = 40 000
  await venda(A, dias.s, shisha, 4, 8000);            // homólogo: 4 = 32 000
  await venda(A, dias.x, shisha, 9, 8000);            // 3 dias atrás: não conta
  await venda(A, dias.h, shisha, 7, 8000, 'CANCELADO'); // cancelado: não conta
  await venda(A, dias.h, cigarro, 10, 1000);
  await venda(A, dias.o, cigarro, 3, 1000);
}, 60000);

describe('Itens do dashboard — configuração', () => {
  test('só ADMIN configura; valida tipo, produto e serviço', async () => {
    expect((await op(G, 'post', '/api/dashboard/itens', { nome: 'X', fonte: 'CONTADOR' })).status).toBe(403);
    expect((await op(A, 'post', '/api/dashboard/itens', { nome: '', fonte: 'CONTADOR' })).status).toBe(400);
    expect((await op(A, 'post', '/api/dashboard/itens', { nome: 'X', fonte: 'NADA' })).status).toBe(400);
    expect((await op(A, 'post', '/api/dashboard/itens', { nome: 'X', fonte: 'PRODUTO', ref: 'nao-uuid' })).status).toBe(400);
    expect((await op(A, 'post', '/api/dashboard/itens', { nome: 'X', fonte: 'SERVICO', ref: 'VOAR' })).status).toBe(400);
    expect((await op(A, 'post', '/api/dashboard/itens', { nome: 'X', fonte: 'CATEGORIA', ref: 'INEXISTENTE' })).status).toBe(400);
  });
  test('produto de outro estabelecimento é recusado', async () => {
    expect((await op(B, 'post', '/api/dashboard/itens', { nome: 'Alheio', fonte: 'PRODUTO', ref: shisha })).status).toBe(400);
  });
});

describe('Comparativo hoje / ontem / homólogo', () => {
  let idShisha, idCig, idCat;
  beforeAll(async () => {
    idShisha = (await op(A, 'post', '/api/dashboard/itens', { nome: 'Venda de Shishas', fonte: 'PRODUTO', ref: shisha })).body.id;
    idCig = (await op(A, 'post', '/api/dashboard/itens', { nome: 'Cigarros vendidos', fonte: 'PRODUTO', ref: cigarro })).body.id;
    idCat = (await op(A, 'post', '/api/dashboard/itens', { nome: 'Shisha (categoria)', fonte: 'CATEGORIA', ref: 'SHISHA' })).body.id;
  });
  test('quantidades e valores certos, só pedidos FECHADOS e só os 3 dias', async () => {
    const r = await op(A, 'get', '/api/dashboard/comparativo');
    expect(r.status).toBe(200);
    const sh = r.body.itens.find(i => i.id === idShisha);
    expect(sh.quantidade).toEqual({ hoje: 2, ontem: 5, homologo: 4 });
    expect(sh.valor).toEqual({ hoje: 16000, ontem: 40000, homologo: 32000 });
    const cg = r.body.itens.find(i => i.id === idCig);
    expect(cg.quantidade).toEqual({ hoje: 10, ontem: 3, homologo: 0 });
    expect(r.body.itens.find(i => i.id === idCat).quantidade).toEqual(sh.quantidade);
    expect(r.body.dias).toEqual({ hoje, ontem: svc.somaDias(hoje, -1), homologo: svc.somaDias(hoje, -7) });
  });
  test('facturação total: pedidos fechados + vendas de quartos', async () => {
    const q = (await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,'D1','SUITE',1,2,3) RETURNING id`, [A.tenantId])).rows[0].id;
    await pool.query(`INSERT INTO reservas (tenant_id, quarto_id, nome_hospede, fracao, checkin, checkout, valor_total, criado_em) VALUES ($1,$2,'X','DUAS_HORAS',NOW(),NOW(),20000,$3)`, [A.tenantId, q, ts(hoje, 10)]);
    await pool.query(`INSERT INTO reservas (tenant_id, quarto_id, nome_hospede, fracao, checkin, checkout, valor_total, status, criado_em) VALUES ($1,$2,'Y','PERNOITE',NOW(),NOW(),50000,'CANCELADA',$3)`, [A.tenantId, q, ts(hoje, 11)]);
    const f = (await op(A, 'get', '/api/dashboard/comparativo')).body.facturacao;
    expect(f.restaurante.hoje).toBe(16000 + 10000);
    expect(f.quartos.hoje).toBe(20000);               // a cancelada não conta
    expect(f.valor).toEqual({ hoje: 46000, ontem: 43000, homologo: 32000 });
  });
  test('item de quartos por período (Hora) usa a fracção certa', async () => {
    const id = (await op(A, 'post', '/api/dashboard/itens', { nome: 'Quartos à hora', fonte: 'SERVICO', ref: 'QUARTO_HORA' })).body.id;
    const it = (await op(A, 'get', '/api/dashboard/comparativo')).body.itens.find(i => i.id === id);
    expect(it.quantidade.hoje).toBe(1);
    expect(it.valor.hoje).toBe(20000);
  });
  test('isolamento: o outro estabelecimento não vê estes itens nem números', async () => {
    const r = await op(B, 'get', '/api/dashboard/comparativo');
    expect(r.body.itens).toEqual([]);
    expect(r.body.facturacao.valor).toEqual({ hoje: 0, ontem: 0, homologo: 0 });
  });
  test('ocultar tira o item do comparativo; remover apaga-o', async () => {
    expect((await op(A, 'put', `/api/dashboard/itens/${idCat}`, { ativo: false })).status).toBe(200);
    expect((await op(A, 'get', '/api/dashboard/comparativo')).body.itens.find(i => i.id === idCat)).toBeUndefined();
    expect((await op(A, 'delete', `/api/dashboard/itens/${idCat}`)).status).toBe(204);
    expect((await op(B, 'delete', `/api/dashboard/itens/${idShisha}`)).status).toBe(404);
  });
});

describe('Contadores e pendências manuais', () => {
  let piscina, reclam;
  beforeAll(async () => {
    piscina = (await op(A, 'post', '/api/dashboard/itens', { nome: 'Pessoas na piscina', fonte: 'CONTADOR' })).body.id;
    reclam = (await op(A, 'post', '/api/dashboard/itens', { nome: 'Reclamações', fonte: 'PENDENCIA' })).body.id;
  });
  const estado = async id => (await op(A, 'get', '/api/dashboard/comparativo')).body.itens.find(i => i.id === id);
  const reg = (id, evento, T = OP) => op(T, 'post', `/api/dashboard/itens/${id}/registos`, { evento });

  test('contador: qualquer funcionário regista; "agora" = entradas − saídas; não fica negativo', async () => {
    expect((await reg(piscina, 'MENOS')).status).toBe(409);
    for (let i = 0; i < 3; i++) expect((await reg(piscina, 'MAIS')).status).toBe(204);
    expect((await reg(piscina, 'MENOS')).status).toBe(204);
    const it = await estado(piscina);
    expect(it.agora).toBe(2);
    expect(it.quantidade.hoje).toBe(3);
  });
  test('pendência: abrir, tratar, em aberto; não se trata o que não está aberto', async () => {
    expect((await reg(reclam, 'TRATAR')).status).toBe(409);
    await reg(reclam, 'ABRIR'); await reg(reclam, 'ABRIR');
    expect((await reg(reclam, 'TRATAR')).status).toBe(204);
    const it = await estado(reclam);
    expect(it.em_aberto).toBe(1);
    expect(it.quantidade.hoje).toBe(2);
    expect(it.tratadas.hoje).toBe(1);
  });
  test('evento errado para o tipo de item é recusado; outro estabelecimento não regista', async () => {
    expect((await reg(piscina, 'ABRIR')).status).toBe(400);
    expect((await reg(reclam, 'MAIS')).status).toBe(400);
    expect((await reg(piscina, 'MAIS', B)).status).toBe(404);
  });
});
