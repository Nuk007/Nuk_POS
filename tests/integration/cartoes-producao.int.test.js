'use strict';
/**
 * Integração — produção de cartões no Caixa (21/11/2026, pedido do dono): com um cartão esgotado, quem está no Caixa
 * pede um lote com as credenciais do Administrador ou de quem tem o perfil «Imprimir cartões»; imprime-se sempre em
 * folhas A4 completas (10 por folha) e a folha sai logo em PDF.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, ipN = 1, caixa, gerente, operadorB;
const ip = () => `10.68.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const pdf = (T, body) => request(app).post('/api/caixa/cartoes/producao').set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`)
  .buffer(true).parse((res, cb) => { const b = []; res.on('data', d => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b))); }).send(body);

async function funcionario(T, nome, nivel, extra = {}) {
  const email = `${nome.toLowerCase()}@${T.slug}.ao`;
  const r = await pool.query(
    `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, nivel_acesso, imprime_cartoes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [T.tenantId, nome, email, await bcrypt.hash('246810', 4), nivel, !!extra.imprime]);
  const id = r.rows[0].id;
  return { id, email, password: '246810', tenantId: T.tenantId, token: gerarToken({ id, email, nivel_acesso: nivel, tenantId: T.tenantId }) };
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-cprod' });
  B = await criarTenantFixture({ slug: 'it-cprod-b' });
  caixa = await funcionario(A, 'Caixa', 'OPERADOR');
  gerente = await funcionario(A, 'Gerente', 'GERENTE');
  operadorB = await funcionario(B, 'Outro', 'OPERADOR', { imprime: true });
  expect((await op(A, 'get', '/api/caixa/cartoes/tipos')).status).toBe(200); // semeia os cartões do estabelecimento
}, 60000);

describe('Autorização da produção no Caixa', () => {
  test('credenciais erradas → 403 (nunca 401); sem o perfil → 403; o Administrador autoriza', async () => {
    const erradas = await op(caixa, 'post', '/api/caixa/cartoes/producao/autorizar', { email: A.email, palavra_passe: '000000' });
    expect(erradas.status).toBe(403);
    expect(erradas.body.codigo).toBe('CREDENCIAIS_INVALIDAS');
    expect((await op(caixa, 'post', '/api/caixa/cartoes/producao/autorizar', { email: 'ninguem@x.ao', palavra_passe: '123456' })).body.codigo).toBe('CREDENCIAIS_INVALIDAS');
    expect((await op(caixa, 'post', '/api/caixa/cartoes/producao/autorizar', {})).status).toBe(400);
    const semPerfil = await op(caixa, 'post', '/api/caixa/cartoes/producao/autorizar', { email: gerente.email, palavra_passe: gerente.password });
    expect(semPerfil.status).toBe(403);
    expect(semPerfil.body.codigo).toBe('SEM_PERFIL_CARTOES');
    // de outro estabelecimento, mesmo com o perfil, não autoriza aqui
    expect((await op(caixa, 'post', '/api/caixa/cartoes/producao/autorizar', { email: operadorB.email, palavra_passe: operadorB.password })).body.codigo).toBe('CREDENCIAIS_INVALIDAS');
    const ok = await op(caixa, 'post', '/api/caixa/cartoes/producao/autorizar', { email: A.email.toUpperCase(), palavra_passe: A.password });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ nome: `Admin ${A.slug}` });
  });

  test('o Administrador dá o perfil; um gerente não o pode dar nem tirar; com o perfil autoriza', async () => {
    expect((await op(gerente, 'put', `/api/funcionarios/${caixa.id}`, { imprime_cartoes: true })).status).toBe(403);
    // e no próprio serviço (defesa em profundidade): só um Administrador dá ou tira o perfil; o resto edita-se sem ele
    const fsvc = require('../../server/services/funcionarios.service');
    await expect(fsvc.actualizar({ tenantId: A.tenantId, actorId: gerente.id, id: caixa.id, imprime_cartoes: true })).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/Só um Administrador/) });
    expect((await fsvc.actualizar({ tenantId: A.tenantId, actorId: gerente.id, id: caixa.id, cargo: 'Caixa', imprime_cartoes: false })).imprime_cartoes).toBe(false);
    const dado = await op(A, 'put', `/api/funcionarios/${gerente.id}`, { imprime_cartoes: true });
    expect(dado.status).toBe(200);
    expect(dado.body.imprime_cartoes).toBe(true);
    expect((await op(caixa, 'post', '/api/caixa/cartoes/producao/autorizar', { email: gerente.email, palavra_passe: gerente.password })).status).toBe(200);
    expect((await op(gerente, 'put', `/api/funcionarios/${gerente.id}`, { imprime_cartoes: false })).status).toBe(403);
  });
});

describe('Lote pedido no Caixa', () => {
  test('folhas completas: 13 → reduzir 10 ou avançar 20, nada é gerado; cartão não configurado → 404', async () => {
    const r = await op(caixa, 'post', '/api/caixa/cartoes/producao', { email: A.email, palavra_passe: A.password, valor: 3000, quantidade: 13 });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ codigo: 'FOLHAS_INCOMPLETAS', reduzir: 10, avancar: 20 });
    expect((await op(caixa, 'post', '/api/caixa/cartoes/producao', { email: A.email, palavra_passe: A.password, valor: 3000, quantidade: 4 })).body).toMatchObject({ reduzir: null, avancar: 10 });
    expect((await op(caixa, 'post', '/api/caixa/cartoes/producao', { email: A.email, palavra_passe: A.password, valor: 4321, quantidade: 10 })).status).toBe(404);
    expect((await op(caixa, 'post', '/api/caixa/cartoes/producao', { email: A.email, palavra_passe: '000000', valor: 3000, quantidade: 10 })).status).toBe(403);
    expect(Number((await pool.query(`SELECT COUNT(*) AS n FROM cartoes_lotes WHERE tenant_id = $1`, [A.tenantId])).rows[0].n)).toBe(0);
  });

  test('avança com 2 folhas: devolve o PDF, grava quem autorizou e quem pediu, e o botão volta a ter cartões', async () => {
    const r = await pdf(caixa, { email: gerente.email, palavra_passe: gerente.password, valor: 3000, quantidade: 20 });
    expect(r.status).toBe(201);
    expect(r.headers['content-type']).toMatch(/application\/pdf/);
    expect(r.body.slice(0, 4).toString()).toBe('%PDF');
    expect(r.headers).toMatchObject({ 'x-lote-numero': '1', 'x-lote-quantidade': '20', 'x-lote-folhas': '2' });
    const l = (await pool.query(`SELECT criado_por, pedido_por, quantidade FROM cartoes_lotes WHERE id = $1`, [r.headers['x-lote-id']])).rows[0];
    expect(l).toEqual({ criado_por: gerente.id, pedido_por: caixa.id, quantidade: 20 });
    expect((await op(caixa, 'get', '/api/caixa/cartoes/tipos')).body.find(t => Number(t.valor) === 3000).por_vender).toBe(20);
    const lotes = (await op(A, 'get', '/api/caixa/cartoes/lotes')).body;
    expect(lotes[0]).toMatchObject({ criado_por_nome: 'Gerente', pedido_por_nome: 'Caixa', quantidade: 20 });
    // os cartões nascem por vender e sem saldo, como os de Configurações
    const c = (await pool.query(`SELECT COUNT(*) FILTER (WHERE estado = 'POR_VENDER' AND saldo = 0) AS n FROM cartoes_consumo WHERE lote_id = $1`, [r.headers['x-lote-id']])).rows[0];
    expect(Number(c.n)).toBe(20);
  });

  test('perfil retirado vale logo: o mesmo gerente deixa de autorizar', async () => {
    expect((await op(A, 'put', `/api/funcionarios/${gerente.id}`, { imprime_cartoes: false })).status).toBe(200);
    expect((await op(caixa, 'post', '/api/caixa/cartoes/producao', { email: gerente.email, palavra_passe: gerente.password, valor: 3000, quantidade: 10 })).body.codigo).toBe('SEM_PERFIL_CARTOES');
  });
});
