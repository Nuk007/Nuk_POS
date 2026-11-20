'use strict';
/** Cartões num navegador real: botões como os quartos, gerar o lote (descarrega a folha) e vender 2 cartões pelos códigos. */
const { test, expect } = require('@playwright/test');

test('Administrador gera o lote em Configurações; o Caixa vende 2 pela grelha, cobrando o valor impresso', async ({ page }) => {
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

  // o Caixa não gera códigos: só o Administrador, em Configurações
  await page.click('.nav-item[data-modulo="cartoes"]');
  for (const v of ['2.000', '3.000', '25.000']) await expect(page.locator('.cartao-card', { hasText: new RegExp(`^\\s*${v} Kz`) }).first()).toBeVisible();
  await expect(page.locator('#main-content button:has-text("Gerar")')).toHaveCount(0);

  await page.click('.nav-item[data-modulo="configuracoes"]');
  await expect(page.getByText('GERAR CÓDIGOS (LOTES PARA IMPRIMIR)')).toBeVisible();
  await page.selectOption('#lote-valor', '3000');
  await page.fill('#lote-qtd', '4');
  const descarga = page.waitForEvent('download');
  await page.click('button:has-text("Gerar lote")');
  expect((await descarga).suggestedFilename()).toMatch(/^cartoes-lote-\d+\.pdf$/);
  await expect(page.locator('#main-content tr', { hasText: /N\.º \d+/ }).first()).toBeVisible(); // Configurações recarregadas com o lote
  await page.click('.nav-item[data-modulo="cartoes"]');
  await expect(page.locator('#topbar-titulo')).toHaveText(/Cartões de consumo/);

  // dois códigos do lote acabado de gerar (o operador lê-os nas cartolinas)
  const codigos = await page.evaluate(async () => {
    const h = { Authorization: `Bearer ${NUK.token}` };
    const lotes = await (await fetch('/api/caixa/cartoes/lotes', { headers: h })).json();
    const det = await (await fetch(`/api/caixa/cartoes/lotes/${lotes[0].id}`, { headers: h })).json();
    return det.cartoes.filter(c => c.estado === 'POR_VENDER').slice(0, 2).map(c => c.codigo);
  });

  const botao = page.locator('.cartao-card', { hasText: /^\s*3.000 Kz/ });
  await expect(botao).toContainText('impressos por vender');
  await botao.click();
  await page.click('button:has-text("+")');
  await expect(page.locator('#vc-cod-1')).toBeVisible();
  await expect(page.locator('#vc-total')).toContainText(/6.000 Kz/); // 2 × 3 000, sem desconto
  await page.selectOption('#vc-metodo', 'CASH');
  await page.fill('#vc-cod-0', codigos[0].toLowerCase());
  await page.fill('#vc-cod-1', codigos[1]);
  await page.click('button:has-text("Validar venda")');
  await expect(page.getByText('Venda concluída')).toBeVisible();
  for (const c of codigos) await expect(page.getByText(c).first()).toBeVisible();
  const estados = await page.evaluate(async cods => Promise.all(cods.map(async cod => (await (await fetch(`/api/caixa/cartoes/${cod}`, { headers: { Authorization: `Bearer ${NUK.token}` } })).json()))), codigos);
  expect(estados.map(c => [c.estado, Number(c.saldo)])).toEqual([['ACTIVO', 3000], ['ACTIVO', 3000]]);
  expect(erros).toEqual([]);
});
