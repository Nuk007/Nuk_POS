'use strict';
/**
 * Botão «voltar» (pedido do dono, 21/11/2026, «como no AviationMoney»): não fecha o Nuk_POS; fecha a janela ou o
 * menu, sai do painel de venda para a lista, ou volta ao módulo anterior. No primeiro ecrã pede um segundo toque.
 */
const { test, expect } = require('@playwright/test');
const { menu } = require('./menu');

function vigiarErros(page) {
  const erros = [];
  page.on('pageerror', e => erros.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(`console: ${m.text()}`); });
  return erros;
}
async function entrar(page) {
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#topbar-titulo')).toHaveText(/Dashboard/);
}
const titulo = page => page.locator('#topbar-titulo');
const voltar = page => page.goBack().catch(() => {}); // entradas do mesmo documento: o goBack não navega

test('voltar: painel da mesa → lista das mesas → módulo anterior → Dashboard → segundo toque para sair', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page);
  await menu(page, 'caixa');
  await expect(titulo(page)).toHaveText(/Caixa do dia/);
  await menu(page, 'mesas');
  await expect(titulo(page)).toHaveText(/Mesa/);
  await page.locator('[data-on-click^="abrirVendaMesa"]').first().click();
  await expect(page.locator('#venda-grelha')).toBeVisible();

  await voltar(page); // sai do painel para a lista das mesas
  await expect(page.locator('#venda-grelha')).toHaveCount(0);
  await expect(page.locator('[data-on-click^="abrirVendaMesa"]').first()).toBeVisible();
  await expect(titulo(page)).toHaveText(/Mesa/);

  await voltar(page); // módulo anterior
  await expect(titulo(page)).toHaveText(/Caixa do dia/);
  await voltar(page);
  await expect(titulo(page)).toHaveText(/Dashboard/);

  await voltar(page); // no primeiro ecrã: avisa e não sai
  await expect(page.locator('.toast', { hasText: 'Toque outra vez' })).toBeVisible();
  await expect(page.locator('#app')).toBeVisible();
  expect(page.url()).toMatch(/127\.0\.0\.1:3999\/?$/);
  expect(erros).toEqual([]);
});

test('voltar fecha a janela aberta; fechada pelo botão, o voltar seguinte já muda de ecrã', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page);
  await menu(page, 'caixa');
  await expect(titulo(page)).toHaveText(/Caixa do dia/);
  await page.evaluate(() => abrirModal('Teste', '<p>Janela de teste</p>'));
  await expect(page.locator('#modal-overlay')).toBeVisible();
  await voltar(page);
  await expect(page.locator('#modal-overlay')).toBeHidden();
  await expect(titulo(page)).toHaveText(/Caixa do dia/);

  await page.evaluate(() => abrirModal('Teste', '<p>Outra</p>'));
  await page.click('#modal-overlay .btn-fechar-modal, #modal-overlay [data-action="fechar-modal"] button');
  await expect(page.locator('#modal-overlay')).toBeHidden();
  await voltar(page); // a entrada da janela já foi retirada: volta logo ao Dashboard
  await expect(titulo(page)).toHaveText(/Dashboard/);
  expect(erros).toEqual([]);
});

test('telemóvel: voltar fecha o menu lateral; escolher no menu e voltar regressa ao módulo anterior', async ({ page }) => {
  const erros = vigiarErros(page);
  await page.setViewportSize({ width: 400, height: 860 });
  await entrar(page);
  await page.click('.btn-menu');
  await expect(page.locator('#sidebar')).toHaveClass(/aberta/);
  await voltar(page);
  await expect(page.locator('#sidebar')).not.toHaveClass(/aberta/);
  await expect(titulo(page)).toHaveText(/Dashboard/);

  await page.click('.btn-menu');
  await menu(page, 'caixa');
  await expect(titulo(page)).toHaveText(/Caixa do dia/);
  await expect(page.locator('#sidebar')).not.toHaveClass(/aberta/);
  await voltar(page);
  await expect(titulo(page)).toHaveText(/Dashboard/);
  expect(erros).toEqual([]);
});

test('janela fechada e outra aberta logo a seguir, ou janela fechada com mudança de módulo: o histórico fica certo', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page);
  // fechar e abrir outra no mesmo instante (ex.: confirmação depois de um formulário)
  await page.evaluate(() => { abrirModal('Um', '<p>1</p>'); });
  await page.evaluate(() => { fecharModal(); abrirModal('Dois', '<p>2</p>'); });
  await expect(page.locator('#modal-titulo')).toHaveText('Dois');
  await voltar(page);
  await expect(page.locator('#modal-overlay')).toBeHidden();
  await expect(titulo(page)).toHaveText(/Dashboard/);
  // fechar a janela e mudar de módulo no mesmo instante (ex.: «Ir para Receber mesas»)
  await page.evaluate(() => { abrirModal('Três', '<p>3</p>'); });
  await page.evaluate(() => { fecharModal(); carregarModulo('caixa'); });
  await expect(titulo(page)).toHaveText(/Caixa do dia/);
  await page.waitForTimeout(300);
  await voltar(page);
  await expect(titulo(page)).toHaveText(/Dashboard/);
  expect(erros).toEqual([]);
});
