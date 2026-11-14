'use strict';
/** Sem internet num navegador real: a venda fica guardada no dispositivo e segue sozinha quando a rede volta. */
const { test, expect } = require('@playwright/test');

test('venda ao balcão sem internet é guardada e enviada quando a ligação volta', async ({ page, context }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();

  // abrir o balcão com rede (fica a cópia dos produtos e preços neste dispositivo)
  await page.click('.nav-item[data-modulo="balcao"]');
  await expect(page.locator('.venda-produto', { hasText: 'Mufete' })).toBeVisible();
  const antes = await page.evaluate(async () => (await (await fetch('/api/pedidos?limit=100', { headers: { Authorization: `Bearer ${NUK.token}` } })).json()));
  const nAntes = (antes.data || antes).length;

  await context.setOffline(true);
  // o painel volta a abrir sem rede, a partir da cópia guardada
  await page.click('.nav-item[data-modulo="dashboard"]');
  await page.click('.nav-item[data-modulo="balcao"]');
  await page.locator('.venda-produto', { hasText: 'Mufete' }).click();
  await page.click('button:has-text("Enviar pedido")');
  await expect(page.locator('.toast', { hasText: 'Sem internet' })).toBeVisible();
  await expect(page.locator('#offline-estado')).toContainText('1 por enviar');

  await context.setOffline(false);
  await expect(page.locator('.toast', { hasText: 'enviados' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#offline-estado')).toBeHidden();
  const depois = await page.evaluate(async () => (await (await fetch('/api/pedidos?limit=100', { headers: { Authorization: `Bearer ${NUK.token}` } })).json()));
  const lista = depois.data || depois;
  expect(lista.length).toBe(nAntes + 1);
  expect(erros).toEqual([]);
});
