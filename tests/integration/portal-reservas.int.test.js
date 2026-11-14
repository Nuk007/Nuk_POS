'use strict';
/**
 * Integração (PostgreSQL real) — reservas de quarto pelo portal com os preços reais do estabelecimento,
 * confirmadas no POS por quem tem o perfil «vender quartos».
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../../server/app');

let A, B, vendedor, semPerfil, q1, q2, n = 1;
const ip = () => `10.15.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const pub = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Tenant-Slug', T.slug).send(body);
const com = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const daqui = min => new Date(Date.now() + min * 60e3).toISOString();

async function pessoa(T, vende) {
  const email = `p${n++}@${T.slug}.ao`;
  const id = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, nivel_acesso, pode_vender_quartos) VALUES ($1,$2,$3,'x','OPERADOR',$4) RETURNING id`, [T.tenantId, email, email, vende])).rows[0].id;
  return { token: jwt.sign({ id, email, nivel_acesso: 'OPERADOR', tenantId: T.tenantId }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-pres-a' });
  B = await criarTenantFixture({ slug: 'it-pres-b' });
  const ins = (num, tipo, p2, pn, pd) => pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [A.tenantId, num, tipo, p2, pn, pd]);
  q1 = (await ins('101', 'SUITE', 15000, 30000, 45000)).rows[0].id;
  q2 = (await ins('102', 'SUITE', 12000, 28000, 40000)).rows[0].id;
  await ins('201', 'STANDARD', 8000, 0, 25000); // sem preço de noite
  vendedor = await pessoa(A, true);
  semPerfil = await pessoa(A, false);
}, 60000);

test('tarifas: preços reais mais baixos por tipo; estabelecimento sem alojamento → 404', async () => {
  const r = await pub(A, 'get', '/api/cliente/hospedagem');
  expect(r.status).toBe(200);
  const suite = r.body.tipos.find(t => t.tipo === 'SUITE');
  expect(suite).toMatchObject({ quartos: 2, precos: { DUAS_HORAS: 12000, PERNOITE: 28000, DIARIA: 40000 } });
  expect(r.body.tipos.find(t => t.tipo === 'STANDARD').precos.PERNOITE).toBeNull();
  await pool.query(`UPDATE tenants SET modulos = '["restauracao"]' WHERE id = $1`, [B.tenantId]);
  expect((await pub(B, 'get', '/api/cliente/hospedagem')).status).toBe(404);
});

test('pedido: o valor vem do servidor (quarto livre mais barato); dados inválidos 400', async () => {
  expect((await pub(A, 'post', '/api/cliente/reserva-quarto', { tipo_quarto: 'SUITE', fracao: 'SEMANA', inicio: daqui(60), nome: 'Ana', telefone: '923000111' })).status).toBe(400);
  expect((await pub(A, 'post', '/api/cliente/reserva-quarto', { tipo_quarto: 'SUITE', fracao: 'PERNOITE', inicio: daqui(-60), nome: 'Ana', telefone: '923000111' })).status).toBe(400);
  expect((await pub(A, 'post', '/api/cliente/reserva-quarto', { tipo_quarto: 'SUITE', fracao: 'PERNOITE', inicio: daqui(60), nome: 'Ana', telefone: '12' })).status).toBe(400);
  const r = await pub(A, 'post', '/api/cliente/reserva-quarto', { tipo_quarto: 'SUITE', fracao: 'PERNOITE', inicio: daqui(120), nome: 'Ana Silva', telefone: '923000111', valor: 1 });
  expect(r.status).toBe(201);
  expect(r.body.valor).toBe(28000);
  expect(Number(r.body.solicitacao.valor_estimado)).toBe(28000);
  expect(r.body.solicitacao.nome_servico).toMatch(/^Quarto SUITE · Noite/);
});

test('POS: só o perfil «vender quartos» confirma; reserva no quarto escolhido; o 2.º clique não cria outra', async () => {
  const p = (await pub(A, 'post', '/api/cliente/reserva-quarto', { tipo_quarto: 'SUITE', fracao: 'DIARIA', inicio: daqui(24 * 60), nome: 'Bruno Costa', telefone: '923000222' })).body.solicitacao;
  const livres = await com(vendedor, 'get', `/api/solicitacoes-portal/${p.id}/quartos-livres`);
  expect(livres.body.quartos.map(q => q.preco)).toEqual([40000, 45000]);
  expect((await com(semPerfil, 'post', `/api/solicitacoes-portal/${p.id}/reservar`, { quarto_id: q2 })).status).toBe(403);
  const [a, b] = await Promise.all([
    com(vendedor, 'post', `/api/solicitacoes-portal/${p.id}/reservar`, { quarto_id: q2 }),
    com(vendedor, 'post', `/api/solicitacoes-portal/${p.id}/reservar`, { quarto_id: q2 }),
  ]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const ok = a.status === 200 ? a.body : b.body;
  expect(ok.solicitacao.status).toBe('CONFIRMADA');
  expect(ok.reserva).toMatchObject({ quarto_id: q2, status: 'CONFIRMADA', fracao: 'DIARIA' });
  expect(Number(ok.reserva.valor_total)).toBe(40000);
  expect(ok.link_whatsapp).toMatch(/^https:\/\/wa\.me\/244923000222\?text=.*102/);
  const n2 = (await pool.query(`SELECT COUNT(*)::int AS n FROM reservas WHERE quarto_id = $1`, [q2])).rows[0].n;
  expect(n2).toBe(1);
  // o mesmo período já não mostra o 102 como livre
  const outro = (await pub(A, 'post', '/api/cliente/reserva-quarto', { tipo_quarto: 'SUITE', fracao: 'DIARIA', inicio: ok.reserva.checkin, nome: 'Carla', telefone: '923000333' })).body;
  expect(outro.valor).toBe(45000);
});

test('sem quartos livres → 409; outro estabelecimento não vê nem reserva o pedido', async () => {
  const ini = daqui(3 * 24 * 60);
  for (const qid of [q1, q2]) {
    await pool.query(`INSERT INTO reservas (tenant_id, quarto_id, fracao, checkin, checkout, status, valor_total) VALUES ($1,$2,'DIARIA',$3,$3::timestamptz + INTERVAL '24 hours','CONFIRMADA',1)`, [A.tenantId, qid, ini]);
  }
  const r = await pub(A, 'post', '/api/cliente/reserva-quarto', { tipo_quarto: 'SUITE', fracao: 'PERNOITE', inicio: ini, nome: 'Dina', telefone: '923000444' });
  expect(r.status).toBe(409);
  expect(r.body.codigo).toBe('SEM_QUARTOS_LIVRES');
  const p = (await pub(A, 'post', '/api/cliente/reserva-quarto', { tipo_quarto: 'SUITE', fracao: 'DUAS_HORAS', inicio: daqui(7 * 24 * 60), nome: 'Eva', telefone: '923000555' })).body.solicitacao;
  expect((await com(B, 'get', `/api/solicitacoes-portal/${p.id}/quartos-livres`)).status).toBe(404);
  // quarto de outro tipo → 409
  const std = (await pool.query(`SELECT id FROM quartos WHERE tenant_id=$1 AND numero='201'`, [A.tenantId])).rows[0].id;
  expect((await com(vendedor, 'post', `/api/solicitacoes-portal/${p.id}/reservar`, { quarto_id: std })).status).toBe(409);
});
