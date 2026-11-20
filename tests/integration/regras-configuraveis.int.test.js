'use strict';
/**
 * Integração — 21/11/2026 (pedido do dono): regras que estavam fixas no código passam para as Configurações.
 *  - o que cada fluxo vende (Balcão, Take Away, Lazer, Loja);
 *  - os tempos dos quartos (Hora/Noite/Diária, arrumação, aviso, estrela vermelha).
 * Sem configuração tudo continua como antes.
 */
const request = require('supertest');
const { app } = require('../../server/app');
const vendas = require('../../server/services/quartos-vendas.service');
const { gerarToken } = require('../../server/middleware/auth');

let nGer = 0;
async function criarFuncionarioFixture(T, nivel) {
  const email = `ger${++nGer}@${T.slug}.ao`;
  const id = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Gerente',$2,'x','Gerente',$3) RETURNING id`, [T.tenantId, email, nivel])).rows[0].id;
  return { token: gerarToken({ id, email, nivel_acesso: nivel, tenantId: T.tenantId }) };
}

let A, B, ipN = 1, P = {}, cliente, quarto;
const ip = () => `10.71.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const com = T => (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
let a, b;
const pedir = (origem, produtos, extra = {}) => a('post', '/api/pedidos', { origem, itens: produtos.map(produto_id => ({ produto_id, quantidade: 1 })), ...extra });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-regras-cfg', balcaoTudo: false });
  B = await criarTenantFixture({ slug: 'it-regras-cfg-b' });
  a = com(A); b = com(B);
  await pool.query(`UPDATE funcionarios SET pode_vender_quartos = true WHERE id = $1`, [A.userId]);
  const ins = async (nome, preco, cat) => (await pool.query(
    `INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [A.tenantId, nome, preco, cat])).rows[0].id;
  P.picanha = await ins('Picanha', 4500, 'CHURRASCO'); P.cuca = await ins('Cuca', 600, 'BEBIDA');
  P.shisha = await ins('Shisha', 5000, 'SHISHA'); P.kart = await ins('Kart 10 min', 3000, 'LAZER');
  P.piscina = await ins('Entrada piscina', 3000, 'PISCINA'); P.tabaco = await ins('Tabaco', 1500, 'CIGARROS'); P.boné = await ins('Boné', 4000, 'LOJA');
  cliente = (await pool.query(`INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1,'Cliente TA','+244911223344') RETURNING id`, [A.tenantId])).rows[0].id;
  await pool.query(`INSERT INTO pedidos (tenant_id, cliente_id, total, status, origem) VALUES ($1,$2,100,'FECHADO','BALCAO')`, [A.tenantId, cliente]);
  quarto = (await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, status, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,'201','SUITE','DISPONIVEL',5000,15000,25000) RETURNING id`, [A.tenantId])).rows[0].id;
}, 60000);

describe('O que cada fluxo vende', () => {
  test('sem configuração vale a regra de sempre (e a lista do Take Away sai das categorias activas)', async () => {
    const r = (await a('get', '/api/pedidos/fluxos/categorias')).body;
    expect(r.BALCAO).toMatchObject({ categorias: ['BEBIDA', 'COCKTAIL', 'PISCINA'], configurado: false });
    expect(r.LAZER.categorias).toEqual(['LAZER']);
    expect(r.LOJA.categorias).toEqual(['LOJA', 'CIGARROS']);
    expect(r.TAKEAWAY.configurado).toBe(false);
    expect(r.TAKEAWAY.categorias).toEqual(expect.arrayContaining(['CHURRASCO', 'BEBIDA']));
    expect(r.TAKEAWAY.categorias).not.toEqual(expect.arrayContaining(['SHISHA']));
    expect(r.TAKEAWAY.categorias.some(c => ['PISCINA', 'LAZER', 'LOJA', 'CIGARROS', 'SERVICO_QUARTO'].includes(c))).toBe(false);
    const ta = await pedir('TAKEAWAY', [P.shisha], { cliente_id: cliente });
    expect(ta.status).toBe(400); expect(ta.body.erro).toMatch(/Take Away é só para comidas e bebidas/);
    expect((await pedir('TAKEAWAY', [P.picanha], { cliente_id: cliente })).status).toBe(201);
    expect((await pedir('LAZER', [P.piscina])).status).toBe(400);
  });

  test('o Administrador muda o Take Away: passa a vender só o escolhido, com a mensagem certa', async () => {
    const r = await a('put', '/api/configuracoes/fluxos/takeaway', { categorias: ['bebida', 'shisha'] });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ fluxo: 'TAKEAWAY', categorias: ['BEBIDA', 'SHISHA'], configurado: true });
    expect((await pedir('TAKEAWAY', [P.shisha], { cliente_id: cliente })).status).toBe(201);
    const x = await pedir('TAKEAWAY', [P.picanha], { cliente_id: cliente });
    expect(x.status).toBe(400); expect(x.body.erro).toBe('O Take Away só vende: Bebida, Shisha.');
  });

  test('Lazer e Loja também se configuram; a venda continua a nascer FECHADA', async () => {
    expect((await a('put', '/api/configuracoes/fluxos/LAZER', { categorias: ['LAZER', 'PISCINA'] })).status).toBe(200);
    const r = await pedir('LAZER', [P.piscina, P.kart]);
    expect(r.status).toBe(201); expect(r.body.status).toBe('FECHADO');
    expect((await a('put', '/api/configuracoes/fluxos/LOJA', { categorias: ['LOJA'] })).status).toBe(200);
    const t = await pedir('LOJA', [P.tabaco]);
    expect(t.status).toBe(400); expect(t.body.erro).toBe('A Loja só vende: Loja.');
    expect((await pedir('LOJA', [P.boné])).status).toBe(201);
  });

  test('o Balcão continua com o seu código de erro e a sua rota antiga', async () => {
    expect((await a('put', '/api/configuracoes/fluxos/BALCAO', { categorias: ['BEBIDA'] })).status).toBe(200);
    expect((await a('get', '/api/pedidos/balcao/categorias')).body.categorias).toEqual(['BEBIDA']);
    const r = await pedir('BALCAO', [P.piscina]);
    expect(r.status).toBe(400); expect(r.body.erro).toMatch(/^O Balcão só vende: Bebida\. A estadia vende-se pelos quartos\./);
  });

  test('repor o padrão, fluxo inválido, lista vazia e categoria inexistente', async () => {
    expect((await a('put', '/api/configuracoes/fluxos/MESA', { categorias: ['BEBIDA'] })).status).toBe(400);
    expect((await a('put', '/api/configuracoes/fluxos/LOJA', { categorias: [] })).status).toBe(400);
    expect((await a('put', '/api/configuracoes/fluxos/LOJA', { categorias: ['NAO_EXISTE'] })).status).toBe(400);
    const r = await a('put', '/api/configuracoes/fluxos/LOJA', { categorias: null });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ categorias: ['LOJA', 'CIGARROS'], configurado: false });
    expect((await pedir('LOJA', [P.tabaco])).status).toBe(201);
  });

  test('só o Administrador configura e cada estabelecimento tem as suas regras', async () => {
    const g = await criarFuncionarioFixture(A, 'GERENTE');
    expect((await com(g)('put', '/api/configuracoes/fluxos/LOJA', { categorias: ['LOJA'] })).status).toBe(403);
    expect((await b('get', '/api/pedidos/fluxos/categorias')).body.TAKEAWAY.configurado).toBe(false);
  });
});

describe('Tempos dos quartos', () => {
  test('sem configuração: os de sempre; limites e coerência validados; só ADMIN grava', async () => {
    const t = (await a('get', '/api/quartos/tempos')).body;
    expect(t).toMatchObject({ hora_h: 2, noite_h: 12, diaria_h: 24, limpeza_min: 30, aviso_min: 5, estrela_min: 60 });
    expect((await a('put', '/api/quartos/tempos', { hora_h: 0 })).status).toBe(400);
    expect((await a('put', '/api/quartos/tempos', { hora_h: 2.5 })).status).toBe(400);
    expect((await a('put', '/api/quartos/tempos', { hora_h: 12, noite_h: 10 })).status).toBe(400);
    expect((await a('put', '/api/quartos/tempos', {})).status).toBe(400);
    const g = await criarFuncionarioFixture(A, 'GERENTE');
    expect((await com(g)('put', '/api/quartos/tempos', { hora_h: 3 })).status).toBe(403);
  });

  test('«Hora» de 3 h e arrumação de 45 min valem nas vendas novas e na hora em que o quarto fica livre', async () => {
    const r = await a('put', '/api/quartos/tempos', { hora_h: 3, limpeza_min: 45 });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ hora_h: 3, limpeza_min: 45, noite_h: 12 });
    const v = await a('post', `/api/quartos/${quarto}/vender`, { fracao: 'DUAS_HORAS' });
    expect(v.status).toBe(201);
    expect(Math.round((new Date(v.body.checkout) - new Date(v.body.checkin)) / 60e3)).toBe(180);
    const q = (await a('get', '/api/quartos')).body.find(x => x.id === quarto);
    expect(Math.round((new Date(q.livre_as) - new Date(v.body.checkout)) / 60e3)).toBe(45);
    // reserva que tocaria na folga de 45 min depois do fim é recusada
    const fim = new Date(v.body.checkout);
    const rr = await a('post', `/api/quartos/${quarto}/reservar`, { fracao: 'DUAS_HORAS', inicio: new Date(fim.getTime() + 40 * 60e3).toISOString() });
    expect(rr.status).toBe(409); expect(rr.body.erro).toMatch(/45 min de arrumação/);
  });

  test('o agendador usa o aviso e o prazo de arrumação do estabelecimento', async () => {
    expect((await a('put', '/api/quartos/tempos', { aviso_min: 20 })).status).toBe(200);
    const rv = (await pool.query(`SELECT id FROM reservas WHERE quarto_id = $1 AND status = 'CHECKIN'`, [quarto])).rows[0].id;
    // faltam 15 min: com o aviso de sempre (5 min) ainda não avisava; com 20 min avisa
    const agora = new Date();
    await pool.query(`UPDATE reservas SET checkout = $2 WHERE id = $1`, [rv, new Date(agora.getTime() + 15 * 60e3)]);
    await vendas.processarTick(agora);
    const l = (await pool.query(`SELECT prazo_em FROM quarto_limpezas WHERE quarto_id = $1 AND limpo_em IS NULL`, [quarto])).rows[0];
    expect(l).toBeTruthy();
    expect(Math.round((new Date(l.prazo_em) - agora) / 60e3)).toBe(15 + 45);
  });

  test('um valor estragado na base não faz falhar o agendador e repor volta aos de sempre', async () => {
    await pool.query(`UPDATE configuracoes SET valor = 'isto não é JSON' WHERE tenant_id = $1 AND chave = 'quartos_tempos'`, [A.tenantId]);
    await expect(vendas.processarTick(new Date())).resolves.toBeTruthy();
    expect((await a('get', '/api/quartos/tempos')).body.hora_h).toBe(2);
    const r = await a('put', '/api/quartos/tempos', { repor: true });
    expect(r.status).toBe(200); expect(r.body.hora_h).toBe(2);
    expect((await pool.query(`SELECT 1 FROM configuracoes WHERE tenant_id = $1 AND chave = 'quartos_tempos'`, [A.tenantId])).rows).toHaveLength(0);
  });
});
