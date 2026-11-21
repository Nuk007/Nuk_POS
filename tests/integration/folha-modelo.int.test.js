'use strict';
/**
 * Integração (PostgreSQL real) — modelo da Folha de Caixa em branco (21/11/2026): padrão a partir da ementa,
 * gravar/validar/repor só pelo ADMIN, PDF com os dados do estabelecimento e isolamento entre estabelecimentos.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, GER, n = 1;
const ip = () => `10.32.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const pdfDe = (T, url) => call(T, 'get', url).buffer(true).parse((res, cb) => { const b = []; res.on('data', c => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-fmodelo-a' });
  B = await criarTenantFixture({ slug: 'it-fmodelo-b' });
  const hash = await bcrypt.hash('123456', 4);
  const g = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Ger','ger@it-fmodelo.ao',$2,'Gerente','GERENTE') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  GER = { token: gerarToken({ id: g, email: 'ger@it-fmodelo.ao', nivel_acesso: 'GERENTE', tenantId: A.tenantId }) };
  const ins = (nome, preco, cat, ativo = true) => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,$2,$3,$4,true,$5)`, [A.tenantId, nome, preco, cat, ativo]);
  await ins('Cuca garrafa', 500, 'BEBIDA');
  await ins('Frango assado', 10000, 'CHURRASCO');
  await ins('Piscina adulto', 4000, 'PISCINA');
  await ins('Produto antigo', 1, 'BEBIDA', false);
  await pool.query(`INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,'telefone','+244 930 742 180'), ($1,'nome_estabelecimento','Clube 3D Resort')
                    ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = EXCLUDED.valor`, [A.tenantId]);
}, 60000);

test('sem modelo gravado, o padrão vem da ementa (só produtos activos), agrupado como na Folha do dia', async () => {
  const r = await call(GER, 'get', '/api/caixa/folha/modelo');
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ configurado: false, titulo: 'Folha de Caixa', controlo: true, areas_brancos: 2 });
  const g = Object.fromEntries(r.body.grupos.map(x => [x.grupo, x]));
  expect(r.body.grupos.map(x => x.letra)).toEqual(['F', 'G', 'H', 'I', 'E']);
  expect(g.BEBIDAS.itens).toEqual([{ nome: 'Cuca garrafa', preco: 500 }]);
  expect(g.COMIDAS.itens).toEqual([{ nome: 'Frango assado', preco: 10000 }]);
  expect(g.PISCINA.itens).toEqual([{ nome: 'Piscina adulto', preco: 4000 }]);
  expect(g.QUARTOS).toMatchObject({ itens: [], brancos: 5 });
});

test('gravar: só ADMIN; acrescenta e retira itens; validações', async () => {
  const base = (await call(A, 'get', '/api/caixa/folha/modelo')).body;
  const modelo = JSON.parse(JSON.stringify(base));
  modelo.titulo = 'Folha de Caixa Clube 3D';
  modelo.grupos[0].itens.push({ nome: 'Eka', preco: 500 }, { nome: '  Smirnoff   ice ', preco: '1000' });
  modelo.grupos[2].itens = [];                                   // retira a piscina adulto
  modelo.grupos[3].itens = [{ nome: 'Quarto — noite', preco: null }];
  modelo.grupos[4].oculto = true;
  modelo.assinaturas = ['Entregou', 'Verificou'];
  expect((await call(GER, 'put', '/api/caixa/folha/modelo', { modelo })).status).toBe(403);
  const g = await call(A, 'put', '/api/caixa/folha/modelo', { modelo });
  expect(g.status).toBe(200);
  expect(g.body.configurado).toBe(true);
  const lido = (await call(GER, 'get', '/api/caixa/folha/modelo')).body;
  expect(lido.titulo).toBe('Folha de Caixa Clube 3D');
  expect(lido.grupos[0].itens.map(i => i.nome)).toEqual(['Cuca garrafa', 'Eka', 'Smirnoff ice']);
  expect(lido.grupos[0].itens[2].preco).toBe(1000);
  expect(lido.grupos[2].itens).toEqual([]);
  expect(lido.grupos[3].itens).toEqual([{ nome: 'Quarto — noite', preco: null }]);
  expect(lido.grupos[4].oculto).toBe(true);
  expect(lido.assinaturas).toEqual(['Entregou', 'Verificou']);

  const mau = (f) => { const x = JSON.parse(JSON.stringify(modelo)); f(x); return call(A, 'put', '/api/caixa/folha/modelo', { modelo: x }); };
  expect((await mau(x => { x.grupos[0].itens.push({ nome: '', preco: 1 }); })).status).toBe(400);
  expect((await mau(x => { x.grupos[0].itens.push({ nome: 'X', preco: -5 }); })).status).toBe(400);
  expect((await mau(x => { x.grupos[1].brancos = 11; })).status).toBe(400);
  expect((await mau(x => { x.areas_brancos = 0; })).status).toBe(400);
  expect((await mau(x => { x.assinaturas = ['a', 'b', 'c', 'd', 'e']; })).status).toBe(400);
  expect((await mau(x => { x.grupos[0].itens = Array.from({ length: 41 }, (_, i) => ({ nome: `P${i}`, preco: 1 })); })).status).toBe(400);
  expect((await call(A, 'put', '/api/caixa/folha/modelo', { modelo: 'x' })).status).toBe(400);
  // proposta da ementa não grava nada
  const prop = (await call(A, 'get', '/api/caixa/folha/modelo?ementa=1')).body;
  expect(prop.configurado).toBe(false);
  expect((await call(A, 'get', '/api/caixa/folha/modelo')).body.titulo).toBe('Folha de Caixa Clube 3D');
});

test('PDF em branco (A4, duas páginas) com os dados do estabelecimento; outro estabelecimento não vê o modelo', async () => {
  const pdf = await pdfDe(GER, '/api/caixa/folha/modelo.pdf');
  expect(pdf.status).toBe(200);
  expect(pdf.headers['content-type']).toMatch(/pdf/);
  expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
  expect((pdf.body.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(2);
  if (process.env.GUARDAR_PDF) require('fs').writeFileSync(process.env.GUARDAR_PDF, pdf.body);
  const mb = (await call(B, 'get', '/api/caixa/folha/modelo')).body;
  expect(mb.configurado).toBe(false);
  expect(mb.grupos.every(g => g.itens.length === 0)).toBe(true);
  expect((await pdfDe(B, '/api/caixa/folha/modelo.pdf')).status).toBe(200);
});

test('repor volta ao padrão da ementa', async () => {
  const r = await call(A, 'put', '/api/caixa/folha/modelo', { repor: true });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ configurado: false, titulo: 'Folha de Caixa' });
});
