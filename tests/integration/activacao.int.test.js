'use strict';
/**
 * Regressão: link de activação de um novo tenant (`${baseUrl}/activate/${licenseKey}`,
 * gerado em server/saas.js ao criar o tenant). Dois bugs encontrados em 01/11/2026:
 *
 * 1. O fallback SPA em server/app.js não tinha caso para `/activate/:key` e servia
 *    sempre index.html (login do POS) — a página de activação nunca aparecia.
 * 2. public/js/activate.js chamava `/api/activate/...` em vez de `/api/saas/activate/...`
 *    (o router está montado em `/api/saas`) — o pedido caía sempre em 404.
 *
 * Este teste cobre a rota pública GET /api/saas/activate/:key (não exige SUPERADMIN_KEY)
 * e confirma que `/activate/:key` serve o HTML de activação, não o índice.
 */
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { app } = require('../../server/app');

describe('Fluxo de activação de tenant', () => {
  test('GET /activate/<key> serve activate.html, não index.html', async () => {
    const r = await request(app).get('/activate/QUALQUER-CHAVE');
    expect(r.status).toBe(200);
    expect(r.type).toBe('text/html');

    const activateHtml = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'activate.html'), 'utf8'
    );
    const indexHtml = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8'
    );
    // Confirma que serviu o ficheiro certo e não o índice do POS.
    expect(r.text).toBe(activateHtml);
    expect(r.text).not.toBe(indexHtml);
  });

  test('GET /api/saas/activate/:key (prefixo usado por public/js/activate.js) responde — não 404 de rota', async () => {
    const r = await request(app).get('/api/saas/activate/CHAVE-INEXISTENTE');
    // 404 aqui é "licença não encontrada" (JSON vindo do saas.js), não o 404 genérico de rota.
    expect(r.status).toBe(404);
    expect(r.body).toHaveProperty('erro');
    expect(r.body.erro).toMatch(/licença/i);
  });

  test('GET /api/activate/:key (prefixo antigo, errado) já não é usado pelo frontend', () => {
    const activateJs = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'js', 'activate.js'), 'utf8'
    );
    expect(activateJs).not.toMatch(/fetch\(`\/api\/activate\//);
    expect(activateJs).toMatch(/fetch\(`\/api\/saas\/activate\//);
  });

  test('licença válida devolvida por GET /api/saas/activate/:key tem os dados do tenant', async () => {
    const { tenantId, slug } = await global.criarTenantFixture({ slug: 'it-activacao' });
    const licenseKey = `NUK-ACT-${Date.now().toString(36)}`;

    const plano = await global.pool.query(`SELECT id FROM planos_assinatura ORDER BY preco_mensal LIMIT 1`);
    await global.pool.query(
      `INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, inicio, fim, estado)
       VALUES ($1, $2, $3, 30, NOW(), NOW() + INTERVAL '30 days', 'PENDENTE')`,
      [tenantId, licenseKey, plano.rows[0].id]
    );

    const r = await request(app).get(`/api/saas/activate/${licenseKey}`);
    expect(r.status).toBe(200);
    expect(r.body.valida).toBe(true);
    expect(r.body.tenant_nome).toMatch(new RegExp(slug, 'i'));
  });
});
