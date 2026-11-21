'use strict';
/**
 * Integração — venda ao peso, códigos de barras e etiquetas (21/11/2026, funções do WinREST que faltavam).
 */
const request = require('supertest');
const { app } = require('../../server/app');
const { digitoControlo } = require('../../server/services/produtos.service');

let A, B, ipN = 1, picanha, cuca;
const ip = () => `10.72.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const com = T => (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
let a, b;
const ean = corpo => corpo + digitoControlo(corpo);

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-peso-cod' });
  B = await criarTenantFixture({ slug: 'it-peso-cod-b' });
  a = com(A); b = com(B);
}, 60000);

describe('Produtos: venda ao peso e código de barras', () => {
  test('cria produto ao peso com EAN-13 válido; dígito de controlo errado e código repetido recusados', async () => {
    const r = await a('post', '/api/produtos', { nome: 'Picanha (kg)', preco: 12000, categoria: 'CHURRASCO', vendido_ao_peso: true, codigo_barras: ean('560123456789') });
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ vendido_ao_peso: true, codigo_barras: '5601234567892' });
    picanha = r.body;
    expect((await a('post', '/api/produtos', { nome: 'Mau', preco: 1, categoria: 'BEBIDA', codigo_barras: '5601234567890' })).status).toBe(400);
    const dup = await a('post', '/api/produtos', { nome: 'Outra', preco: 1, categoria: 'BEBIDA', codigo_barras: '5601234567892' });
    expect(dup.status).toBe(409);
    // noutro estabelecimento o mesmo código pode existir
    expect((await b('post', '/api/produtos', { nome: 'Picanha B', preco: 1, categoria: 'CHURRASCO', codigo_barras: '5601234567892' })).status).toBe(201);
    cuca = (await a('post', '/api/produtos', { nome: 'Cuca', preco: 600, categoria: 'BEBIDA' })).body;
  });

  test('gerar código: EAN-13 interno começado por 2; não gera por cima; editar tira ou muda o código', async () => {
    const g = await a('post', `/api/produtos/${cuca.id}/codigo-barras/gerar`);
    expect(g.status).toBe(200); expect(g.body.codigo_barras).toMatch(/^2\d{12}$/);
    expect(digitoControlo(g.body.codigo_barras.slice(0, 12))).toBe(g.body.codigo_barras[12]);
    expect((await a('post', `/api/produtos/${cuca.id}/codigo-barras/gerar`)).status).toBe(409);
    const tira = await a('put', `/api/produtos/${cuca.id}`, { codigo_barras: '' });
    expect(tira.status).toBe(200); expect(tira.body.codigo_barras).toBeNull();
    const muda = await a('put', `/api/produtos/${cuca.id}`, { codigo_barras: 'CUCA-33' });
    expect(muda.body.codigo_barras).toBe('CUCA-33');
    const sem = await a('put', `/api/produtos/${cuca.id}`, { preco: 650 }); // sem o campo: mantém
    expect(sem.body.codigo_barras).toBe('CUCA-33');
  });

  test('procurar pelo código: encontra, não encontra, indisponível e isolamento', async () => {
    expect((await a('get', '/api/produtos/codigo/CUCA-33')).body.id).toBe(cuca.id);
    expect((await a('get', '/api/produtos/codigo/0000000')).status).toBe(404);
    await a('put', `/api/produtos/${cuca.id}`, { disponivel: false });
    expect((await a('get', '/api/produtos/codigo/CUCA-33')).status).toBe(409);
    await a('put', `/api/produtos/${cuca.id}`, { disponivel: true });
    expect((await b('get', '/api/produtos/codigo/CUCA-33')).status).toBe(404);
  });

  test('só o Administrador cria, edita e gera códigos', async () => {
    const { gerarToken } = require('../../server/middleware/auth');
    const id = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Op','op@it-peso-cod.ao','x','Op','OPERADOR') RETURNING id`, [A.tenantId])).rows[0].id;
    const op = com({ token: gerarToken({ id, email: 'op@it-peso-cod.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) });
    expect((await op('put', `/api/produtos/${cuca.id}`, { codigo_barras: 'X-1234' })).status).toBe(403);
    expect((await op('get', '/api/produtos/codigo/CUCA-33')).status).toBe(200); // ler serve o painel de venda
  });
});

