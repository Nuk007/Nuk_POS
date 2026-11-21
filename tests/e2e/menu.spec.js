'use strict';
/** Menu lateral em acordeão (22/11/2026): só as categorias à vista; tocar numa faz descer os módulos e fecha as outras. */
const { test, expect } = require('@playwright/test');

const EMAIL = 'dono@e2e.ao';
const PALAVRA_PASSE = '246810';

test('menu: categorias fechadas ao entrar, abrir uma fecha a outra, o módulo em uso abre a sua', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  await page.goto('/');
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', PALAVRA_PASSE);
  await page.click('#btn-entrar');
  await expect(page.locator('#topbar-titulo')).toHaveText(/Dashboard/);

  const caixa = page.locator('.nav-grupo', { has: page.locator('[data-modulo="caixa"]') });
  const vendas = page.locator('.nav-grupo', { has: page.locator('[data-modulo="mesas"]') });
  await expect(page.locator('.nav-item[data-modulo="dashboard"]')).toBeVisible();
  await expect(caixa.locator('.nav-titulo')).toBeVisible();
  await expect(page.locator('.nav-item[data-modulo="caixa"]')).toBeHidden();
  await expect(page.locator('.nav-item[data-modulo="mesas"]')).toBeHidden();

  await caixa.locator('.nav-titulo').click();
  await expect(page.locator('.nav-item[data-modulo="caixa"]')).toBeVisible();
  await expect(caixa.locator('.nav-titulo')).toHaveAttribute('aria-expanded', 'true');

  await vendas.locator('.nav-titulo').click();
  await expect(page.locator('.nav-item[data-modulo="mesas"]')).toBeVisible();
  await expect(page.locator('.nav-item[data-modulo="caixa"]')).toBeHidden();

  await vendas.locator('.nav-titulo').click(); // fecha
  await expect(page.locator('.nav-item[data-modulo="mesas"]')).toBeHidden();

  await page.evaluate(() => carregarModulo('caixa'));
  await expect(page.locator('.nav-item[data-modulo="caixa"]')).toBeVisible();

  const barra = await page.locator('.sidebar-nav').evaluate(el => getComputedStyle(el).scrollbarWidth);
  expect(barra).toBe('none');
  expect(erros).toEqual([]);
});
