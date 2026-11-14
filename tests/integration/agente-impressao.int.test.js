'use strict';
/**
 * Integração (PostgreSQL real) — impressão em rede pelo agente local: token, fila, reclamar uma só vez,
 * resultado, endereços permitidos e o programa do agente a enviar por TCP para uma «impressora» falsa.
 */
const net = require('net');
const request = require('supertest');
const { app } = require('../../server/app');
const agenteProg = require('../../agente-impressao/agente');

let A, B, n = 1;
const ip = () => `10.17.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const com = (T, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${T.token}`).send(body);
const ag = (token, m, url, body) => request(app)[m](url).set('X-Forwarded-For', ip()).set('X-Agente-Token', token).send(body);
const B64 = Buffer.from('\x1b@Ola\n').toString('base64');

beforeAll(async () => {
  A = await criarTenantFixture({ slug: 'it-agimp-a' });
  B = await criarTenantFixture({ slug: 'it-agimp-b' });
}, 60000);

test('sem agente a fila recusa (409); só ADMIN cria; o token aparece uma vez e só se guarda o hash', async () => {
  expect((await com(A, 'post', '/api/impressao/rede', { impressora: '192.168.1.50:9100', dados: B64 })).status).toBe(409);
  expect((await com(A, 'post', '/api/impressao/agentes', { nome: 'x' })).status).toBe(400);
  const r = await com(A, 'post', '/api/impressao/agentes', { nome: 'PC da cozinha' });
  expect(r.status).toBe(201);
  expect(r.body.token).toMatch(/^nka_/);
  const guardado = (await pool.query(`SELECT token_hash FROM agentes_impressao WHERE id = $1`, [r.body.id])).rows[0].token_hash;
  expect(guardado).not.toContain(r.body.token);
  expect((await com(A, 'get', '/api/impressao/agentes')).body[0]).not.toHaveProperty('token_hash');
  A.agente = r.body;
});

test('endereços: só rede local e portas 9100–9109; dados base64', async () => {
  for (const imp of ['8.8.8.8:9100', '192.168.1.5:22', '127.0.0.1:9100', 'impressora.local', '192.168.1.300']) {
    expect((await com(A, 'post', '/api/impressao/rede', { impressora: imp, dados: B64 })).status).toBe(400);
  }
  expect((await com(A, 'post', '/api/impressao/rede', { impressora: '10.0.0.9', dados: '###' })).status).toBe(400);
  const ok = await com(A, 'post', '/api/impressao/rede', { impressora: '10.0.0.9', dados: B64 });
  expect(ok.status).toBe(201);
  expect(ok.body.impressora).toBe('10.0.0.9:9100');
});

test('o agente reclama cada trabalho uma só vez, só do seu estabelecimento; token errado/revogado → 401', async () => {
  expect((await ag('nka_errado_errado_errado_errado', 'get', '/api/agente-impressao/trabalhos')).status).toBe(401);
  const tB = (await com(B, 'post', '/api/impressao/agentes', { nome: 'PC B' })).body.token;
  await com(B, 'post', '/api/impressao/rede', { impressora: '192.168.0.10:9100', dados: B64 });
  const [r1, r2] = await Promise.all([ag(A.agente.token, 'get', '/api/agente-impressao/trabalhos'), ag(A.agente.token, 'get', '/api/agente-impressao/trabalhos')]);
  const todos = [...r1.body.trabalhos, ...r2.body.trabalhos];
  expect(todos.map(t => t.impressora)).toEqual(['10.0.0.9:9100']);
  // B não vê o de A, e A não conclui o de B
  const deB = (await ag(tB, 'get', '/api/agente-impressao/trabalhos')).body.trabalhos;
  expect(deB.map(t => t.impressora)).toEqual(['192.168.0.10:9100']);
  expect((await ag(A.agente.token, 'post', `/api/agente-impressao/trabalhos/${deB[0].id}`, { ok: true })).status).toBe(404);
  // falha volta à fila; ao 3.º falhanço fica FALHOU
  const id = todos[0].id;
  expect((await ag(A.agente.token, 'post', `/api/agente-impressao/trabalhos/${id}`, { ok: false, erro: 'ECONNREFUSED' })).body.estado).toBe('PENDENTE');
  for (let i = 0; i < 2; i++) {
    const t = (await ag(A.agente.token, 'get', '/api/agente-impressao/trabalhos')).body.trabalhos[0];
    await ag(A.agente.token, 'post', `/api/agente-impressao/trabalhos/${t.id}`, { ok: false, erro: 'ECONNREFUSED' });
  }
  const est = (await com(A, 'get', `/api/impressao/rede/${id}`)).body;
  expect([est.estado, est.tentativas, est.erro]).toEqual(['FALHOU', 3, 'ECONNREFUSED']);
  // revogado deixa de entrar
  const lista = (await com(B, 'get', '/api/impressao/agentes')).body;
  expect((await com(B, 'post', `/api/impressao/agentes/${lista[0].id}/revogar`)).status).toBe(200);
  expect((await ag(tB, 'get', '/api/agente-impressao/trabalhos')).status).toBe(401);
});

test('programa do agente: imprime por TCP e confirma ENVIADO; impressora desligada fica a falhar', async () => {
  const recebido = [];
  const impressora = net.createServer(s => s.on('data', d => recebido.push(d)));
  await new Promise(r => impressora.listen(0, '127.0.0.1', r));
  const porta = impressora.address().port;
  const t = (await com(A, 'post', '/api/impressao/rede', { impressora: '192.168.1.77:9101', dados: B64 })).body;
  // o agente real só aceita IPs privados; no teste o «envio» vai para a impressora falsa local
  const chamarApi = async (caminho, op = {}) => (await ag(A.agente.token, (op.method || 'GET').toLowerCase(), caminho, op.body)).body;
  const tratados = await agenteProg.volta({ chamarApi, enviar: (d, bytes) => agenteProg.enviarTcp({ host: '127.0.0.1', port: porta }, bytes, 3000), log: () => {} });
  expect(tratados).toBe(1);
  expect(Buffer.concat(recebido).toString()).toBe('\x1b@Ola\n');
  expect((await com(A, 'get', `/api/impressao/rede/${t.id}`)).body.estado).toBe('ENVIADO');
  impressora.close();
  await expect(agenteProg.enviarTcp({ host: '127.0.0.1', port: porta }, Buffer.from('x'), 1000)).rejects.toThrow(/127\.0\.0\.1/);
  expect(agenteProg.destino('8.8.8.8:9100')).toBeNull();
  expect(agenteProg.destino('192.168.1.5:9100')).toEqual({ host: '192.168.1.5', port: 9100 });
});
