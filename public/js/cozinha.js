'use strict';
/**
 * Ecrã de cozinha e bar (KDS): cartões por pedido, os mais antigos primeiro, com cor pelo tempo de espera.
 * Toque no item ou no botão do cartão para avançar: Aguardando → A preparar → Pronto → Entregue.
 * Actualiza em tempo real (socket) e a cada 20 s. Sem handlers inline (CSP).
 */
const ESTADOS_KDS = { AGUARDANDO: 'Aguardando', PREPARANDO: 'A preparar', PRONTO: 'Pronto', ENTREGUE: 'Entregue' };
const BOTAO_KDS = { AGUARDANDO: 'Começar', PREPARANDO: 'Pronto', PRONTO: 'Entregue' };
const ORIGEM_KDS = { BALCAO: 'Balcão', TAKEAWAY: 'Take Away', REMOTA: 'Remota (QR)', QUARTO: 'Quarto' };
let _kdsTimer = null, _kdsEl = null;

async function modulo_cozinha(el) {
  _kdsEl = el;
  window._kdsPosto = window._kdsPosto || 'COZINHA';
  if (_kdsTimer) clearInterval(_kdsTimer);
  _kdsTimer = setInterval(() => { if (NUK.moduloActual === 'cozinha') recarregarCozinha(); else { clearInterval(_kdsTimer); _kdsTimer = null; } }, 20000);
  await recarregarCozinha();
}

async function recarregarCozinha() {
  const el = _kdsEl; if (!el) return;
  const posto = window._kdsPosto;
  try {
    const lista = await api('GET', `/cozinha?posto=${posto}`) || [];
    el.innerHTML = `
      <div class="toolbar" style="flex-wrap:wrap;gap:.5rem">
        <span class="secao-titulo">👨‍🍳 ${posto === 'BAR' ? 'Bar' : 'Cozinha'} <span class="muted texto-pequeno">${lista.length} pedido(s)</span></span>
        <span style="display:flex;gap:.4rem">
          <button class="btn-${posto === 'COZINHA' ? 'primario' : 'secundario'}" data-on-click="mudarPostoKds('COZINHA')">🍳 Cozinha</button>
          <button class="btn-${posto === 'BAR' ? 'primario' : 'secundario'}" data-on-click="mudarPostoKds('BAR')">🍹 Bar</button>
        </span>
      </div>
      ${lista.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.8rem">${lista.map(cartaoKds).join('')}</div>`
        : '<div class="card muted" style="text-align:center;padding:2rem">Nada por preparar. 👌</div>'}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}

function cartaoKds(p) {
  const cor = p.minutos >= 25 ? 'var(--c-danger,#ef4444)' : p.minutos >= 15 ? '#f59e0b' : 'var(--c-border)';
  const onde = p.mesa ? `Mesa ${esc(p.mesa)}` : p.quarto ? `Quarto ${esc(p.quarto)}` : (ORIGEM_KDS[p.origem] || esc(p.origem));
  const menos = ['AGUARDANDO', 'PREPARANDO', 'PRONTO'].find(s => p.itens.some(i => i.status === s)) || 'PRONTO';
  return `<div class="card" style="border:2px solid ${cor};padding:.7rem">
    <div class="toolbar" style="margin:0 0 .4rem"><b style="font-size:1.1rem">${onde}</b><span class="negrito" style="color:${p.minutos >= 15 ? cor : 'inherit'}">${p.minutos} min</span></div>
    <div class="muted texto-pequeno" style="margin-bottom:.4rem">${p.cliente ? esc(p.cliente) + ' · ' : ''}${p.funcionario ? esc(p.funcionario) : ''}</div>
    ${p.itens.map(i => `<button class="btn-secundario" style="display:flex;justify-content:space-between;width:100%;margin:.2rem 0;text-align:left;${i.status === 'PRONTO' ? 'opacity:.6;text-decoration:line-through' : ''}" data-on-click="avancarItemKds('${esc(p.id)}','${esc(i.id)}')">
        <span><b>${i.quantidade}×</b> ${esc(i.produto)}${i.observacoes ? `<span class="texto-pequeno" style="display:block;color:#f59e0b">${esc(i.observacoes)}</span>` : ''}</span>
        <span class="texto-pequeno">${ESTADOS_KDS[i.status]}</span></button>`).join('')}
    ${p.observacoes ? `<div class="texto-pequeno" style="margin:.3rem 0;color:#f59e0b">📝 ${esc(p.observacoes)}</div>` : ''}
    <div style="display:flex;gap:.4rem;margin-top:.4rem">
      <button class="btn-secundario" title="Reimprimir talão" data-on-click="reimprimirKds('${esc(p.id)}')">🖨️</button>
      <button class="btn-primario" style="flex:1" data-on-click="avancarPedidoKds('${esc(p.id)}')">${BOTAO_KDS[menos]} ${menos === 'PRONTO' ? '' : 'tudo'}</button>
    </div>
  </div>`;
}

