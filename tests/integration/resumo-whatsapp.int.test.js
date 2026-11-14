'use strict';
/**
 * Integração (PostgreSQL real) — resumo diário para o dono e envio oficial do WhatsApp (Meta API simulada).
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');
const resumo = require('../../server/services/resumo-diario.service');
const wa = require('../../server/services/whatsapp.service');

let A, B, OP, prod, n = 1;
const ip = () => `10.12.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, metodo, url, corpo) => request(app)[metodo](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
// 14/11/2026 08:00 em Luanda → «ontem» = 13/11
const AGORA = new Date('2026-11-14T07:00:00Z');
const ONTEM = '2026-11-13';

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-resumo-a' });
  B = await criarTenantFixture({ slug: 'it-resumo-b' });
  const hash = await bcrypt.hash('123456', 4);
  const op = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Op','op@it-resumo-a.ao',$2,'Caixa','OPERADOR') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  OP = { token: gerarToken({ id: op, email: 'op@it-resumo-a.ao', nivel_acesso: 'OPERADOR', tenantId: A.tenantId }) };
  prod = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Picanha',5000,'CHURRASCO',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
  // ontem: 2 pedidos recebidos (15 000), 1 cancelado, 1 despesa de 2 000; um item de stock no mínimo
  for (const total of [10000, 5000]) {
    const p = (await pool.query(`INSERT INTO pedidos (tenant_id, status, total, pago_em, pago_metodo, criado_em) VALUES ($1,'FECHADO',$2,$3,'TPA',$3) RETURNING id`, [A.tenantId, total, `${ONTEM}T13:00:00+01:00`])).rows[0].id;
    await pool.query(`INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES ($1,$2,$3,5000)`, [p, prod, total / 5000]);
  }
  await pool.query(`INSERT INTO pedidos (tenant_id, status, total, cancelado_em, criado_em) VALUES ($1,'CANCELADO',3000,$2,$2)`, [A.tenantId, `${ONTEM}T20:00:00+01:00`]);
  await pool.query(`INSERT INTO despesas (tenant_id, categoria, descricao, valor, data) VALUES ($1,'ENERGIA','Gerador',2000,$2)`, [A.tenantId, ONTEM]);
  await pool.query(`INSERT INTO stock_items (tenant_id, nome, stock_atual, stock_minimo, unidade) VALUES ($1,'Carvão',1,5,'kg')`, [A.tenantId]);
}, 60000);

afterEach(() => { delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_ID; jest.restoreAllMocks(); });

test('números de ontem, alertas e texto; isolado por estabelecimento', async () => {
  const r = await resumo.calcular({ tenantId: A.tenantId, dia: ONTEM });
  expect([r.receita, r.pedidos, r.ticket_medio, r.despesas, r.resultado]).toEqual([15000, 2, 7500, 2000, 13000]);
  expect(r.cancelamentos.n).toBe(1);
  expect(r.stock_minimo).toEqual(['Carvão']);
  expect(r.alertas.join(' ')).toMatch(/cancelamento.*stock no mínimo: Carvão/s);
  expect(resumo.texto(r)).toMatch(/Receita: 15 000 Kz/);
  const b = await resumo.calcular({ tenantId: B.tenantId, dia: ONTEM });
  expect([b.receita, b.pedidos, b.alertas.length]).toEqual([0, 0, 0]);
  expect(resumo.parametros(r).every(p => !/\n/.test(p))).toBe(true);
});

test('ecrã: só a chefia; texto e ligação wa.me para o número configurado', async () => {
  expect((await call(OP, 'get', `/api/relatorios/resumo-diario?dia=${ONTEM}`)).status).toBe(403);
  expect((await call(A, 'put', '/api/relatorios/resumo-diario/config', { ativo: true, telefone: '12', hora: '07:30' })).status).toBe(400);
  expect((await call(A, 'put', '/api/relatorios/resumo-diario/config', { ativo: true, telefone: '923111222', hora: '25:00' })).status).toBe(400);
  expect((await call(A, 'put', '/api/relatorios/resumo-diario/config', { ativo: true })).status).toBe(400);
  const c = await call(A, 'put', '/api/relatorios/resumo-diario/config', { ativo: true, telefone: '+244 923 111 222', hora: '07:30' });
  expect(c.status).toBe(200);
  expect(c.body).toEqual({ ativo: true, telefone: '+244 923 111 222', hora: '07:30' });
  const r = await call(A, 'get', `/api/relatorios/resumo-diario?dia=${ONTEM}`);
  expect(r.status).toBe(200);
  expect(r.body.link_whatsapp).toMatch(/^https:\/\/wa\.me\/244923111222\?text=/);
  expect(r.body.whatsapp_oficial).toBe(false);
  // sem API oficial, «Enviar agora» devolve 409 com a ligação
  const e = await call(A, 'post', '/api/relatorios/resumo-diario/enviar', { dia: ONTEM });
  expect(e.status).toBe(409);
  expect(e.body.link_whatsapp).toMatch(/wa\.me/);
});

test('agendador: antes da hora não envia; depois envia uma só vez pela API oficial (modelo com 8 parâmetros)', async () => {
  process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_ID = '123';
  const chamadas = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (url, op) => { chamadas.push([url, JSON.parse(op.body)]); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }; });
  await call(A, 'put', '/api/relatorios/resumo-diario/config', { ativo: true, telefone: '923111222', hora: '07:30' });
  expect(await resumo.processarTick(new Date('2026-11-14T06:00:00Z'))).toBe(0); // 07:00 em Luanda
  expect(await resumo.processarTick(AGORA)).toBe(1);
  expect(await resumo.processarTick(AGORA)).toBe(0); // já tratado
  expect(chamadas).toHaveLength(1);
  const [url, corpo] = chamadas[0];
  expect(url).toMatch(/graph\.facebook\.com\/v\d+\.\d+\/123\/messages/);
  expect(corpo.to).toBe('244923111222');
  expect(corpo.template.components[0].parameters).toHaveLength(8);
  const linha = (await pool.query(`SELECT canal, estado FROM resumos_diarios WHERE tenant_id=$1 AND dia=$2`, [A.tenantId, ONTEM])).rows[0];
  expect(linha).toEqual({ canal: 'WHATSAPP', estado: 'ENVIADO' });
  const msg = (await pool.query(`SELECT estado, finalidade FROM mensagens_whatsapp WHERE tenant_id=$1`, [A.tenantId])).rows;
  expect(msg).toEqual([{ estado: 'ENVIADA', finalidade: 'RESUMO_DIARIO' }]);
});

test('Meta recusa: o envio fica FALHOU com o motivo e não se repete na volta seguinte', async () => {
  process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_ID = '123';
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Template name does not exist' } }) });
  await call(B, 'put', '/api/relatorios/resumo-diario/config', { ativo: true, telefone: '923000999', hora: '06:00' });
  expect(await resumo.processarTick(AGORA)).toBe(1);
  const linha = (await pool.query(`SELECT estado, erro FROM resumos_diarios WHERE tenant_id=$1 AND dia=$2`, [B.tenantId, ONTEM])).rows[0];
  expect(linha.estado).toBe('FALHOU');
  expect(linha.erro).toMatch(/Template name does not exist/);
  expect(await resumo.processarTick(AGORA)).toBe(0);
});

test('whatsapp: números angolanos e parâmetros sem mudanças de linha', () => {
  expect(['923111222', '+244 923 111 222', '00244923111222', '244923111222'].map(wa.normalizar)).toEqual(Array(4).fill('244923111222'));
  expect(wa.normalizar('823111222')).toBeNull();
  expect(wa.limparParam('a\nb\t\tc     d')).toBe('a · b · c   d');
});
