// ── Produção de cartões no Caixa (21/11/2026, pedido do dono) ───────────────
// Quando um cartão de consumo esgota, o botão fica vermelho e, ao tocá-lo, abre-se a produção de cartões:
//  1. autorização — email e palavra-passe do Administrador ou de quem ele deu o perfil «Imprimir cartões»;
//  2. o cartão a imprimir e a quantidade;
//  3. imprime-se sempre em folhas A4 completas (10 cartões por folha, mínimo uma folha). Se a quantidade não
//     encher as folhas, pergunta-se se reduz ou se avança com a folha completa seguinte (a quantidade fica anotada no lote).
// O servidor volta a verificar tudo (credenciais, perfil, folhas completas) e devolve logo a folha para imprimir.
const CARTOES_POR_FOLHA = 10;
const LOTE_CARTOES_MAX = 200;

/** Folhas completas: { ok, menos, mais } (menos = 0 se abaixo de uma folha). */
function pcFolhas(q) {
  const menos = Math.floor(q / CARTOES_POR_FOLHA) * CARTOES_POR_FOLHA;
  return { ok: q >= CARTOES_POR_FOLHA && q % CARTOES_POR_FOLHA === 0, menos, mais: Math.min(LOTE_CARTOES_MAX, menos + CARTOES_POR_FOLHA) };
}
const pcTextoFolhas = q => { const f = q / CARTOES_POR_FOLHA; return `${f} folha${f === 1 ? '' : 's'} A4`; };

function modalProduzirCartoes(valor) {
  window._prodCartoes = { valor: Number(valor) };
  abrirModal(`Imprimir cartões de ${formatarMoeda(valor)}`, `
    <p style="margin-bottom:.6rem">Os cartões de <b>${formatarMoeda(valor)}</b> acabaram. Para imprimir mais é precisa a autorização do <b>Administrador</b> ou de quem ele autorizou a imprimir cartões.</p>
    <div class="campo"><label>Email de quem autoriza</label><input type="email" id="pc-email" autocomplete="off"></div>
    <div class="campo"><label>Palavra-passe</label><input type="password" id="pc-senha" inputmode="numeric" maxlength="64" autocomplete="off"></div>
    <div style="display:flex;gap:.5rem">
      <button class="btn-primario" style="flex:1" data-on-click="pcAutorizar()">Continuar</button>
      <button class="btn-secundario" style="flex:1" data-on-click="pcCancelar()">Cancelar</button></div>`);
}

function pcCancelar() { window._prodCartoes = null; fecharModal(); }

async function pcAutorizar() {
  const p = window._prodCartoes; if (!p) return;
  const email = String(document.getElementById('pc-email').value || '').trim();
  const senha = String(document.getElementById('pc-senha').value || '');
  if (!email || !senha) return toast('Escreva o email e a palavra-passe de quem autoriza', 'aviso');
  try {
    const r = await api('POST', '/caixa/cartoes/producao/autorizar', { email, palavra_passe: senha });
    Object.assign(p, { email, senha, nome: r.nome });
    pcEcraQuantidade(CARTOES_POR_FOLHA);
  } catch (e) { toast(e.message, 'erro'); }
}

function pcEcraQuantidade(qtd) {
  const p = window._prodCartoes; if (!p || !p.senha) return;
  const tipos = (window._tiposCartao || []).filter(t => t.ativo !== false);
  abrirModal('Imprimir cartões', `
    <p class="muted texto-pequeno" style="margin-bottom:.6rem">Autorizado por <b>${esc(p.nome)}</b>.</p>
    <div class="campo"><label>Cartão a imprimir</label><select id="pc-valor">${tipos.map(t => `<option value="${Number(t.valor)}" ${Number(t.valor) === p.valor ? 'selected' : ''}>${formatarMoeda(t.valor)}${t.nome ? ' · ' + esc(t.nome) : ''}</option>`).join('')}</select></div>
    <div class="campo"><label>Quantidade de cartões</label><input id="pc-qtd" type="number" min="${CARTOES_POR_FOLHA}" max="${LOTE_CARTOES_MAX}" value="${Number(qtd)}" style="width:7rem" data-on-input="pcMostrarFolhas(this.value)"></div>
    <p id="pc-folhas" class="muted texto-pequeno" style="margin:-.3rem 0 .8rem"></p>
    <div style="display:flex;gap:.5rem">
      <button class="btn-primario" style="flex:1" data-on-click="pcPedir()">🖨️ Imprimir</button>
      <button class="btn-secundario" style="flex:1" data-on-click="pcCancelar()">Cancelar</button></div>`);
  pcMostrarFolhas(qtd);
}