async function reimprimirKds(pedidoId) {
  if (typeof impConfig !== 'function' || impConfig().ligacao === 'NENHUMA') { toast('Ligue uma impressora neste dispositivo (botão 🖨️ no topo)', 'aviso'); return; }
  try { await impEnviar(await api('GET', `/impressao/preparacao/${pedidoId}?posto=${window._kdsPosto}&colunas=${impConfig().colunas}`)); toast('Talão reimpresso', 'sucesso'); }
  catch (e) { toast(e.message, 'erro'); }
}
function mudarPostoKds(posto) { window._kdsPosto = posto; recarregarCozinha(); }
async function avancarItemKds(pedidoId, itemId) {
  try { await api('POST', `/cozinha/pedidos/${pedidoId}/itens/${itemId}/avancar`, {}); recarregarCozinha(); } catch (e) { toast(e.message, 'erro'); }
}
async function avancarPedidoKds(pedidoId) {
  try { await api('POST', `/cozinha/pedidos/${pedidoId}/avancar`, { posto: window._kdsPosto }); recarregarCozinha(); } catch (e) { toast(e.message, 'erro'); }
}

// ── Configurações → posto de cada categoria (só ADMIN) ──
async function modalPostosPreparacao() {
  try {
    const [r, listas] = await Promise.all([api('GET', '/cozinha/postos'), api('GET', '/listas/CATEGORIA_PRODUTO')]);
    const cats = (Array.isArray(listas) ? listas : []).filter(o => o.ativo).map(o => o.valor);
    window._postosCats = cats;
    abrirModal('Cozinha e bar · onde se prepara cada categoria', `
      <p class="muted texto-pequeno" style="margin-bottom:.5rem">«Nenhum» = não aparece nos ecrãs (ex.: loja, cigarros). Categorias novas vão para a Cozinha.</p>
      ${cats.map((c, k) => `<div style="display:flex;justify-content:space-between;align-items:center;margin:.25rem 0"><span>${esc(c)}</span>
        <select id="posto-${k}">${['COZINHA', 'BAR', 'NENHUM'].map(o => `<option value="${o}" ${(r.postos[c] || 'COZINHA') === o ? 'selected' : ''}>${{ COZINHA: 'Cozinha', BAR: 'Bar', NENHUM: 'Nenhum' }[o]}</option>`).join('')}</select></div>`).join('')}
      <button class="btn-primario btn-bloco" style="margin-top:.6rem" data-on-click="guardarPostosPreparacao()">Guardar</button>`);
  } catch (e) { toast(e.message, 'erro'); }
}
async function guardarPostosPreparacao() {
  const postos = {};
  (window._postosCats || []).forEach((c, k) => { postos[c] = document.getElementById(`posto-${k}`).value; });
  try { await api('PUT', '/cozinha/postos', { postos }); toast('Postos guardados', 'sucesso'); fecharModal(); } catch (e) { toast(e.message, 'erro'); }
}
