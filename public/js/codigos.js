'use strict';
/**
 * Códigos de barras (21/11/2026, pedido do dono: funções do WinREST que faltavam).
 *  - Painel de venda: campo «Ler código de barras». Os leitores USB/Bluetooth «escrevem» o código e carregam Enter,
 *    o que dispara o `change` do campo. Procura-se primeiro nos produtos do painel (funciona sem internet); se não
 *    estiver lá, pergunta-se ao servidor só para explicar porquê (não existe, indisponível ou não se vende neste fluxo).
 *  - Configurações → Ementa → «🏷️ Etiquetas»: folha A4 com 24 etiquetas por página (PDF do servidor).
 */

async function vendaCodigo(valor) {
  const codigo = String(valor || '').trim();
  const campo = document.getElementById('venda-codigo');
  if (campo) campo.value = '';
  if (!codigo) return;
  const v = window._venda; if (!v) return;
  const i = v.produtos.findIndex(p => p.codigo_barras && String(p.codigo_barras) === codigo);
  if (i >= 0) { vendaAdd(i); setTimeout(() => document.getElementById('venda-codigo')?.focus(), 30); return; }
  try {
    const p = await api('GET', `/produtos/codigo/${encodeURIComponent(codigo)}`);
    toast(`${p.nome} não se vende em ${ROTULO_ORIGEM[v.origem] || 'este fluxo'}`, 'aviso', 5000);
  } catch (e) { toast(e.semRede ? `Código ${codigo} não encontrado neste dispositivo` : e.message, 'erro', 5000); }
  setTimeout(() => document.getElementById('venda-codigo')?.focus(), 30);
}

// ── Etiquetas (Configurações → Ementa) ──────────────────────
function modalEtiquetas() {
  const prods = (window._produtosCfg || []).filter(p => p.ativo !== false);
  if (!prods.length) { toast('Ainda não há produtos', 'aviso'); return; }
  abrirModal('🏷️ Etiquetas com código de barras', `
    <p class="muted texto-pequeno mb-2">Folha A4 com 24 etiquetas por página (70 × 37 mm, autocolantes 3 × 8). Os produtos sem código recebem um código interno, que o leitor passa a reconhecer.</p>
    <div style="max-height:50vh;overflow:auto;margin-bottom:.75rem">
      ${prods.map(p => `<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--c-border)">
        <input type="checkbox" class="etq-sel" value="${esc(p.id)}" style="width:auto;margin:0">
        <span style="flex:1;min-width:0">${esc(p.nome)} <span class="muted texto-pequeno">${formatarMoeda(p.preco)}${p.vendido_ao_peso ? ' / kg' : ''}${p.codigo_barras ? ' · ' + esc(p.codigo_barras) : ' · sem código'}</span></span>
        <input type="number" class="etq-copias" data-id="${esc(p.id)}" min="1" max="100" value="1" style="width:4.5rem" title="Cópias">
      </div>`).join('')}
    </div>
    <button class="btn-primario btn-bloco" data-on-click="imprimirEtiquetas()">Descarregar a folha (PDF)</button>`);
}
function imprimirEtiquetas() {
  const copias = {};
  document.querySelectorAll('.etq-copias').forEach(x => { copias[x.getAttribute('data-id')] = x.value; });
  const sel = Array.from(document.querySelectorAll('.etq-sel')).filter(x => x.checked).map(x => x.value);
  if (!sel.length) { toast('Escolha pelo menos um produto', 'erro'); return; }
  const itens = sel.map(id => {
    const n = Math.min(100, Math.max(1, parseInt(copias[id], 10) || 1));
    return `${id}:${n}`;
  });
  descarregarPdf(`/produtos/etiquetas.pdf?itens=${encodeURIComponent(itens.join(','))}`, 'etiquetas.pdf');
  fecharModal();
  setTimeout(() => carregarModulo('configuracoes'), 1500); // os códigos gerados aparecem na ementa
}
