'use strict';
/**
 * Fluxos principais num navegador real: entrar, vender ao balcão, receber no Caixa e o portal do cliente.
 * Apanha o que os testes em vm não vêem: erros de execução no navegador, violações da CSP, ecrãs que não abrem.
 */
const { test, expect } = require('@playwright/test');

const DONO = { email: 'dono@e2e.ao', palavraPasse: '246810' };

/** Falha o teste se o navegador registar erros (inclui violações da CSP e handlers inline bloqueados). */
function vigiarErros(page) {
  const erros = [];
  page.on('pageerror', e => erros.push(`pageerror: ${e.message}`));
  // falhas de rede de recursos externos (tipos de letra, etc.) não contam; as do próprio servidor contam
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(`console: ${m.text()}`); });
  page.on('requestfailed', r => { if (r.url().startsWith('http://127.0.0.1') && !/\/socket\.io\//.test(r.url()) && r.resourceType() !== 'other') erros.push(`pedido falhou: ${r.url()} ${r.failure() && r.failure().errorText}`); });
  page.on('response', r => { if (r.url().startsWith('http://127.0.0.1') && r.status() >= 500) erros.push(`HTTP ${r.status()}: ${r.url()}`); });
  return erros;
}

async function entrar(page) {
  await page.goto('/');
  await page.fill('#login-email', DONO.email);
  await page.fill('#login-senha', DONO.palavraPasse);
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();
}
const menu = (page, modulo) => page.click(`.nav-item[data-modulo="${modulo}"]`);

test('entrar mostra o Dashboard sem erros no navegador', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page);
  await expect(page.locator('#topbar-titulo')).toHaveText(/Dashboard/);
  await page.waitForTimeout(500);
  expect(erros).toEqual([]);
});

test('venda ao balcão e recebimento no Caixa com factura-recibo', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page);

  // abrir o caixa do dia
  await menu(page, 'caixa');
  // (numa repetição do CI o caixa já pode estar aberto)
  await page.locator('button:has-text("Abrir caixa"), button:has-text("Fechar caixa")').first().waitFor();
  if (await page.locator('button:has-text("Abrir caixa")').count()) {
    await page.fill('#cx-fundo', '5000');
    await page.click('button:has-text("Abrir caixa")');
    await expect(page.locator('button:has-text("Fechar caixa")')).toBeVisible();
  }

  // vender ao balcão: 2 Picanhas + 1 Cuca
  await menu(page, 'balcao');
  const picanha = page.locator('.venda-produto', { hasText: 'Picanha' });
  await picanha.click(); await picanha.click();
  await page.locator('.venda-produto', { hasText: 'Cuca' }).click();
  await page.click('button:has-text("Enviar pedido")');
  await expect(page.locator('.toast').last()).toBeVisible();

  // a cozinha serve e o pedido fecha (API, como faria o ecrã de pedidos)
  await page.evaluate(async () => {
    const h = { Authorization: `Bearer ${NUK.token}`, 'Content-Type': 'application/json' };
    const lista = await (await fetch('/api/pedidos?limit=5', { headers: h })).json();
    const p = (lista.data || lista).find(x => x.status !== 'FECHADO' && x.status !== 'CANCELADO');
    await fetch(`/api/pedidos/${p.id}/status`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'FECHADO' }) });
  });

  // receber com TPA e pedir a factura-recibo
  await menu(page, 'recebimentos');
  await page.locator('button', { hasText: /^Receber/ }).first().click();
  await expect(page.locator('#rc-metodo')).toBeVisible();
  await page.selectOption('#rc-metodo', 'TPA');
  await page.check('#rc-fr');
  await page.fill('#rc-fr-nif', '5417000000');
  const descarga = page.waitForEvent('download');
  await page.click('button:has-text("Confirmar recebimento")');
  await expect(page.locator('.toast', { hasText: 'Recebido' })).toBeVisible();
  expect((await descarga).suggestedFilename()).toMatch(/^FR-2\d{3}-\d{6}\.pdf$/);
  expect(erros).toEqual([]);
});

test('portal do cliente: abre sem erros e mostra os preços reais do alojamento', async ({ page }) => {
  const erros = vigiarErros(page);
  await page.goto('/cliente?r=e2e-casa');
  await expect(page.locator('body')).toBeVisible();
  // os ecrãs do portal trocam por data-action; abre Serviços directamente
  await page.evaluate(() => go('s-servicos'));
  await expect(page.locator('#grid-hospedagem')).toContainText('SUITE');
  await expect(page.locator('#grid-hospedagem')).toContainText(/15\s?000 Kz/);
  expect(erros).toEqual([]);
});
