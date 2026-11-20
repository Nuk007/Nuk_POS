'use strict';
/**
 * Integração — rasto do caixa: numeração sem buracos, cadeia SHA-256, imutabilidade (movimentos, sessões fechadas,
 * movimentos de cartão), pesquisa, CSV, verificação e rasto de cartão. Base de dados real.
 */
const request = require('supertest');
const { app } = require('../../server/app');
const { venderCartaoNovo } = require('./helpers-cartoes');

let A, B, OP, ipN = 1, cuca;
const ip = () => `10.68.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
const op = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const a = (m, url, body) => op(A, m, url, body);
const linhas = (sql, p) => pool.query(sql, p).then(r => r.rows);

async function pedidoFechado(T, qtd = 1) {
  const p = await op(T, 'post', '/api/pedidos', { origem: 'BALCAO', itens: [{ produto_id: cuca, quantidade: qtd }] });
  expect(p.status).toBe(201);
  expect((await op(T, 'patch', `/api/pedidos/${p.body.id}/status`, { status: 'FECHADO' })).status).toBe(200);
  return p.body;
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-audit' });
  B = await criarTenantFixture({ slug: 'it-audit-b' });
  OP = await criarTenantFixture({ slug: 'it-audit-op', nivel: 'OPERADOR' });
  cuca = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',600,'BEBIDA',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
  await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',600,'BEBIDA',true,true)`, [B.tenantId]);
  expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 1000 })).status).toBe(201);
  expect((await op(B, 'post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
}, 60000);

describe('Livro do caixa numerado e encadeado', () => {
  let cartao;
  test('cada movimento recebe o n.º seguinte do estabelecimento e liga ao anterior', async () => {
    cartao = (await venderCartaoNovo(op, A, 3000)).body;
    const p = await pedidoFechado(A, 2);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p.id], metodo: 'CARTAO', codigo_cartao: cartao.codigo })).status).toBe(200);
    const p2 = await pedidoFechado(A, 1);
    expect((await a('post', '/api/caixa/receber', { pedido_ids: [p2.id], metodo: 'TPA' })).status).toBe(200);
    const m = await linhas(`SELECT numero, hash, hash_anterior FROM caixa_movimentos WHERE tenant_id=$1 ORDER BY numero`, [A.tenantId]);
    expect(m.map(x => Number(x.numero))).toEqual([1, 2, 3]);
    expect(m[0].hash_anterior).toBeNull();
    expect(m[1].hash_anterior).toBe(m[0].hash);
    expect(m[2].hash_anterior).toBe(m[1].hash);
    m.forEach(x => expect(x.hash).toMatch(/^[0-9a-f]{64}$/));
    // a numeração é por estabelecimento
    await venderCartaoNovo(op, B, 2000);
    expect((await linhas(`SELECT numero FROM caixa_movimentos WHERE tenant_id=$1`, [B.tenantId]))[0].numero).toBe('1');
  });

  test('movimentos simultâneos não repetem nem saltam números', async () => {
    await Promise.all(Array.from({ length: 6 }, () => venderCartaoNovo(op, A, 2000)));
    const m = await linhas(`SELECT numero FROM caixa_movimentos WHERE tenant_id=$1 ORDER BY numero`, [A.tenantId]);
    expect(m.map(x => Number(x.numero))).toEqual(Array.from({ length: m.length }, (_, i) => i + 1));
    expect((await a('get', '/api/caixa/auditoria/verificar')).body.ok).toBe(true);
  });

  test('ninguém altera nem apaga um movimento, nem directamente na base de dados', async () => {
    await expect(pool.query(`UPDATE caixa_movimentos SET valor = 1 WHERE tenant_id=$1 AND numero=1`, [A.tenantId])).rejects.toThrow(/não pode ser alterado/);
    await expect(pool.query(`DELETE FROM caixa_movimentos WHERE tenant_id=$1 AND numero=1`, [A.tenantId])).rejects.toThrow(/não pode ser alterado/);
    await expect(pool.query(`UPDATE movimentos_cartao SET valor = 1 WHERE cartao_id=$1`, [cartao.id])).rejects.toThrow(/não pode ser alterado/);
    await expect(pool.query(`DELETE FROM movimentos_cartao WHERE cartao_id=$1`, [cartao.id])).rejects.toThrow(/não pode ser alterado/);
    await expect(pool.query(`UPDATE caixa_sessoes SET fundo_inicial = 0 WHERE tenant_id=$1`, [A.tenantId])).rejects.toThrow(/não podem ser alterados/);
    await expect(pool.query(`DELETE FROM caixa_sessoes WHERE tenant_id=$1`, [A.tenantId])).rejects.toThrow(/não pode ser apagada/);
  });

  test('a verificação apanha alterações feitas por fora (trigger desligado) e saldos de cartão mexidos', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`ALTER TABLE caixa_movimentos DISABLE TRIGGER trg_caixa_mov_imutavel`);
      await c.query(`UPDATE caixa_movimentos SET valor = valor + 1000 WHERE tenant_id=$1 AND numero=2`, [A.tenantId]);
      await c.query(`DELETE FROM caixa_movimentos WHERE tenant_id=$1 AND numero=4`, [A.tenantId]);
      await c.query(`ALTER TABLE caixa_movimentos ENABLE TRIGGER trg_caixa_mov_imutavel`);
      await c.query(`UPDATE cartoes_consumo SET saldo = saldo + 500 WHERE id=$1`, [cartao.id]);
      // a rota usa o pool: ver o estado dentro desta transacção exige a mesma ligação → usa-se o serviço com o cliente
      const svc = require('../../server/services/caixa-auditoria.service');
      const db = require('../../server/db');
      const original = db.pool.query.bind(db.pool);
      db.pool.query = (...x) => c.query(...x);
      let r;
      try { r = await svc.verificar({ tenantId: A.tenantId }); } finally { db.pool.query = original; }
      expect(r.ok).toBe(false);
      expect(r.problemas).toEqual(expect.arrayContaining([
        expect.objectContaining({ tipo: 'MOVIMENTO', numero: 2, motivo: 'ALTERADO' }),
        expect.objectContaining({ tipo: 'MOVIMENTO', numero: 5, motivo: 'FALTA_MOVIMENTO' }),
        expect.objectContaining({ tipo: 'CARTAO', codigo: cartao.codigo }),
      ]));
    } finally { await c.query('ROLLBACK'); c.release(); }
    expect((await a('get', '/api/caixa/auditoria/verificar')).body.ok).toBe(true); // nada ficou alterado
  });

  test('fechar o caixa continua a funcionar; depois a sessão fica selada', async () => {
    const f = await a('post', '/api/caixa/fechar', { contado: 1000 + 3000 + 6 * 2000 });
    expect(f.status).toBe(200);
    await expect(pool.query(`UPDATE caixa_sessoes SET contado = 0 WHERE tenant_id=$1`, [A.tenantId])).rejects.toThrow(/não podem ser alterados/);
    expect((await a('get', '/api/caixa/auditoria/verificar')).body).toMatchObject({ ok: true, problemas: [] });
    expect((await a('post', '/api/caixa/abrir', { fundo_inicial: 0 })).status).toBe(201);
  });
});

