'use strict';
/**
 * Folha de Caixa diária (21/11/2026) — Caixa → «📄 Folha de caixa» (só a chefia). Mostra a folha do dia escolhido
 * (abertura, saídas por área, vendas por grupo, J, K, fecho A+J−D, quebras e alertas) e descarrega o PDF A4.
 * Sem handlers inline (CSP): data-on-click / data-on-change com argumentos literais.
 */
const AREAS_FOLHA = { ESPLANADA_BAR: 'Esplanada / Bar', COZINHA: 'Cozinha', PISCINA: 'Piscina', HOTEL: 'Hotel', TECNICA: 'Técnica', DIVERSOS: 'Diversos' };
const GRUPOS_FOLHA = [['F', 'BEBIDAS', 'Bebidas'], ['G', 'COMIDAS', 'Comidas'], ['H', 'PISCINA', 'Piscina'], ['I', 'QUARTOS', 'Quartos'], ['E', 'OUTROS', 'Shishas, cigarros e diversas']];

function botaoFolhaCaixa() {
  return euChefiaCaixa() ? '<button class="btn-secundario" data-on-click="modalFolhaCaixa()">📄 Folha de caixa</button>' : '';
}

function modalFolhaCaixa() {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
  abrirModal('📄 Folha de Caixa', `
    <div style="display:flex;gap:.5rem;align-items:flex-end;margin-bottom:.6rem">
      <div class="campo" style="flex:1;margin:0"><label>Dia</label><input id="fc-dia" type="date" max="${hoje}" value="${hoje}" data-on-change="folhaCarregar()"></div>
      <button class="btn-primario" data-on-click="folhaDescarregar()">Descarregar PDF</button>
    </div>
    <div id="fc-corpo" class="muted">A calcular…</div>`);
  folhaCarregar();
}

function folhaDia() { const i = document.getElementById('fc-dia'); return i ? i.value : ''; }

async function folhaCarregar() {
  const box = document.getElementById('fc-corpo');
  if (!box) return;
  box.innerHTML = '<span class="muted">A calcular…</span>';
  try {
    const f = await api('GET', `/caixa/folha?dia=${encodeURIComponent(folhaDia())}`);
    box.innerHTML = htmlFolha(f);
  } catch (e) { box.innerHTML = `<div class="erro-msg">${esc(e.message)}</div>`; }
}

function folhaDescarregar() {
  const dia = folhaDia();
  descarregarPdf(`/caixa/folha.pdf?dia=${encodeURIComponent(dia)}`, `folha-caixa-${dia || 'hoje'}.pdf`);
}

function htmlFolha(f) {
  const linha = (t, v, forte) => `<tr><td>${t}</td><td style="text-align:right">${forte ? '<b>' : ''}${v === null ? '—' : formatarMoeda(v)}${forte ? '</b>' : ''}</td></tr>`;
  const saidas = f.saidas.linhas.map(s => `<tr><td>${esc(AREAS_FOLHA[s.area] || s.area)}</td><td>${esc(s.descricao)}${s.pago === 'BANCO' ? ' <span class="muted">(banco)</span>' : ''}</td><td style="text-align:right">${formatarMoeda(s.valor)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">Sem compras nem despesas neste dia</td></tr>';
  const vendas = GRUPOS_FOLHA.map(([l, g, nome]) => {
    const gr = f.vendas.grupos[g];
    if (!gr.linhas.length) return '';
    return `<tr><td colspan="3" style="background:var(--c-surface-2,#222)"><b>(${l}) ${nome}</b> — ${formatarMoeda(gr.total)}</td></tr>`
      + gr.linhas.map(x => `<tr><td>${esc(x.produto)}</td><td style="text-align:right">${esc(fmtQtd(x.quantidade))}</td><td style="text-align:right">${formatarMoeda(x.valor)}</td></tr>`).join('');
  }).join('') || '<tr><td colspan="3" class="muted">Sem vendas pagas neste dia</td></tr>';
  const quebras = f.quebras.linhas.length ? `<p class="texto-pequeno">🍾 Quebras: ${f.quebras.linhas.map(q => `${esc(q.item)} ${q.quantidade} ${esc(q.unidade)}`).join(', ')} — <b>${formatarMoeda(f.quebras.total)}</b> ao custo</p>` : '';
  const alertas = f.alertas.length ? `<div class="card" style="border-left:3px solid var(--c-warning,#f0a500);padding:.5rem .7rem;margin:.5rem 0">${f.alertas.map(a => `<div class="texto-pequeno">⚠ ${esc(a)}</div>`).join('')}</div>` : '';
  return `<div class="muted texto-pequeno" style="margin-bottom:.4rem">Folha n.º ${f.numero}</div>${alertas}
    <table class="texto-pequeno" style="width:100%">
      ${linha('Abertura (A)', f.abertura.A)}
      ${linha('Total vendas (E+F+G+H+I)', f.vendas.total, true)}
      ${linha('Venda caixa — dinheiro (J)', f.entradas.J)}
      ${linha('Venda banco — TPA/transferência/Express (K)', f.entradas.K)}
      ${f.vendas.a_credito ? linha('Lançado em conta corrente (dívidas)', f.vendas.a_credito) : ''}
      ${linha('Saídas (B) — banco (C) ' + formatarMoeda(f.saidas.C) + ' · caixa (D)', f.saidas.D)}
      ${linha('Fecho calculado (A + J − D)', f.fecho.calculado, true)}
      ${linha('Contado no fecho', f.fecho.declarado)}
      ${f.fecho.diferenca !== null ? linha('Diferença', f.fecho.diferenca, true) : ''}
    </table>
    <div class="card-titulo mt-2">COMPRAS / SAÍDAS</div>
    <div class="tabela-wrapper"><table class="texto-pequeno"><tbody>${saidas}</tbody></table></div>
    <div class="card-titulo mt-2">VENDAS</div>
    <div class="tabela-wrapper"><table class="texto-pequeno"><tbody>${vendas}</tbody></table></div>
    ${quebras}`;
}
