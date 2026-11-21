'use strict';
/**
 * Navegar depressa: um módulo que acaba de carregar depois de se ter mudado de ecrã não pode tapar o módulo escolhido.
 * As Configurações respondem com atraso de propósito; toca-se logo a seguir noutro módulo.
 */
const { test, expect } = require('@playwright/test');
const { menu } = require('./menu');

test('módulo lento que acaba depois não tapa o módulo escolhido a seguir', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text()); });
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();

  // as leituras das Configurações demoram 1,5 s
  await page.route('**/api/configuracoes**', async rota => { await new Promise(r => setTimeout(r, 1500)); await rota.continue(); });
  await menu(page, 'configuracoes');
  await menu(page, 'movimentos');
  await expect(page.locator('#main-content .secao-titulo', { hasText: 'Movimentos do caixa' })).toBeVisible();

  await page.waitForTimeout(2500); // as Configurações já acabaram de carregar entretanto
  await expect(page.locator('#topbar-titulo')).toHaveText(/Movimentos do caixa/);
  await expect(page.locator('#main-content .secao-titulo', { hasText: 'Movimentos do caixa' })).toBeVisible();
  await expect(page.locator('#main-content', { hasText: 'NOME DO ESTABELECIMENTO' })).toHaveCount(0);
  await expect(page.locator('#main-content > .modulo-contentor')).toHaveCount(1);
  expect(erros).toEqual([]);
});
