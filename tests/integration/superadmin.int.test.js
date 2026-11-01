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

describe('POST /api/saas/licencas/:key/reenviar — não pode rebentar sem Twilio', () => {
  /**
   * Regressão: reportado pelo utilizador em produção como "Erro interno do servidor" ao
   * clicar "📲 Reenviar link" no modal de um tenant. Ao contrário de POST /tenants e
   * POST /tenants/:id/renovar (que já isolavam a falha do envio de WhatsApp num try/catch
   * próprio e degradavam com sucesso), esta rota deixava `enviarWhatsAppActivacao` rebentar
   * até ao catch geral e devolvia sempre 500 — mesmo com a licença válida e sem o Twilio
   * estar configurado (como é o caso aqui, em teste). TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN
   * não estão definidas no ambiente de testes, por isso este teste cobre exactamente esse caminho.
   */
  test('licença PENDENTE existente: reenviar sem Twilio configurado devolve 200, não 500', async () => {
    const { tenantId } = await global.criarTenantFixture({ slug: 'it-reenviar' });
    const plano = await global.pool.query(`SELECT id FROM planos_assinatura ORDER BY preco_mensal LIMIT 1`);
    const licenseKey = `NUK-REENV-${Date.now().toString(36)}`;
    await global.pool.query(
      `INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, estado)
       VALUES ($1, $2, $3, 30, 'PENDENTE')`,
      [tenantId, licenseKey, plano.rows[0].id]
    );

    const r = await request(app)
      .post(`/api/saas/licencas/${licenseKey}/reenviar`)
      .set('X-Superadmin-Key', process.env.SUPERADMIN_KEY);

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.whatsapp_enviado).toBe(false);
    expect(r.body).toHaveProperty('link');
    expect(r.body.link).toMatch(new RegExp(`/activate/${licenseKey}$`));
    expect(r.body.aviso).toMatch(/manualmente/i);
  });

  test('licença inexistente continua a devolver 404, não 500', async () => {
    const r = await request(app)
      .post('/api/saas/licencas/CHAVE-QUE-NAO-EXISTE/reenviar')
      .set('X-Superadmin-Key', process.env.SUPERADMIN_KEY);
    expect(r.status).toBe(404);
  });
});

describe('saasLimiter — só em POST /tenants, nunca no painel inteiro', () => {
  /**
   * Regressão: saasLimiter (5 req/15min, ver server/middleware/rateLimiters.js — pensado
   * só para "criação de tenants") estava aplicado em server/app.js ao router /api/saas
   * inteiro (`app.use('/api/saas', saasLimiter, saasRouter)`), não só a POST /tenants.
   * Qualquer navegação normal do superadmin — dashboard + listar tenants + abrir um tenant
   * já são 3 pedidos — esgotava o limite e bloqueava o painel por 15 minutos com "Demasiados
   * pedidos ao painel de administração." Descoberto em 01/11/2026 ao reproduzir "a chave não
   * funciona" em produção: a 6.ª chamada de diagnóstico (ainda dentro da mesma janela de
   * 15 min de outras chamadas de teste) já tinha sido bloqueada por este limite.
   */
  test('mais de 5 pedidos seguidos a GET /api/saas/dashboard não são bloqueados', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await request(app)
        .get('/api/saas/dashboard')
        .set('X-Superadmin-Key', process.env.SUPERADMIN_KEY);
      expect(r.status).toBe(200);
    }
  });

  test('mais de 5 pedidos seguidos a GET /api/saas/tenants não são bloqueados', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await request(app)
        .get('/api/saas/tenants')
        .set('X-Superadmin-Key', process.env.SUPERADMIN_KEY);
      expect(r.status).toBe(200);
    }
  });
});