describe('Pedidos: quantidades e peso', () => {
  test('peso ao grama: total = peso × preço por kg arredondado ao cêntimo; itens e talão em kg', async () => {
    const r = await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: picanha.id, quantidade: 0.355 }, { produto_id: cuca.id, quantidade: 2 }] });
    expect(r.status).toBe(201);
    expect(Number(r.body.total)).toBe(4260 + 1300); // 0,355 × 12 000 = 4 260; 2 × 650
    const it = (await pool.query(`SELECT quantidade FROM itens_pedido WHERE pedido_id = $1 ORDER BY quantidade`, [r.body.id])).rows.map(x => Number(x.quantidade));
    expect(it).toEqual([0.355, 2]);
  });

  test('peso inválido (mais de 3 casas, zero, acima do limite) e unidades não inteiras ou negativas recusadas, sem gravar', async () => {
    const antes = Number((await pool.query(`SELECT COUNT(*) n FROM pedidos WHERE tenant_id = $1`, [A.tenantId])).rows[0].n);
    for (const [produto_id, quantidade] of [[picanha.id, 0.3555], [picanha.id, 0], [picanha.id, 1000], [cuca.id, 1.5], [cuca.id, -2], [cuca.id, 1001], [cuca.id, 'x']]) {
      const r = await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id, quantidade }] });
      expect([produto_id === picanha.id ? 'picanha' : 'cuca', quantidade, r.status]).toEqual([produto_id === picanha.id ? 'picanha' : 'cuca', quantidade, 400]);
    }
    expect(Number((await pool.query(`SELECT COUNT(*) n FROM pedidos WHERE tenant_id = $1`, [A.tenantId])).rows[0].n)).toBe(antes);
  });

  test('o portal não mostra nem aceita produtos ao peso', async () => {
    const pub = (m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', A.slug).send(body);
    const menu = (await pub('get', '/api/cliente/cardapio')).body;
    const ids = (menu.produtos || menu).map(p => p.id);
    expect(ids).toContain(cuca.id); expect(ids).not.toContain(picanha.id);
    const r = await pub('post', '/api/cliente/pedido-restaurante', { itens: [{ produto_id: picanha.id, quantidade: 1 }], metodo_pagamento: 'CASH' });
    expect(r.status).toBe(400); expect(r.body.erro).toMatch(/vende-se ao peso/);
  });

  test('a factura-recibo de uma conta com peso tem a quantidade em kg e bate certo com o total', async () => {
    expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
    const p = (await a('post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: picanha.id, quantidade: 1.234 }] })).body;
    await a('patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' });
    const rec = await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CASH', valor_entregue: 20000 });
    expect(rec.status).toBe(200);
    const fr = await a('post', '/api/caixa/faturar', { pedido_ids: [p.id] });
    expect(fr.status).toBe(201);
    const l = (await pool.query(`SELECT quantidade, total FROM fatura_linhas WHERE fatura_id = $1`, [fr.body.id])).rows;
    expect(l).toHaveLength(1);
    expect(Number(l[0].quantidade)).toBe(1.234);
    expect(Number(fr.body.total)).toBe(14808); // 1,234 × 12 000
  });
});

describe('Etiquetas', () => {
  test('folha em PDF; gera o código dos que não têm; limites e isolamento', async () => {
    const semCodigo = (await a('post', '/api/produtos', { nome: 'Água', preco: 300, categoria: 'BEBIDA' })).body;
    const r = await request(app).get(`/api/produtos/etiquetas.pdf?itens=${picanha.id}:3,${semCodigo.id}:25`)
      .set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${A.token}`).buffer(true).parse((res, cb) => { const d = []; res.on('data', c => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/pdf/);
    expect(r.body.slice(0, 4).toString()).toBe('%PDF');
    expect((r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(2); // 28 etiquetas = 2 folhas
    expect((await pool.query(`SELECT codigo_barras FROM produtos WHERE id = $1`, [semCodigo.id])).rows[0].codigo_barras).toMatch(/^2\d{12}$/);
    expect((await a('get', `/api/produtos/etiquetas.pdf?itens=${picanha.id}:101`)).status).toBe(400);
    expect((await a('get', '/api/produtos/etiquetas.pdf?itens=')).status).toBe(400);
    const deB = (await b('get', '/api/produtos')).body[0].id;
    expect((await a('get', `/api/produtos/etiquetas.pdf?itens=${deB}:1`)).status).toBe(404);
  });
});
