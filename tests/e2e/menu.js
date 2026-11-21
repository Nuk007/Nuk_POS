'use strict';
// Abre um módulo pelo menu lateral como uma pessoa: o menu é um acordeão (22/11/2026) com categorias e, dentro
// de algumas (Vendas, Administração), subcategorias. Toca no que estiver fechado e só depois no módulo.
async function menu(page, modulo) {
  const item = page.locator(`.nav-item[data-modulo="${modulo}"]`);
  if (!(await item.isVisible())) {
    const grupo = page.locator('.nav-grupo', { has: item });
    if (!(await grupo.evaluate(g => g.classList.contains('aberto')))) await grupo.locator('.nav-titulo').click();
    const sub = page.locator('.nav-sub', { has: item });
    if ((await sub.count()) && !(await sub.evaluate(s => s.classList.contains('aberto')))) await sub.locator('.nav-subtitulo').click();
  }
  await item.click();
}
module.exports = { menu };
