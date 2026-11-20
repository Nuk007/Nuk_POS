'use strict';
/**
 * Fecho do caixa num navegador real (regras do dono, 20/11/2026): com contas por pagar o ecrã mostra-as e não deixa
 * fechar; com a contagem errada pede a justificação e só fecha com ela.
 */
const { test, expect } = require('@playwright/test');

test('fecho do caixa: contas por pagar bloqueiam; diferença exige justificação', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 860 });
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push(m.text()); });
  page.on('response', r => { if (r.url().startsWith('http://127.0.0.1') && r.status() >= 500) erros.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto('/');
  await page.fill('#login-email', 'dono@e2e.ao');
  await page.fill('#login-senha', '246810');
  await page.click('#btn-entrar');
  await expect(page.locator('#app')).toBeVisible();

  // caixa aberto e uma conta de balcão fechada por receber
  const pedidoId = await page.evaluate(async () => {
    const h = { Authorization: `Bearer ${NUK.token}`, 'Content-Type': 'application/json' };
    const e = await (await fetch('/api/caixa', { headers: h })).json();
    if (!e.aberta) await fetch('/api/caixa/abrir', { method: 'POST', headers: h, body: JSON.stringify({ fundo_inicial: 0 }) });
    const prods = await (await fetch('/api/produtos?limit=50', { headers: h })).json();
    const prod = (prods.data || prods).find(p => Number(p.preco) > 0);
    const p = await (await fetch('/api/pedidos', { method: 'POST', headers: h, body: JSON.stringify({ origem: 'BALCAO', itens: [{ produto_id: prod.id, quantidade: 1 }] }) })).json();
    await fetch(`/api/pedidos/${p.id}/status`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'FECHADO' }) });
    return p.id;
  });

  await page.evaluate(() => carregarModulo('caixa'));
  await expect(page.locator('#topbar-titulo')).toHaveText(/Caixa/);
  await page.click('button:has-text("Fechar caixa")');
  await expect(page.getByText('Não pode fechar o caixa:')).toBeVisible();
  await expect(page.locator('#modal-box button:has-text("Fechar caixa")')).toHaveCount(0);
  await page.screenshot({ path: process.env.E2E_CAPTURAS ? `${process.env.E2E_CAPTURAS}/fecho-1-contas.png` : undefined });
  await page.click('button:has-text("Ir para Receber mesas")');
  await expect(page.locator('#topbar-titulo')).toHaveText(/Receber/);

  // recebe todas as contas em aberto (as deste teste e as que outros testes deixaram)
  await page.evaluate(async () => {
    const h = { Authorization: `Bearer ${NUK.token}`, 'Content-Type': 'application/json' };
    const e = await (await fetch('/api/caixa', { headers: h })).json();
    for (const c of e.pendencias.contas.filter(c => c.status !== 'FECHADO')) {
      await fetch(`/api/pedidos/${c.id}/status`, { method: 'PATCH', headers: h, body: JSON.stringify({ status: c.por_validar ? 'CANCELADO' : 'FECHADO' }) });
    }
    const f = (await (await fetch('/api/caixa', { headers: h })).json()).pendencias.contas.map(c => c.id);
    if (f.length) await fetch('/api/caixa/receber', { method: 'POST', headers: h, body: JSON.stringify({ pedido_ids: f, metodo: 'TPA' }) });
  });
  expect(pedidoId).toBeTruthy();

  await page.evaluate(() => carregarModulo('caixa'));
  await expect(page.locator('#topbar-titulo')).toHaveText(/Caixa/);
  await page.click('button:has-text("Fechar caixa")');
  const esperado = await page.evaluate(() => window._caixaEstado.resumo.dinheiro_esperado);
  await page.fill('#cx-contado', String(esperado + 100));
  await expect(page.locator('#cx-just')).toBeVisible();
  await expect(page.locator('#cx-dif')).toContainText('Sobram 100');
  await page.locator('#modal-box button:has-text("Fechar caixa")').first().click();
  await expect(page.getByText(/escreva a justificação/i).first()).toBeVisible();
  await page.fill('#cx-just', 'Troco dado a mais na mesa 4');
  await page.screenshot({ path: process.env.E2E_CAPTURAS ? `${process.env.E2E_CAPTURAS}/fecho-2-justificacao.png` : undefined });
  await page.locator('#modal-box button:has-text("Fechar caixa")').first().click();
  await expect(page.getByText(/Caixa fechado com diferença justificada/)).toBeVisible();
  await expect(page.getByText('Justificação: Troco dado a mais na mesa 4')).toBeVisible(); // no histórico
  await page.screenshot({ path: process.env.E2E_CAPTURAS ? `${process.env.E2E_CAPTURAS}/fecho-3-historico.png` : undefined });

  // volta a abrir para os testes seguintes encontrarem o caixa como esperam
  await page.evaluate(async () => {
    await fetch('/api/caixa/abrir', { method: 'POST', headers: { Authorization: `Bearer ${NUK.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fundo_inicial: 0 }) });
  });
  expect(erros).toEqual([]);
});
