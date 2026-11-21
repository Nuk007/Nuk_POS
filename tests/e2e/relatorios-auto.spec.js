'use strict';
/**
 * Configuração de relatórios e relatórios gerados (21/11/2026), no navegador real: os cartões das Configurações
 * carregam sem erros; em Relatórios gera-se um relatório à mão, abre-se e descarrega-se o PDF.
 */
const { test, expect } = require('@playwright/test');

test('Configuração de relatórios e «Relatórios gerados» funcionam sem erros', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text()); });
  page.on('response', r => { if (r.status() >= 500) erros.push(`${r.status()} ${r.url()}`); });
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();

  await page.click('.nav-item[data-modulo="configuracoes"]');
  await expect(page.locator('#cfg-relatorios', { hasText: 'CONFIGURAÇÃO DE RELATÓRIOS' })).toBeVisible();
  await expect(page.locator('#cfg-relatorios-auto', { hasText: 'Geração automática' })).toBeVisible();
  // acrescenta um item às bebidas e guarda o modelo
  await page.locator('#cfg-relatorios button', { hasText: '+ Item' }).first().click();
  await page.locator('#cfg-relatorios .fm-inome[data-g="0"]').last().fill('Cuca garrafa');
  await page.locator('#cfg-relatorios button', { hasText: 'Guardar o modelo' }).click();
  await expect(page.locator('#cfg-relatorios button', { hasText: 'Repor o padrão' })).toBeVisible();
  // o Administrador suspende um relatório (com confirmação) e volta a activá-lo
  await page.locator('#cfg-relatorios-auto tr', { hasText: 'Quebras e desperdício' }).locator('button', { hasText: 'Suspender' }).click();
  await page.locator('button', { hasText: 'Sim, confirmar' }).click();
  await expect(page.locator('#cfg-relatorios-auto tr', { hasText: 'Quebras e desperdício' })).toContainText('Suspenso');
  await page.locator('#cfg-relatorios-auto tr', { hasText: 'Quebras e desperdício' }).locator('button', { hasText: 'Activar' }).click();
  await expect(page.locator('#cfg-relatorios-auto tr', { hasText: 'Quebras e desperdício' })).toContainText('Activo');
  await page.locator('#cfg-relatorios-auto button', { hasText: 'Guardar a geração automática' }).click();
  await expect(page.locator('#cfg-relatorios-auto button', { hasText: 'Repor o padrão' })).toBeVisible();

  await page.click('.nav-item[data-modulo="relatorios"]');
  await expect(page.locator('#rel-gerados', { hasText: 'RELATÓRIOS GERADOS' })).toBeVisible();
  await page.selectOption('#relg-tipo', 'VENDAS');
  await page.locator('#rel-gerados button', { hasText: 'Gerar' }).click();
  await expect(page.locator('.modal-overlay, #modal, .modal').filter({ hasText: 'Descarregar PDF' }).first()).toBeVisible();
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'Descarregar PDF' }).first().click()]);
  expect(descarga.suggestedFilename()).toMatch(/vendas-\d{4}-\d{2}-\d{2}\.pdf/);
  expect(erros).toEqual([]);
});
