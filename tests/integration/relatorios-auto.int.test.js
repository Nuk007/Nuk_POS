'use strict';
/**
 * Integração (PostgreSQL real) — relatórios gerados automaticamente (21/11/2026): configuração, agendador (hora,
 * sem duplicar, períodos vazios, licenças), geração à mão dos 10 relatórios, lista, PDF e isolamento.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../../server/app');
const { gerarToken } = require('../../server/middleware/auth');
const auto = require('../../server/services/relatorios-auto.service');

let A, B, GER, cuca, gelo, cliente, n = 1;
const ip = () => `10.33.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const call = (T, m, url, corpo) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(corpo);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
// «amanhã» às HH:MM de Luanda (UTC+1): para o agendador, «ontem» passa a ser hoje
const amanha = hhmm => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(hoje() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(h - 1, m); return d; };
const linhas = async (tenantId, extra = '') => (await pool.query(`SELECT tipo, frequencia, to_char(de,'YYYY-MM-DD') AS de, to_char(ate,'YYYY-MM-DD') AS ate, estado, origem FROM relatorios_gerados WHERE tenant_id = $1 ${extra} ORDER BY tipo, de`, [tenantId])).rows;

async function vender(itens, pagamento) {
  const p = (await call(A, 'post', '/api/pedidos', { origem: 'BALCAO', itens })).body;
  await call(A, 'patch', `/api/pedidos/${p.id}/status`, { status: 'FECHADO' });
  expect((await call(A, 'post', '/api/caixa/receber', { pedido_ids: [p.id], ...pagamento })).status).toBe(200);
}

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-rauto-a' });
  B = await criarTenantFixture({ slug: 'it-rauto-b' });
  await pool.query(`UPDATE tenants SET modulos = '["restauracao","caixa","financas"]'::jsonb WHERE id = $1`, [B.tenantId]); // sem hospedagem
  const hash = await bcrypt.hash('123456', 4);
  const g = (await pool.query(`INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso) VALUES ($1,'Ger','ger@it-rauto.ao',$2,'Gerente','GERENTE') RETURNING id`, [A.tenantId, hash])).rows[0].id;
  GER = { token: gerarToken({ id: g, email: 'ger@it-rauto.ao', nivel_acesso: 'GERENTE', tenantId: A.tenantId }) };
  cuca = (await pool.query(`INSERT INTO produtos (tenant_id, nome, preco, categoria, disponivel, ativo) VALUES ($1,'Cuca',500,'BEBIDA',true,true) RETURNING id`, [A.tenantId])).rows[0].id;
  const cucaSt = (await pool.query(`INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, stock_minimo, unidade, custo_unitario) VALUES ($1,'Cuca (garrafa)','BEBIDA',100,10,'un',277) RETURNING id`, [A.tenantId])).rows[0].id;
  await pool.query(`INSERT INTO produto_ingredientes (produto_id, stock_item_id, quantidade) VALUES ($1,$2,1)`, [cuca, cucaSt]);
  gelo = (await pool.query(`INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, unidade) VALUES ($1,'Gelo','OUTRO',5,'un') RETURNING id`, [A.tenantId])).rows[0].id;
  cliente = (await pool.query(`INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1,'Sr. Elias','+244923000222') RETURNING id`, [A.tenantId])).rows[0].id;
  expect((await call(A, 'put', `/api/caixa/conta-corrente/${cliente}`, { ativa: true, limite: 100000 })).status).toBe(200);
  const q = (await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,'2','STANDARD',6000,12000,20000) RETURNING id`, [A.tenantId])).rows[0].id;
  await pool.query(`INSERT INTO quartos (tenant_id, numero, tipo, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,'8','STANDARD',6000,12000,20000)`, [A.tenantId]);
  await pool.query(`INSERT INTO reservas (tenant_id, quarto_id, fracao, checkin, checkout, status, valor_total) VALUES ($1,$2,'PERNOITE', NOW(), NOW() + interval '12 hours','CHECKIN',12000)`, [A.tenantId, q]);

  // um dia de trabalho: caixa, vendas (dinheiro, TPA, crédito), compra sem factura, quebras repetidas, fecho com diferença
  expect((await call(A, 'post', '/api/caixa/abrir', { fundo_inicial: 10000 })).status).toBe(201);
  await vender([{ produto_id: cuca, quantidade: 10 }], { metodo: 'CASH' });
  await vender([{ produto_id: cuca, quantidade: 4 }], { metodo: 'TPA' });
  await vender([{ produto_id: cuca, quantidade: 6 }], { metodo: 'CONTA', cliente_id: cliente });
  expect((await call(A, 'post', '/api/compras', { stock_item_id: gelo, quantidade: 4, valor_total: 3000, fornecedor: 'Gelo Lda' })).status).toBe(201);
  for (let i = 0; i < 2; i++) expect((await call(A, 'post', `/api/stock/${cucaSt}/movimento`, { tipo: 'DESPERDICIO', quantidade: 4, motivo: 'Partiu' })).status).toBe(201);
  const est = (await call(A, 'get', '/api/caixa')).body;
  const esperado = Number(est.resumo.dinheiro_esperado);
  expect((await call(A, 'post', '/api/caixa/fechar', { contado: esperado - 500, justificacao: 'Faltam 500 Kz de troco dado a mais' })).status).toBe(200);
}, 90000);

test('configuração: padrão ligado às 06:00; só ADMIN grava; validações', async () => {
  const c = (await call(GER, 'get', '/api/relatorios/auto/config')).body;
  expect(c).toMatchObject({ ativo: true, hora: '06:00', configurado: false });
  expect(c.DIA).toContain('FOLHA_CAIXA');
  expect((await call(GER, 'put', '/api/relatorios/auto/config', { hora: '07:00' })).status).toBe(403);
  expect((await call(A, 'put', '/api/relatorios/auto/config', { hora: '25:00' })).status).toBe(400);
  expect((await call(A, 'put', '/api/relatorios/auto/config', { DIA: ['STOCK'] })).status).toBe(400); // o stock não é diário
  expect((await call(A, 'put', '/api/relatorios/auto/config', { DIA: ['NADA'] })).status).toBe(400);
  const g = await call(A, 'put', '/api/relatorios/auto/config', { hora: '06:30' });
  expect(g.status).toBe(200);
  expect(g.body).toMatchObject({ hora: '06:30', ativo: true, configurado: true });
  expect((await call(A, 'put', '/api/relatorios/auto/config', { suspensos: 'VENDAS' })).status).toBe(400);
  expect((await call(A, 'put', '/api/relatorios/auto/config', { suspensos: ['NADA'] })).status).toBe(400);
  expect((await call(GER, 'put', '/api/relatorios/auto/config', { suspensos: ['VENDAS'] })).status).toBe(403);
  const cat = (await call(GER, 'get', '/api/relatorios/catalogo')).body;
  expect(cat.map(x => x.tipo)).toEqual(expect.arrayContaining(['FOLHA_CAIXA', 'VENDAS', 'COMPRAS', 'STOCK', 'QUEBRAS', 'MARGEM', 'DIVIDAS', 'QUARTOS', 'CAIXA_DIFERENCAS', 'RESULTADO']));
});

test('agendador: nada antes da hora; depois gera os diários de ontem uma só vez; períodos vazios não aparecem', async () => {
  expect(await auto.processarTick(amanha('06:00'))).toBeGreaterThanOrEqual(0);
  expect(await linhas(A.tenantId)).toEqual([]); // 06:00 < 06:30
  await auto.processarTick(amanha('07:00'));
  const prontos = await linhas(A.tenantId, `AND estado = 'PRONTO'`);
  expect(prontos.map(r => r.tipo).sort()).toEqual(['CAIXA_DIFERENCAS', 'FOLHA_CAIXA', 'QUEBRAS', 'VENDAS']);
  expect(prontos.every(r => r.de === hoje() && r.ate === hoje() && r.frequencia === 'DIA' && r.origem === 'AUTO')).toBe(true);
  // o estabelecimento B suspende as Vendas: o Administrador escolhe; o resto continua a gerar-se
  const sB = await call(B, 'put', '/api/relatorios/auto/config', { suspensos: ['VENDAS'] });
  expect(sB.status).toBe(200);
  expect(sB.body).toMatchObject({ suspensos: ['VENDAS'], DIA: expect.arrayContaining(['VENDAS']) }); // a escolha da frequência fica guardada
  const vazios = await linhas(A.tenantId, `AND estado = 'VAZIO'`);
  expect(vazios.length).toBeGreaterThan(0); // dias anteriores, semana e mês sem movimento
  const total = (await linhas(A.tenantId)).length;
  await auto.processarTick(amanha('08:00'));
  expect((await linhas(A.tenantId)).length).toBe(total); // não repete
  // licenças: sem hospedagem, o estabelecimento B não recebe o relatório de quartos
  await pool.query(`DELETE FROM relatorios_gerados WHERE tenant_id = $1`, [B.tenantId]); // o 1.º tick já tinha passado por B
  await auto.processarTick(amanha('07:00'));
  const tiposB = new Set((await linhas(B.tenantId)).map(r => r.tipo));
  expect(tiposB.has('VENDAS')).toBe(false);          // suspenso
  expect(tiposB.has('CAIXA_DIFERENCAS')).toBe(true); // activo
  expect(tiposB.has('QUARTOS')).toBe(false);         // sem a licença de hospedagem
}, 60000);

test('os relatórios gerados trazem os números do dia', async () => {
  const lista = (await call(GER, 'get', '/api/relatorios/gerados')).body;
  expect(lista.total).toBe(4);
  const id = t => lista.data.find(x => x.tipo === t).id;
  const vend = (await call(GER, 'get', `/api/relatorios/gerados/${id('VENDAS')}`)).body.dados;
  expect(vend.resumo.find(k => k.rotulo === 'Vendas pagas').valor).toBe(10000);
  const fc = (await call(GER, 'get', `/api/relatorios/gerados/${id('FOLHA_CAIXA')}`)).body.dados;
  expect(fc.resumo.find(k => k.rotulo === 'Diferença').valor).toBe(-500);
  const qb = (await call(GER, 'get', `/api/relatorios/gerados/${id('QUEBRAS')}`)).body.dados;
  expect(qb.resumo[0].valor).toBe(2);
  const cx = (await call(GER, 'get', `/api/relatorios/gerados/${id('CAIXA_DIFERENCAS')}`)).body.dados;
  expect(cx.seccoes[0].linhas[0]).toMatchObject({ diferenca: -500, justificacao: 'Faltam 500 Kz de troco dado a mais' });
  // PDF genérico e o da Folha de Caixa
  for (const t of ['VENDAS', 'FOLHA_CAIXA']) {
    const pdf = await call(GER, 'get', `/api/relatorios/gerados/${id(t)}/pdf`).buffer(true).parse((res, cb) => { const b = []; res.on('data', c => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
  }
  expect((await call(B, 'get', `/api/relatorios/gerados/${id('VENDAS')}`)).status).toBe(404); // isolamento
});

test('gerar à mão os outros relatórios (substitui o do mesmo período)', async () => {
  const gerar = (tipo, de = hoje(), ate = hoje()) => call(GER, 'post', '/api/relatorios/gerar', { tipo, de, ate });
  const comp = (await gerar('COMPRAS')).body.dados;
  expect(comp.seccoes[0].linhas[0]).toMatchObject({ fornecedor: 'Gelo Lda', compras: 1, com_documento: 0, valor: 3000 });
  expect(comp.alertas.join(' ')).toMatch(/sem n\.º de factura/);
  const st = (await gerar('STOCK')).body.dados;
  expect(st.seccoes[0].linhas.find(l => l.item === 'Cuca (garrafa)')).toMatchObject({ vendas: 20, quebras: 8, entradas: 0, stock: 72 });
  const mg = (await gerar('MARGEM')).body.dados;
  expect(mg.seccoes[0].linhas[0]).toMatchObject({ produto: 'Cuca', quantidade: 20, receita: 10000, custo: 5540 });
  const dv = (await gerar('DIVIDAS')).body.dados;
  expect(dv.seccoes[0].linhas[0]).toMatchObject({ cliente: 'Sr. Elias', ate7: 3000, total: 3000 });
  const qt = (await gerar('QUARTOS')).body.dados;
  expect(qt.resumo[0].valor).toBe(1);
  expect(qt.seccoes[0].linhas.find(l => l.quarto === '2')).toMatchObject({ noite_n: 1, receita: 12000 });
  const rs = (await gerar('RESULTADO')).body.dados;
  expect(rs.resumo[0].valor).toBe(22000); // 10 000 vendas + 12 000 alojamento
  if (process.env.GUARDAR_PDF) { // para ver os PDFs: GUARDAR_PDF=/tmp/rel
    const l = (await call(GER, 'get', '/api/relatorios/gerados?limit=50')).body.data;
    for (const x of l) {
      const pdf = await call(GER, 'get', `/api/relatorios/gerados/${x.id}/pdf`).buffer(true).parse((res, cb) => { const b = []; res.on('data', c => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
      require('fs').writeFileSync(`${process.env.GUARDAR_PDF}-${x.tipo}.pdf`, pdf.body);
    }
  }
  const v2 = await gerar('VENDAS');
  expect(v2.status).toBe(201);
  expect((await linhas(A.tenantId, `AND tipo = 'VENDAS' AND de = '${hoje()}'`))[0].origem).toBe('MANUAL');
  // validações
  expect((await gerar('NADA')).status).toBe(400);
  expect((await gerar('FOLHA_CAIXA', '2026-11-01', '2026-11-02')).status).toBe(400);
  expect((await gerar('VENDAS', '2099-01-01', '2099-01-01')).status).toBe(400);
  expect((await gerar('VENDAS', hoje(), '2020-01-01')).status).toBe(400);
});
