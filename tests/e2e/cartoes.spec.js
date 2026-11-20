'use strict';
/** Cartões pré-impressos num navegador real: gerar o lote (descarrega a folha) e vender um cartão pelo código. */
const { test, expect } = require('@playwright/test');

test('gerar lote de cartões de 3 000 Kz e vender um pelo código, cobrando o valor impresso', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text()); });
  page.on('response', r => { if (r.url().startsWith('http://127.0.0.1') && r.status() >= 500) erros.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();

  // abrir o caixa (pode já estar aberto por outro teste)
  await page.click('.nav-item[data-modulo="caixa"]');
  await page.locator('button:has-text("Abrir caixa"), button:has-text("Fechar caixa")').first().waitFor();
  if (await page.locator('button:has-text("Abrir caixa")').count()) {
    await page.click('button:has-text("Abrir caixa")');
    await expect(page.locator('button:has-text("Fechar caixa")')).toBeVisible();
  }

  await page.click('.nav-item[data-modulo="cartoes"]');
  for (const v of ['2 000', '3 000', '25 000']) await expect(page.locator('button', { hasText: new RegExp(v.replace(' ', '.')) }).first()).toBeVisible();
  await page.selectOption('#lote-valor', '3000');
  await page.fill('#lote-qtd', '4');
  const descarga = page.waitForEvent('download');
  await page.click('button:has-text("Gerar lote")');
  expect((await descarga).suggestedFilename()).toMatch(/^cartoes-lote-\d+\.pdf$/);

  // um código do lote acabado de gerar (o operador lê-o na cartolina)
  const codigo = await page.evaluate(async () => {
    const h = { Authorization: `Bearer ${NUK.token}` };
    const lotes = await (await fetch('/api/caixa/cartoes/lotes', { headers: h })).json();
    const det = await (await fetch(`/api/caixa/cartoes/lotes/${lotes[0].id}`, { headers: h })).json();
    return det.cartoes.find(c => c.estado === 'POR_VENDER').codigo;
  });

  await page.selectOption('#cc-metodo', 'CASH');
  await page.fill('#cc-codigo', codigo.toLowerCase());
  await page.click('button:has-text("Vender") >> nth=0');
  await expect(page.getByText(/Cobrar ao cliente/)).toBeVisible();
  await expect(page.locator('button', { hasText: /Recebi 3.000/ })).toBeVisible(); // valor impresso, sem desconto
  await page.click('button:has-text("Recebi")');
  await expect(page.getByText('Cartão vendido')).toBeVisible();
  const c = await page.evaluate(async cod => (await (await fetch(`/api/caixa/cartoes/${cod}`, { headers: { Authorization: `Bearer ${NUK.token}` } })).json()), codigo);
  expect(c.estado).toBe('ACTIVO');
  expect(Number(c.saldo)).toBe(3000);
  expect(erros).toEqual([]);
});