function pcMostrarFolhas(v) {
  const el = document.getElementById('pc-folhas'); if (!el) return;
  const q = parseInt(v, 10) || 0, f = pcFolhas(q);
  el.textContent = f.ok ? `${q} cartões = ${pcTextoFolhas(q)} completa${q === CARTOES_POR_FOLHA ? '' : 's'}.`
    : `Cada folha A4 leva ${CARTOES_POR_FOLHA} cartões; o mínimo é uma folha.`;
}

function pcPedir() {
  const p = window._prodCartoes; if (!p || !p.senha) return;
  p.valor = parseInt(document.getElementById('pc-valor').value, 10) || p.valor;
  const q = parseInt(document.getElementById('pc-qtd').value, 10);
  if (!(q >= 1)) return toast('Indique a quantidade de cartões', 'aviso');
  if (q > LOTE_CARTOES_MAX) return toast(`No máximo ${LOTE_CARTOES_MAX} cartões de cada vez (${pcTextoFolhas(LOTE_CARTOES_MAX)})`, 'aviso');
  if (q < CARTOES_POR_FOLHA) {
    document.getElementById('pc-qtd').value = CARTOES_POR_FOLHA; pcMostrarFolhas(CARTOES_POR_FOLHA);
    return toast(`O mínimo é ${CARTOES_POR_FOLHA} cartões: uma folha A4 completa`, 'aviso');
  }
  const f = pcFolhas(q);
  if (f.ok) return pcProduzir(q);
  pcPerguntarFolhas(q, f.menos, f.mais);
}

/** A quantidade não enche as folhas: reduzir ou avançar com a folha completa seguinte. */
function pcPerguntarFolhas(q, menos, mais) {
  abrirModal('Folhas A4 completas', `
    <p style="margin-bottom:.6rem">Pediu <b>${q}</b> cartões. A folha A4 leva ${CARTOES_POR_FOLHA}, por isso ${q} não enche folhas completas.</p>
    <p class="muted texto-pequeno" style="margin-bottom:.8rem">Se não quiser reduzir, o sistema imprime ${pcTextoFolhas(mais)} completas e anota no lote <b>${mais}</b> cartões.</p>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${menos >= CARTOES_POR_FOLHA ? `<button class="btn-secundario" data-on-click="pcProduzir(${menos})">Reduzir para ${menos} (${pcTextoFolhas(menos)})</button>` : ''}
      <button class="btn-primario" data-on-click="pcProduzir(${mais})">Avançar com ${mais} (${pcTextoFolhas(mais)} completas)</button>
      <button class="btn-secundario" data-on-click="pcEcraQuantidade(${q})">Voltar</button></div>`);
}

async function pcProduzir(quantidade) {
  const p = window._prodCartoes; if (!p || !p.senha) return;
  let r;
  try {
    r = await fetch('/api/caixa/cartoes/producao', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NUK.token}` },
      body: JSON.stringify({ email: p.email, palavra_passe: p.senha, valor: p.valor, quantidade: Number(quantidade) }),
    });
  } catch (e) { return toast('Sem ligação ao servidor: os cartões não foram gerados', 'erro'); }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && typeof logout === 'function') return logout();
    if (j.codigo === 'FOLHAS_INCOMPLETAS' && j.avancar) return pcPerguntarFolhas(Number(quantidade), j.reduzir || 0, j.avancar);
    if (j.codigo === 'CREDENCIAIS_INVALIDAS' || j.codigo === 'SEM_PERFIL_CARTOES') { modalProduzirCartoes(p.valor); }
    return toast(j.erro || `Erro ${r.status}`, 'erro');
  }
  const numero = r.headers.get('X-Lote-Numero'), qtd = Number(r.headers.get('X-Lote-Quantidade')) || Number(quantidade);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `cartoes-lote-${numero}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  const valor = p.valor, nome = p.nome;
  window._prodCartoes = null; // a palavra-passe não fica guardada
  abrirModal('Cartões gerados', `
    <p style="text-align:center;font-size:1.15rem;margin-bottom:.5rem">Lote N.º <b>${esc(numero)}</b> · <b>${qtd}</b> cartões de <b>${formatarMoeda(valor)}</b></p>
    <p class="muted texto-pequeno" style="text-align:center;margin-bottom:.8rem">${pcTextoFolhas(qtd)} · autorizado por ${esc(nome)}. A folha foi descarregada: imprima em cartolina, corte pelo tracejado e venda pelo código.</p>
    <button class="btn-primario btn-bloco" data-on-click="pcConcluir()">Concluído</button>`);
}

function pcConcluir() { fecharModal(); carregarModulo('cartoes'); }
