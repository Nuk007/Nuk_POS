'use strict';
// Abre um módulo pelo menu lateral como uma pessoa: o menu é um acordeão (22/11/2026), por isso, se o módulo
// estiver numa categoria fechada, toca primeiro no título da categoria e só depois no módulo.
async function menu(page, modulo) {
  const item = page.locator(`.nav-item[data-modulo="${modulo}"]`);
  if (!(await item.isVisible())) {
    await page.locator('.nav-grupo', { has: item }).locator('.nav-titulo').click();
  }
  await item.click();
}
module.exports = { menu };
