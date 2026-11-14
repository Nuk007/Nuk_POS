'use strict';
/**
 * Cadeia de estabelecimentos (14/11/2026): botão 🏢 na barra de topo para mudar de estabelecimento
 * (quando o mesmo email tem conta em mais de um) e o consolidado da cadeia no ecrã de Relatórios.
 * Mudar pede a palavra-passe da conta de destino. Sem handlers inline (CSP).
 */
async function cadeiaArrancar() {
  const btn = document.getElementById('btn-cadeia');
  if (!btn) return;
  try {
    const r = await api('GET', '/cadeia/estabelecimentos');
    window._cadeia = r;
    const actual = (r.estabelecimentos || []).find(e => e.actual);
    btn.style.display = (r.estabelecimentos || []).length > 1 ? '' : 'none';
    btn.textContent = `🏢 ${actual ? actual.nome : 'Estabelecimento'}`;
  } catch (e) { btn.style.display = 'none'; }
}

function modalCadeia() {
  const r = window._cadeia || { estabelecimentos: [] };
  abrirModal('Mudar de estabelecimento', `
    ${r.cadeia ? `<p class="muted texto-pequeno" style="margin-bottom:.5rem">Cadeia: <b>${esc(r.cadeia.nome)}</b></p>` : ''}
    ${r.estabelecimentos.map(e => e.actual
      ? `<div class="btn-bloco" style="padding:.5rem 0"><b>${esc(e.nome)}</b> <span class="muted texto-pequeno">(actual)</span></div>`
      : `<button class="btn-secundario btn-bloco" style="margin:.25rem 0" data-on-click="pedirTrocaEstabelecimento('${esc(e.tenant_id)}')">${esc(e.nome)} <span class="muted texto-pequeno">${esc(e.nivel_acesso)}</span></button>`).join('')}
    <div id="cadeia-senha" style="display:none;margin-top:.6rem">
      <div class="campo"><label>Palavra-passe da sua conta nesse estabelecimento</label><input id="cadeia-pp" type="password" inputmode="numeric" autocomplete="current-password"></div>
      <button class="btn-primario btn-bloco" data-on-click="confirmarTrocaEstabelecimento()">Entrar</button>
    </div>`);
}
function pedirTrocaEstabelecimento(tenantId) {
  window._cadeiaDestino = tenantId;
  document.getElementById('cadeia-senha').style.display = 'block';
  const i = document.getElementById('cadeia-pp'); if (i && i.focus) i.focus();
}
async function confirmarTrocaEstabelecimento() {
  const palavra_passe = document.getElementById('cadeia-pp').value;
  if (!palavra_passe) { toast('Indique a palavra-passe', 'erro'); return; }
  try {
    const res = await api('POST', '/cadeia/trocar', { tenant_id: window._cadeiaDestino, palavra_passe });
    NUK.token = res.token;
    NUK.utilizador = res.funcionario;
    try { localStorage.setItem('nukpos_token', res.token); localStorage.setItem('nukpos_user', JSON.stringify(res.funcionario)); } catch (e) { /* ignorar */ }
    location.reload();
  } catch (e) { toast(e.message, 'erro'); }
}

/** Consolidado da cadeia no ecrã de Relatórios (só administradores de um estabelecimento numa cadeia). */
async function carregarConsolidadoCadeia(de, ate) {
  const box = document.getElementById('rel-cadeia');
  if (!box) return;
  if (!(NUK.utilizador && NUK.utilizador.nivel_acesso === 'ADMIN')) { box.innerHTML = ''; return; }
  try {
    const r = await api('GET', `/cadeia/consolidado?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
    const linha = (nome, x, forte) => `<tr${forte ? ' class="negrito"' : ''}><td>${nome}</td><td>${formatarMoeda(x.receita)}</td><td>${x.pedidos}</td><td>${formatarMoeda(x.ticket_medio)}</td><td>${formatarMoeda(x.despesas)}</td><td>${formatarMoeda(x.resultado)}</td><td>${formatarMoeda(x.por_receber)}</td></tr>`;
    box.innerHTML = `<div class="card mb-3"><div class="card-header"><span class="card-titulo">🏢 Cadeia ${esc(r.cadeia.nome)} — consolidado</span></div>
      <div class="tabela-wrapper"><table><thead><tr><th>Estabelecimento</th><th>Receita</th><th>Pedidos</th><th>Ticket médio</th><th>Despesas</th><th>Resultado</th><th>Por receber</th></tr></thead>
      <tbody>${r.estabelecimentos.map(e => linha(esc(e.nome) + (e.actual ? ' <span class="muted texto-pequeno">(este)</span>' : ''), e)).join('')}${r.estabelecimentos.length > 1 ? linha('Total', r.total, true) : ''}</tbody></table></div></div>`;
  } catch (e) { box.innerHTML = ''; } // sem cadeia (409) ou sem acesso: não mostra nada
}
