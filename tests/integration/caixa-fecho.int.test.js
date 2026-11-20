'use strict';
/**
 * Integração — Fecho do caixa (regras do dono, 20/11/2026): nunca com contas por pagar; contagem que não bate certo
 * só fecha com justificação, que fica selada com a sessão.
 */
const request = require('supertest');
const { app } = require('../../server/app');

let A, B, ipN = 1, cuca;
const ip = () => `10.67.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
async function pedido(T, fechar = true) {
  const p = await op(T, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: T === A ? cuca : T.cuca, quantidade: 2 }] });
  expect(p.status).toBe(201);
  if (fechar) expect((await op(T, 'patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' })).status).toBe(200);
  return p.body;
}
const esperado = async () => (await a('get', '/api/caixa')).body.resumo.dinheiro_esperado;

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-cx-fecho' });
  B = await criarTenantFixture({ slug: 'it-cx-fecho-b' });
  const ins = async (T, preco) => (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',$2,'BEBIDA',true,true) RETURNING id`, [T.tenantId, preco])).rows[0].id;
  cuca = await ins(A, 600); B.cuca = await ins(B, 600);
  expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 5000 })).status).toBe(201);
}, 60000);

describe('Contas por pagar impedem o fecho', () => {
  test('conta fechada por receber → 409 CONTAS_POR_PAGAR com a lista; nada fica fechado', async () => {
    const p = await pedido(A);
    const e = (await a('get', '/api/caixa')).body;
    expect(e.pendencias.n).toBe(1); expect(e.pendencias.total).toBe(1200);
    const r = await a('post', '/api/caixa/fechar', { contado: 5000 });
    expect(r.status).toBe(409); expect(r.body.codigo).toBe('CONTAS_POR_PAGAR');
    expect(r.body.pendencias.contas.map(c => c.id)).toEqual([p.id]);
    expect(r.body.erro).toMatch(/1 conta por pagar/);
    expect((await a('get', '/api/caixa')).body.aberta).toBe(true);
    // recebida, deixa de contar
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'TPA' })).status).toBe(200);
    expect((await a('get', '/api/caixa')).body.pendencias.n).toBe(0);
  });
  test('pedido ainda na cozinha (não fechado) também impede; cancelado não conta', async () => {
    const p = await pedido(A, false);
    const r = await a('post', '/api/caixa/fechar', { contado: await esperado() });
    expect(r.status).toBe(409); expect(r.body.pendencias.contas[0].status).toBe('ABERTO');
    expect((await a('patch', `/api/pedidos/${p.id}/status`, { status: 'CANCELADO' })).status).toBe(200); // dentro dos 5 min
    expect((await a('get', '/api/caixa')).body.pendencias.n).toBe(0);
  });
  test('conta de 0 Kz não impede (não há nada a cobrar)', async () => {
    await pool.query(`INSERT INTO pedidos (tenant_id, status, total, origem, validado_em) VALUES ($1,'FECHADO',0,'BALCAO',NOW())`, [A.tenantId]);
    expect((await a('get', '/api/caixa')).body.pendencias.n).toBe(0);
  });
  test('contas de outro estabelecimento não contam', async () => {
    await pedido(B);
    expect((await a('get', '/api/caixa')).body.pendencias.n).toBe(0);
  });
});

describe('Contagem que não bate certo', () => {
  test('diferença sem justificação (ou curta) → 409 DIFERENCA_POR_JUSTIFICAR com os valores', async () => {
    const esp = await esperado();
    let r = await a('post', '/api/caixa/fechar', { contado: esp - 300 });
    expect(r.status).toBe(409); expect(r.body.codigo).toBe('DIFERENCA_POR_JUSTIFICAR');
    expect(r.body).toMatchObject({ esperado: esp, contado: esp - 300, diferenca: -300 });
    expect(r.body.erro).toMatch(/faltam 300/);
    r = await a('post', '/api/caixa/fechar', { contado: esp + 50, justificacao: '   curta  ' });
    expect(r.status).toBe(409); expect(r.body.erro).toMatch(/sobram 50/);
    expect((await a('get', '/api/caixa')).body.aberta).toBe(true);
  });
  test('com justificação fecha; a justificação fica gravada e selada', async () => {
    const esp = await esperado();
    const r = await a('post', '/api/caixa/fechar', { contado: esp - 300, justificacao: '  Nota de 300 Kz rasgada, devolvida ao banco  ' });
    expect(r.status).toBe(200);
    expect(Number(r.body.sessao.diferenca)).toBe(-300);
    expect(r.body.sessao.justificacao).toBe('Nota de 300 Kz rasgada, devolvida ao banco');
    const h = (await a('get', '/api/caixa/sessoes')).body[0];
    expect(h.justificacao).toBe('Nota de 300 Kz rasgada, devolvida ao banco');
    await expect(pool.query(`UPDATE caixa_sessoes SET justificacao = 'outra' WHERE id = $1`, [h.id])).rejects.toThrow(/não podem ser alterados/);
    const z = await a('get', `/api/relatorios/caixa/${h.id}`);
    expect(z.status).toBe(200); expect(z.body.sessao.justificacao).toBe('Nota de 300 Kz rasgada, devolvida ao banco');
    const pdf = await a('get', `/api/relatorios/caixa/${h.id}/talao.pdf`);
    expect(pdf.status).toBe(200); expect(pdf.headers['content-type']).toMatch(/pdf/);
  });
  test('contas certas fecham sem justificação e não gravam nenhuma', async () => {
    expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 2000 })).status).toBe(201);
    const r = await a('post', '/api/caixa/fechar', { contado: 2000, justificacao: 'não é precisa aqui' });
    expect(r.status).toBe(200);
    expect(Number(r.body.sessao.diferenca)).toBe(0); expect(r.body.sessao.justificacao).toBeNull();
  });
});
