'use strict';
/**
 * Integração (PostgreSQL real) — módulo fiscal: numeração por estabelecimento, linhas, FT/FR/NC e imutabilidade.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');

let A, B, OP, prodA, prodB, n = 1;
const ip = () => `10.8.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, metodo, url, corpo) => request(app)[metodo](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);

async function pedidoFechado(T, prod, { qtd = 2, preco = 4500, total, pago = false } = {}) {
  const tot = total ?? qtd * preco;
  const p = (await pool.query(
    `INSERT INTO pedidos (tenant_id, status, total, metodo_pagamento, pago_em) VALUES ($1,'FECHADO',$2,'TPA',$3) RETURNING id`,
    [T.tenantId, tot, pago ? new Date() : null])).rows[0].id;
  await pool.query(`INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES ($1,$2,$3,$4)`, [p, prod, qtd, preco]);
  return p;
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-fiscal-a' });
  B = await criarTenantFixture({ slug: 'it-fiscal-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(
    `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Operador','op@it-fiscal-a.ao',$2,'Caixa','OPERADOR') RETURNING id`,
    [A.tenantId, hash])).rows[0].id;
  OP = { token: gerarToken({ id: op, email: 'op@it-fiscal-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
  const ins = t => pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Picanha',4500,'CHURRASCO',true,true) RETURNING id`, [t]);
  prodA = (await ins(A.tenantId)).rows[0].id;
  prodB = (await ins(B.tenantId)).rows[0].id;
}, 60000);

describe('Numeração por estabelecimento', () => {
  test('dois estabelecimentos emitem cada um a sua FT n.º 1 (antes falhava com «Factura duplicada»)', async () => {
    const a = await call(A, 'post', '/api/financeiro/faturas', { total_manual: 1000, descricao: 'Serviço A' });
    const b = await call(B, 'post', '/api/financeiro/faturas', { total_manual: 1000, descricao: 'Serviço B' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.numero_fatura).toBe(b.body.numero_fatura);
    expect(a.body.sequencial).toBe(1);
  });

  test('FT e FR têm séries independentes, sem buracos mesmo em simultâneo', async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => call(B, 'post', '/api/financeiro/faturas', { total_manual: 500, tipo: i % 2 ? 'FR' : 'FT' })));
    expect(rs.every(r => r.status === 201)).toBe(true);
    for (const serie of ['FT', 'FR']) {
      const seq = (await pool.query(`SELECT sequencial FROM faturas WHERE tenant_id=$1 AND serie=$2 ORDER BY sequencial`, [B.tenantId, serie])).rows.map(r => r.sequencial);
      expect(seq).toEqual(seq.map((_, i) => i + 1));
    }
  });

  test('cada documento encadeia a assinatura do anterior da mesma série', async () => {
    const r = (await pool.query(`SELECT hash_assinatura FROM faturas WHERE tenant_id=$1 AND serie='FT' ORDER BY sequencial`, [B.tenantId])).rows;
    expect(r.length).toBeGreaterThan(1);
    expect(new Set(r.map(x => x.hash_assinatura)).size).toBe(r.length);
  });
});

describe('Linhas e totais', () => {
  test('a factura de um pedido guarda as linhas; base + IVA = total; desconto do pedido aparece no documento', async () => {
    const p = await pedidoFechado(A, prodA, { qtd: 2, preco: 4500, total: 8100 }); // 9 000 com 900 de desconto
    const r = await call(A, 'post', '/api/financeiro/faturas', { pedido_id: p, nif_cliente: '5417000000', nome_cliente: 'Cliente' });
    expect(r.status).toBe(201);
    expect(r.body.linhas).toHaveLength(1);
    const l = r.body.linhas[0];
    expect([l.descricao, Number(l.quantidade), Number(l.preco_unitario), Number(l.total)]).toEqual(['Picanha', 2, 4500, 9000]);
    expect(Number(r.body.total)).toBe(8100);
    expect(Number(r.body.desconto)).toBe(900);
    expect(Number(r.body.total_sem_iva) + Number(r.body.iva)).toBeCloseTo(8100, 2);
    const doc = await call(A, 'get', `/api/financeiro/faturas/${r.body.id}`);
    expect(doc.status).toBe(200);
    expect(doc.body.linhas).toHaveLength(1);
  });

  test('reserva: uma linha de alojamento com o número do quarto', async () => {
    const q = (await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,'101','STANDARD',8000,25000,40000) RETURNING id`, [A.tenantId])).rows[0].id;
    const rv = (await pool.query(
      `INSERT INTO reservas (tenant_id, quarto_id, nome_hospede, fracao, checkin, checkout, status, valor_total)
       VALUES ($1,$2,'Hóspede','PERNOITE',NOW(),NOW()+INTERVAL '12 hours','CHECKIN',25000) RETURNING id`, [A.tenantId, q])).rows[0].id;
    const r = await call(A, 'post', '/api/financeiro/faturas', { reserva_id: rv, tipo: 'FR' });
    expect(r.status).toBe(201);
    expect(r.body.tipo_documento).toBe('FR');
    expect(r.body.linhas[0].descricao).toMatch(/Quarto 101/);
    expect((await call(A, 'post', '/api/financeiro/faturas', { reserva_id: rv })).status).toBe(409);
  });

  test('IVA a 0% exige motivo de isenção configurado', async () => {
    await pool.query(`INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,'iva_padrao','0')`, [B.tenantId]);
    try {
      const sem = await call(B, 'post', '/api/financeiro/faturas', { total_manual: 1000 });
      expect(sem.status).toBe(409);
      await pool.query(`INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,'motivo_isencao_iva','Regime de não sujeição')`, [B.tenantId]);
      const com = await call(B, 'post', '/api/financeiro/faturas', { total_manual: 1000 });
      expect(com.status).toBe(201);
      expect(Number(com.body.iva)).toBe(0);
      expect(com.body.linhas[0].motivo_isencao).toBe('Regime de não sujeição');
    } finally {
      await pool.query(`DELETE FROM configuracoes WHERE tenant_id=$1 AND chave IN ('iva_padrao','motivo_isencao_iva')`, [B.tenantId]);
    }
  });
});

describe('Regras de emissão', () => {
  test('factura-recibo só para conta já recebida no Caixa', async () => {
    const porReceber = await pedidoFechado(A, prodA);
    expect((await call(A, 'post', '/api/financeiro/faturas', { pedido_id: porReceber, tipo: 'FR' })).status).toBe(409);
    const recebido = await pedidoFechado(A, prodA, { pago: true });
    expect((await call(A, 'post', '/api/financeiro/faturas', { pedido_id: recebido, tipo: 'FR' })).status).toBe(201);
  });

  test('isolamento: não se factura o pedido nem se usa o cliente de outro estabelecimento', async () => {
    const pB = await pedidoFechado(B, prodB);
    expect((await call(A, 'post', '/api/financeiro/faturas', { pedido_id: pB })).status).toBe(404);
    const cB = (await pool.query(`INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1,'Cliente B','+244911000001') RETURNING id`, [B.tenantId])).rows[0].id;
    expect((await call(A, 'post', '/api/financeiro/faturas', { total_manual: 1000, cliente_id: cB })).status).toBe(404);
  });

  test('tipo inválido e NIF inválido → 400', async () => {
    expect((await call(A, 'post', '/api/financeiro/faturas', { total_manual: 1000, tipo: 'NC' })).status).toBe(400);
    expect((await call(A, 'post', '/api/financeiro/faturas', { total_manual: 1000, nif_cliente: '12' })).status).toBe(400);
  });
});

describe('Nota de crédito', () => {
  let fatura, pedido;
  beforeAll(async () => {
    pedido = await pedidoFechado(A, prodA);
    fatura = (await call(A, 'post', '/api/financeiro/faturas', { pedido_id: pedido })).body;
  });

  test('OPERADOR não emite (403); motivo é obrigatório (400)', async () => {
    expect((await call(OP, 'post', `/api/financeiro/faturas/${fatura.id}/nota-credito`, { motivo: 'Engano no NIF' })).status).toBe(403);
    expect((await call(A, 'post', `/api/financeiro/faturas/${fatura.id}/nota-credito`, { motivo: '' })).status).toBe(400);
  });

  test('ADMIN emite a NC pelo total, com as mesmas linhas e ligada à origem; só uma vez', async () => {
    const nc = await call(A, 'post', `/api/financeiro/faturas/${fatura.id}/nota-credito`, { motivo: 'Engano no NIF do cliente' });
    expect(nc.status).toBe(201);
    expect(nc.body.tipo_documento).toBe('NC');
    expect(nc.body.numero_fatura).toMatch(/^NC \d{4}\/000001$/);
    expect(nc.body.documento_origem_id).toBe(fatura.id);
    expect(Number(nc.body.total)).toBe(Number(fatura.total));
    expect(nc.body.linhas).toHaveLength(fatura.linhas.length);
    expect((await call(A, 'post', `/api/financeiro/faturas/${fatura.id}/nota-credito`, { motivo: 'Outra vez' })).status).toBe(409);
    expect((await call(A, 'post', `/api/financeiro/faturas/${nc.body.id}/nota-credito`, { motivo: 'NC da NC' })).status).toBe(409);
    const lista = await call(A, 'get', '/api/financeiro/faturas');
    expect(lista.body.find(f => f.id === fatura.id).anulada_por_numero).toBe(nc.body.numero_fatura);
  });

  test('depois da NC o pedido pode voltar a ser facturado (ex.: NIF corrigido)', async () => {
    const r = await call(A, 'post', '/api/financeiro/faturas', { pedido_id: pedido, nif_cliente: '5417000001' });
    expect(r.status).toBe(201);
    expect((await call(A, 'post', '/api/financeiro/faturas', { pedido_id: pedido })).status).toBe(409);
  });

  test('outro estabelecimento não anula documentos alheios (404)', async () => {
    const f = (await call(A, 'post', '/api/financeiro/faturas', { total_manual: 700 })).body;
    expect((await call(B, 'post', `/api/financeiro/faturas/${f.id}/nota-credito`, { motivo: 'Tentativa alheia' })).status).toBe(404);
  });
});

describe('Imutabilidade na base de dados', () => {
  test('UPDATE e DELETE de documentos e linhas são recusados', async () => {
    const f = (await call(A, 'post', '/api/financeiro/faturas', { total_manual: 1234 })).body;
    await expect(pool.query(`UPDATE faturas SET total = 1 WHERE id=$1`, [f.id])).rejects.toThrow(/nota de crédito/);
    await expect(pool.query(`DELETE FROM faturas WHERE id=$1`, [f.id])).rejects.toThrow(/nota de crédito/);
    await expect(pool.query(`UPDATE fatura_linhas SET total = 1 WHERE fatura_id=$1`, [f.id])).rejects.toThrow(/nota de crédito/);
    await expect(pool.query(`DELETE FROM fatura_linhas WHERE fatura_id=$1`, [f.id])).rejects.toThrow(/nota de crédito/);
    expect(Number((await pool.query(`SELECT total FROM faturas WHERE id=$1`, [f.id])).rows[0].total)).toBe(1234);
  });

  test('apagar o estabelecimento inteiro continua possível (cascata)', async () => {
    const C = await criarTenantFixture({ slug: 'it-fiscal-c' });
    expect((await call(C, 'post', '/api/financeiro/faturas', { total_manual: 900 })).status).toBe(201);
    await pool.query(`DELETE FROM tenants WHERE id=$1`, [C.tenantId]);
    expect((await pool.query(`SELECT COUNT(*)::int n FROM faturas WHERE tenant_id=$1`, [C.tenantId])).rows[0].n).toBe(0);
  });
});
