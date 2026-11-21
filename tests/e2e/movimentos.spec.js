'use strict';
/** Rasto do caixa num navegador real: lista de movimentos, verificação da integridade, rasto do cartão e CSV. */
const { test, expect } = require('@playwright/test');

test('movimentos do caixa: pesquisa, verificação, rasto de cartão e exportação', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text()); });
  page.on('response', r => { if (r.url().startsWith('http://127.0.0.1') && r.status() >= 500) erros.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();

  // um movimento conhecido: abrir o caixa (se preciso), o Administrador gera um cartão de 6 000 Kz e o caixa vende-o
  const codigo = await page.evaluate(async () => {
    const h = { Authorization: `Bearer ${NUK.token}`, 'Content-Type': 'application/json' };
    const e = await (await fetch('/api/caixa', { headers: h })).json();
    if (!e.aberta) await fetch('/api/caixa/abrir', { method: 'POST', headers: h, body: JSON.stringify({ fundo_inicial: 0 }) });
    const l = await (await fetch('/api/caixa/cartoes/lotes', { method: 'POST', headers: h, body: JSON.stringify({ valor: 6000, quantidade: 10 }) })).json();
    const cod = (await (await fetch(`/api/caixa/cartoes/lotes/${l.id}`, { headers: h })).json()).cartoes[0].codigo;
    await fetch('/api/caixa/cartoes/vender', { method: 'POST', headers: h, body: JSON.stringify({ valor: 6000, metodo: 'CASH', codigos: [cod] }) });
    return cod;
  });

  await page.click('.nav-item[data-modulo="movimentos"]');
  await expect(page.locator('#topbar-titulo')).toHaveText(/Movimentos do caixa/);
  const linha = page.locator('#mv-resultado tr', { hasText: codigo });
  await expect(linha).toBeVisible();
  await expect(linha).toContainText('Venda de cartão');

  await page.click('button:has-text("Verificar integridade")');
  await expect(page.getByText('Livro do caixa íntegro')).toBeVisible();
  await page.click('button:has-text("Fechar")');

  await linha.locator('button:has-text("Rasto")').click();
  await expect(page.getByText(`Cartão ${codigo}`).first()).toBeVisible();
  await page.click('button:has-text("Fechar")');

  await page.fill('#mv-cartao', codigo);
  await page.click('button:has-text("Pesquisar")');
  await expect(page.locator('#mv-resultado tbody tr')).toHaveCount(1);

  const descarga = page.waitForEvent('download');
  await page.click('button:has-text("Exportar CSV")');
  expect((await descarga).suggestedFilename()).toMatch(/^movimentos-caixa-.*\.csv$/);
  expect(erros).toEqual([]);
});
