'use strict';
/** Venda ao peso e leitor de códigos de barras num navegador real (21/11/2026). */
const { test, expect } = require('@playwright/test');

test('balcão: código de barras abre o peso, a linha fica em kg e o pedido segue', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text()); });
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();
  // o Administrador cria o produto ao peso com código de barras (como em Configurações → Ementa)
  await page.evaluate(() => api('POST', '/produtos', { nome: 'Camarão e2e', preco: 8000, categoria: 'BEBIDA', vendido_ao_peso: true, codigo_barras: 'CAM-77' }));
  await page.evaluate(() => carregarModulo('balcao'));
  await expect(page.locator('.venda-produto', { hasText: 'Camarão e2e' })).toContainText('/kg');
  await page.fill('#venda-codigo', 'CAM-77');
  await page.press('#venda-codigo', 'Enter');
  await expect(page.locator('#modal-box')).toContainText('Peso (kg)');
  await page.fill('#peso-kg', '0.250');
  await expect(page.locator('#peso-valor')).toContainText('2');
  await page.click('#modal-box button:has-text("Adicionar")');
  await expect(page.locator('#venda-itens')).toContainText('0,250 kg');
  await expect(page.locator('#venda-total')).toContainText('2');
  if (process.env.E2E_CAPTURAS) await page.screenshot({ path: `${process.env.E2E_CAPTURAS}/peso-1.png` });
  const resp = page.waitForResponse(r => r.url().endsWith('/api/pedidos') && r.request().method() === 'POST');
  await page.click('button:has-text("Enviar pedido")');
  const r = await resp;
  expect(r.status()).toBe(201);
  const pedido = await r.json();
  expect(Number(pedido.total)).toBe(2000);
  // as etiquetas abrem nas Configurações
  await page.evaluate(() => carregarModulo('configuracoes'));
  await page.click('button:has-text("Etiquetas")');
  await expect(page.locator('#modal-box')).toContainText('Camarão e2e');
  expect(erros).toEqual([]);
});
