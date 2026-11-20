'use strict';
// Nuk_POS — Configurações: o que cada fluxo de venda vende e tempos dos quartos (21/11/2026, pedido do dono:
// nenhuma regra de negócio fixa no código; tudo o que o estabelecimento decide fica nas Configurações).

const FLUXOS_CFG = [
  { fluxo: 'BALCAO', titulo: '🧾 Balcão', licenca: 'restauracao', ajuda: 'Além destas categorias, o Balcão vende a estadia dos quartos (botão «Vender quarto», para quem pode vender quartos). Comidas pedem-se na mesa.' },
  { fluxo: 'TAKEAWAY', titulo: '🥡 Take Away', licenca: 'restauracao', ajuda: 'Por omissão, só comidas e bebidas.' },
  { fluxo: 'LAZER', titulo: '🎯 Lazer', licenca: 'lazer', ajuda: 'A venda nasce fechada e recebe-se no Caixa.' },
  { fluxo: 'LOJA', titulo: '🛍️ Loja', licenca: 'loja', ajuda: 'A venda nasce fechada e recebe-se no Caixa.' },
];

/** Cartão «O que cada fluxo vende». `fluxos` = GET /pedidos/fluxos/categorias; `todas` = categorias activas. */
function cartaoFluxosVenda(fluxos, todas, lic) {
  const visiveis = FLUXOS_CFG.filter(f => lic(f.licenca) && fluxos && fluxos[f.fluxo]);
  if (!visiveis.length) return '';
  return `
      <div class="card mt-2" style="max-width:700px" id="cfg-fluxos">
        <div class="card-titulo mb-2">🧾 O QUE CADA FLUXO VENDE</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.6rem">Escolha as categorias de produto que cada fluxo de venda pode vender. O servidor recusa o resto, também nos pedidos feitos sem internet. A mesa vende tudo menos serviços de quarto. Se faltar uma categoria, crie-a em Listas → Categorias de produto.</div>
        ${visiveis.map(f => {
          const r = fluxos[f.fluxo];
          const escolhidas = r.categorias || [];
          const lista = [...new Set([...todas, ...escolhidas])];
          return `
          <div class="fluxo-cfg" style="padding:.6rem 0;border-top:1px solid var(--c-border)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:.35rem">
              <b>${f.titulo}</b>
              <span class="muted texto-pequeno">${r.configurado ? 'Escolha do estabelecimento' : 'Padrão do sistema'}</span>
            </div>
            <div class="muted texto-pequeno" style="margin-bottom:.4rem">${esc(f.ajuda)}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(10rem,1fr));gap:.35rem .8rem;margin-bottom:.6rem">
              ${lista.map(c => `<label style="display:flex;gap:.45rem;align-items:center;font-size:.88rem;cursor:pointer"><input type="checkbox" class="fluxo-cat fluxo-cat-${f.fluxo}" value="${esc(c)}" style="width:auto;margin:0"${escolhidas.includes(c) ? ' checked' : ''}${todas.includes(c) ? '' : ' disabled'}> ${esc(rotuloCategoria(c))}</label>`).join('')}
            </div>
            <div class="row-acoes">
              <button class="btn-primario" data-on-click="guardarFluxoVenda('${f.fluxo}')">Guardar</button>
              ${r.configurado ? `<button class="btn-secundario" data-on-click="pedirReporFluxoVenda('${f.fluxo}')">Repor o padrão</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
}

const nomeFluxoCfg = fluxo => (FLUXOS_CFG.find(f => f.fluxo === fluxo) || { titulo: fluxo }).titulo.replace(/^\S+\s/, '');

async function guardarFluxoVenda(fluxo) {
  const categorias = Array.from(document.querySelectorAll(`.fluxo-cat-${fluxo}`)).filter(x => x.checked && !x.disabled).map(x => x.value);
  if (!categorias.length) { toast(`Escolha pelo menos uma categoria para ${nomeFluxoCfg(fluxo)}`, 'erro'); return; }
  try { await api('PUT', `/configuracoes/fluxos/${fluxo}`, { categorias }); toast(`${nomeFluxoCfg(fluxo)} actualizado`, 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
function pedirReporFluxoVenda(fluxo) {
  modalConfirmar(`Repor o padrão de ${nomeFluxoCfg(fluxo)}?`, 'A escolha de categorias deste fluxo é apagada e volta a valer a regra do sistema.', 'reporFluxoVenda', fluxo);
}
async function reporFluxoVenda(fluxo) {
  try { await api('PUT', `/configuracoes/fluxos/${fluxo}`, { categorias: null }); fecharModal(); toast('Padrão reposto', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}

// ── Tempos dos quartos ──
const CAMPOS_TEMPO = [
  ['hora_h', 'Serviço «Hora» (horas)'], ['noite_h', 'Serviço «Noite» (horas)'], ['diaria_h', 'Serviço «Diária» (horas)'],
  ['limpeza_min', 'Arrumação depois da hora limite (min)'], ['aviso_min', 'Aviso aos arrumadores antes do fim (min)'],
  ['estrela_min', '★ vermelha: reserva a começar em menos de (min)'],
];
function cartaoTemposQuartos(t) {
  if (!t || typeof t.hora_h !== 'number') return '';
  const p = t.padrao || {};
  const iguais = CAMPOS_TEMPO.every(([k]) => t[k] === p[k]);
  return `
      <div class="card mt-2" style="max-width:700px">
        <div class="card-titulo mb-2">🛏️ TEMPOS DOS QUARTOS</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.6rem">Duração de cada serviço, tempo para arrumar o quarto e quando uma reserva bloqueia as vendas. Vale para as vendas e reservas novas; as que já existem mantêm o período com que foram feitas.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.4rem .9rem">
          ${CAMPOS_TEMPO.map(([k, rot]) => `<div class="campo"><label>${rot}</label><input type="number" min="1" step="1" id="tq-${k}" value="${esc(t[k])}"><span class="muted texto-pequeno">Padrão: ${esc(p[k])}</span></div>`).join('')}
        </div>
        <div class="row-acoes">
          <button class="btn-primario" data-on-click="guardarTemposQuartos()">Guardar</button>
          ${iguais ? '' : '<button class="btn-secundario" data-on-click="pedirReporTemposQuartos()">Repor os de sempre</button>'}
        </div>
      </div>`;
}
async function guardarTemposQuartos() {
  const corpo = {};
  for (const [k] of CAMPOS_TEMPO) {
    const v = document.getElementById(`tq-${k}`)?.value;
    if (v !== undefined && v !== '') corpo[k] = Number(v);
  }
  try { await api('PUT', '/quartos/tempos', corpo); toast('Tempos dos quartos actualizados', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
function pedirReporTemposQuartos() {
  modalConfirmar('Repor os tempos de sempre?', 'Hora 2 h, Noite 12 h, Diária 24 h, arrumação 30 min, aviso 5 min e estrela vermelha 60 min.', 'reporTemposQuartos');
}
async function reporTemposQuartos() {
  try { await api('PUT', '/quartos/tempos', { repor: true }); fecharModal(); toast('Tempos repostos', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