describe('Pesquisa e rasto', () => {
  test('só a chefia vê; filtros validados; isolamento entre estabelecimentos', async () => {
    expect((await op(OP, 'get', '/api/caixa/auditoria/movimentos')).status).toBe(403);
    expect((await op(OP, 'get', '/api/caixa/auditoria/verificar')).status).toBe(403);
    expect((await a('get', '/api/caixa/auditoria/movimentos?tipo=ROUBO')).status).toBe(400);
    expect((await a('get', '/api/caixa/auditoria/movimentos?metodo=OURO')).status).toBe(400);
    expect((await a('get', '/api/caixa/auditoria/movimentos?de=2026-13-01')).status).toBe(400);
    expect((await a('get', '/api/caixa/auditoria/movimentos?sessao_id=nao-uuid')).status).toBe(400);
    const bCodigo = (await linhas(`SELECT codigo FROM cartoes_consumo WHERE tenant_id=$1 LIMIT 1`, [B.tenantId]))[0].codigo;
    expect((await a('get', `/api/caixa/auditoria/movimentos?cartao=${bCodigo}`)).status).toBe(404);
    const rb = await op(B, 'get', '/api/caixa/auditoria/movimentos');
    expect(rb.body.data.every(m => m.numero === '1')).toBe(true);
  });

  test('pesquisa de hoje com totais, por tipo/forma, por número e por cartão (sem período)', async () => {
    const r = await a('get', '/api/caixa/auditoria/movimentos?limit=5');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(9);
    expect(r.body.data).toHaveLength(5);
    expect(Number(r.body.data[0].numero)).toBe(9); // mais recente primeiro
    expect(r.body.totais.entradas).toBe(3000 + 1200 + 600 + 6 * 2000);
    const tpa = await a('get', '/api/caixa/auditoria/movimentos?metodo=TPA');
    expect(tpa.body.total).toBe(1);
    expect(tpa.body.data[0]).toMatchObject({ tipo: 'RECEBIMENTO', metodo: 'TPA' });
    expect(tpa.body.data[0].referencia).toMatch(/Balcão/);
    expect(tpa.body.data[0].operador).toBeTruthy();
    const n2 = await a('get', '/api/caixa/auditoria/movimentos?numero=2&de=2020-01-01&ate=2020-01-01');
    expect(n2.body.total).toBe(0); // com período explícito, respeita-o
    const n1 = await a('get', '/api/caixa/auditoria/movimentos?numero=1');
    expect(n1.body.data[0]).toMatchObject({ tipo: 'CARTAO_VENDA' });
    const codigo = n1.body.data[0].cartao_codigo;
    const porCartao = await a('get', `/api/caixa/auditoria/movimentos?cartao=${codigo.toLowerCase()}`);
    expect(porCartao.body.data.map(m => m.tipo).sort()).toEqual(['CARTAO_VENDA', 'RECEBIMENTO']);
  });

  test('rasto do cartão: venda, consumo e saldo', async () => {
    const codigo = (await a('get', '/api/caixa/auditoria/movimentos?numero=1')).body.data[0].cartao_codigo;
    const r = await a('get', `/api/caixa/auditoria/cartoes/${codigo}`);
    expect(r.status).toBe(200);
    expect(Number(r.body.cartao.saldo)).toBe(1800);
    expect(r.body.cartao.vendido_por_nome).toBeTruthy();
    expect(r.body.movimentos.map(m => m.tipo)).toEqual(['VENDA', 'CONSUMO']);
    expect(r.body.caixa).toHaveLength(2);
    expect((await op(B, 'get', `/api/caixa/auditoria/cartoes/${codigo}`)).status).toBe(404);
  });

  test('CSV com cabeçalho, separador «;» e todos os movimentos do filtro', async () => {
    const r = await a('get', '/api/caixa/auditoria/movimentos.csv').buffer(true).parse((res, cb) => { const b = []; res.on('data', d => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b).toString('utf8'))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    const ls = r.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(ls[0]).toMatch(/^N\.º;Data e hora;Tipo;Forma;Valor \(Kz\)/);
    expect(ls).toHaveLength(1 + 9);
    expect(ls[1].split(';')[0]).toBe('1');
    expect(ls[1]).toContain('3000,00');
  });

  test('apagar o estabelecimento continua possível (cascata)', async () => {
    const C = await criarTenantFixture({ slug: 'it-audit-del' });
    await op(C, 'post', '/api/caixa/abrir', { fundo_inicial: 0 });
    await venderCartaoNovo(op, C, 2000);
    await op(C, 'post', '/api/caixa/fechar', { contado: 2000 });
    await pool.query(`DELETE FROM tenants WHERE id=$1`, [C.tenantId]);
    expect((await linhas(`SELECT COUNT(*)::int AS n FROM caixa_movimentos WHERE tenant_id=$1`, [C.tenantId]))[0].n).toBe(0);
  });
});

describe('Arranque (initDB corre em cada arranque)', () => {
  test('voltar a aplicar o SQL é inofensivo e sela movimentos antigos sem número, pela ordem em que aconteceram', async () => {
    const D = await criarTenantFixture({ slug: 'it-audit-legado' });
    const s = (await pool.query(`INSERT INTO caixa_sessoes (tenant_id, fundo_inicial) VALUES ($1, 0) RETURNING id`, [D.tenantId])).rows[0].id;
    const c = await pool.connect();
    try {
      // como estavam antes desta versão: sem número nem hash
      await c.query(`ALTER TABLE caixa_movimentos DISABLE TRIGGER trg_caixa_mov_encadear`);
      for (const [v, t] of [[500, '2026-11-01T10:00:00Z'], [700, '2026-11-01T09:00:00Z']]) {
        await c.query(`INSERT INTO caixa_movimentos (tenant_id, sessao_id, tipo, metodo, valor, criado_em) VALUES ($1,$2,'RECEBIMENTO','CASH',$3,$4)`, [D.tenantId, s, v, t]);
      }
      await c.query(`ALTER TABLE caixa_movimentos ENABLE TRIGGER trg_caixa_mov_encadear`);
    } finally { c.release(); }
    for (const sql of require('../../server/migrations-data/caixa-auditoria')) await pool.query(sql);
    for (const sql of require('../../server/migrations-data/caixa-auditoria')) await pool.query(sql);
    const m = await linhas(`SELECT numero, valor, hash_anterior, hash FROM caixa_movimentos WHERE tenant_id=$1 ORDER BY numero`, [D.tenantId]);
    expect(m.map(x => [Number(x.numero), Number(x.valor)])).toEqual([[1, 700], [2, 500]]);
    expect(m[1].hash_anterior).toBe(m[0].hash);
    expect((await op(D, 'get', '/api/caixa/auditoria/verificar')).body.ok).toBe(true);
    // e o seguinte continua a cadeia
    await venderCartaoNovo(op, D, 2000);
    expect((await linhas(`SELECT MAX(numero) AS n FROM caixa_movimentos WHERE tenant_id=$1`, [D.tenantId]))[0].n).toBe('3');
    expect((await op(D, 'get', '/api/caixa/auditoria/verificar')).body.ok).toBe(true);
  });
});

