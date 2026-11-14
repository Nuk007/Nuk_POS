'use strict';
/** Licença expirada num navegador real: ecrã próprio (sem erros/CSP), e «Já renovei» reabre depois da renovação. */
const { test, expect } = require('@playwright/test');

test('licença expirada mostra o ecrã de bloqueio; renovada, a operação volta', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => {
    // os 403 da própria licença são esperados enquanto está bloqueada
    if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text());
  });
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();

  const sa = (metodo, caminho, corpo) => page.evaluate(async ({ metodo, caminho, corpo }) => {
    const r = await fetch(caminho, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Superadmin-Key': 'e2e-superadmin' }, body: JSON.stringify(corpo) });
    return { status: r.status, json: await r.json() };
  }, { metodo, caminho, corpo });
  const tenantId = await page.evaluate(() => JSON.parse(atob(NUK.token.split('.')[1])).tenantId);

  expect((await sa('PATCH', `/api/saas/tenants/${tenantId}/estado`, { estado: 'EXPIRADA' })).status).toBe(200);
  await page.reload();
  await expect(page.locator('#tela-licenca')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#licenca-titulo')).toHaveText('A licença expirou');
  await expect(page.locator('#licenca-dados')).toContainText('estão guardados');

  // «Já renovei» sem renovar não abre
  await page.click('#licenca-tentar');
  await expect(page.locator('.toast', { hasText: 'ainda não foi renovada' })).toBeVisible();

  const r = await sa('POST', `/api/saas/tenants/${tenantId}/renovar`, { duracao_dias: 30 });
  expect(r.status).toBe(200);
  await page.click('#licenca-tentar');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#tela-licenca')).toBeHidden();
  expect(erros).toEqual([]);
});
