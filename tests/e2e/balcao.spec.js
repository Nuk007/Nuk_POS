'use strict';
/** Balcão num navegador real (regra do dono, 20/11/2026): só bebidas e piscina nos botões, e «Vender quarto». */
const { test, expect } = require('@playwright/test');

test('balcão: só bebidas e piscina; «Vender quarto» abre os botões dos quartos', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text()); });
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => carregarModulo('balcao'));
  await expect(page.locator('.venda-produto', { hasText: 'Cuca' })).toBeVisible();
  await expect(page.locator('.venda-produto', { hasText: 'Entrada piscina' })).toBeVisible();
  await expect(page.locator('.venda-produto', { hasText: 'Picanha' })).toHaveCount(0);
  await expect(page.locator('.venda-produto', { hasText: 'Mufete' })).toHaveCount(0);
  if (process.env.E2E_CAPTURAS) await page.screenshot({ path: `${process.env.E2E_CAPTURAS}/balcao-1.png` });
  await page.click('button:has-text("Vender quarto")');
  await expect(page.locator('#modal-box .quarto-card', { hasText: '101' })).toBeVisible();
  if (process.env.E2E_CAPTURAS) await page.screenshot({ path: `${process.env.E2E_CAPTURAS}/balcao-2-quartos.png` });
  await page.locator('#modal-box .quarto-card', { hasText: '101' }).click();
  await expect(page.locator('#modal-box')).toContainText('Quarto 101');
  expect(erros).toEqual([]);
});
