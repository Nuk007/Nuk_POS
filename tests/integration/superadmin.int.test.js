'use strict';
/**
 * Regressão: painel Superadmin (public/js/superadmin.js) nunca tinha sido exercitado
 * de ponta a ponta. Encontrado em 01/11/2026 ao testar o login real no browser: TODAS
 * as chamadas do painel usavam o prefixo /api/superadmin/..., mas o router está montado
 * em /api/saas (server/app.js: `app.use('/api/saas', saasLimiter, saasRouter)`). O próprio
 * server/saas.js tinha os comentários de rota a documentar o prefixo errado — foi
 * provavelmente a origem do erro ao escrever o frontend. Qualquer chave, válida ou não,
 * dava sempre "Chave inválida ou serviço indisponível." porque o pedido nunca chegava à
 * rota (404 antes de a autenticação ser sequer avaliada).
 */
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { app } = require('../../server/app');

describe('Painel Superadmin — autenticação e prefixo da API', () => {
  test('public/js/superadmin.js já não chama o prefixo errado /api/superadmin/', () => {
    const js = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'js', 'superadmin.js'), 'utf8'
    );
    expect(js).not.toMatch(/api\/superadmin\//);
    expect((js.match(/api\/saas\//g) || []).length).toBeGreaterThan(0);
  });

  test('GET /api/saas/dashboard sem chave devolve 401 (rota existe, não 404)', async () => {
    const r = await request(app).get('/api/saas/dashboard');
    expect(r.status).toBe(401);
    expect(r.body.erro).toMatch(/autenticação/i);
  });

  test('GET /api/saas/dashboard com chave errada devolve 401 "Chave inválida"', async () => {
    const r = await request(app)
      .get('/api/saas/dashboard')
      .set('X-Superadmin-Key', 'chave-completamente-errada');
    expect(r.status).toBe(401);
    expect(r.body.erro).toMatch(/chave inválida/i);
  });

  test('GET /api/saas/dashboard com SUPERADMIN_KEY correcta entra e devolve o resumo', async () => {
    const r = await request(app)
      .get('/api/saas/dashboard')
      .set('X-Superadmin-Key', process.env.SUPERADMIN_KEY);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('resumo');
    expect(r.body).toHaveProperty('por_estado');
  });

  test('POST /api/saas/tenants (criar estabelecimento) está acessível com a chave correcta', async () => {
    const plano = await global.pool.query(
      `SELECT nome FROM planos_assinatura WHERE ativo = true ORDER BY preco_mensal LIMIT 1`
    );
    const r = await request(app)
      .post('/api/saas/tenants')
      .set('X-Superadmin-Key', process.env.SUPERADMIN_KEY)
      .send({
        nome: 'Estabelecimento Teste Regressão',
        telefone_whatsapp: '+244900000111',
        email: 'regressao@teste.ao',
        plano_nome: plano.rows[0].nome,
      });
    expect(r.status).toBe(201);
    expect(r.body).toHaveProperty('activation_link');
    expect(r.body.activation_link).toMatch(/\/activate\//);
  });
});
