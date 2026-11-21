'use strict';
// Caixa → Receber mesas: receber, factura-recibo, dividir conta e pagamento misto.
// Continua caixa.js (dividido a 21/11/2026 para nenhum ficheiro passar das 400 linhas); as funções são globais e partilhadas.

// ── Receber mesas (pedidos fechados) ────────────────────────
async function modulo_recebimentos(el) {
  try {
    if (!await caixaAberto(el, '🧾 Receber mesas')) return;
    const lista = await api('GET', '/caixa/por-receber') || [];
    // uma conta por mesa; os restantes (balcão, take away, remota) cada um com a sua
    const contas = {};
    lista.forEach(p => { const k = p.mesa_numero ? 'M' + p.mesa_numero : p.quarto_numero ? 'Q' + p.quarto_numero : 'P' + p.id; (contas[k] = contas[k] || { titulo: p.mesa_numero ? `Mesa ${p.mesa_numero}` : p.quarto_numero ? `Quarto ${p.quarto_numero}` : ({ BALCAO: 'Balcão', TAKEAWAY: 'Take Away', REMOTA: 'Remota', LAZER: 'Lazer', LOJA: 'Loja' }[p.origem] || 'Pedido') + (p.cliente_nome ? ` · ${p.cliente_nome}` : ''), pedidos: [] }).pedidos.push(p); });
    window._contas = Object.values(contas);
    el.innerHTML = `<div class="toolbar"><span class="secao-titulo">🧾 Receber mesas</span><span class="muted">Pedidos já fechados, à espera de pagamento</span></div>
      ${window._contas.length ? window._contas.map((c, i) => {
        const total = c.pedidos.reduce((a, p) => a + parseFloat(p.total), 0);
        return `<div class="card mb-2" style="max-width:640px"><div class="toolbar" style="margin-bottom:.4rem"><b>${esc(c.titulo)}</b><b class="texto-primario">${formatarMoeda(total)}</b></div>
          ${c.pedidos.length > 1 ? c.pedidos.map((p, j) => `<div style="border-top:1px dashed var(--c-border);padding:.35rem 0">
              <div class="toolbar" style="margin:0"><span class="texto-pequeno negrito">Conta ${j + 1}</span><span style="display:flex;gap:.4rem;align-items:center"><b>${formatarMoeda(p.total)}</b>
                <button class="btn-secundario" style="padding:.2rem .55rem;font-size:.75rem" data-on-click="modalReceber(${i},${j})">Receber esta</button></span></div>
              ${(p.itens || []).map(it => `<div class="texto-pequeno">${fmtQtd(it.quantidade)} ${esc(it.produto_nome)}</div>`).join('')}</div>`).join('')
            : c.pedidos.flatMap(p => p.itens || []).map(it => `<div class="texto-pequeno">${fmtQtd(it.quantidade)} ${esc(it.produto_nome)}</div>`).join('')}
          <div style="display:flex;gap:.5rem;margin-top:.6rem">
            ${podeDividir(c) ? `<button class="btn-secundario" style="flex:1" data-on-click="modalDividir(${i})">Dividir conta</button>` : ''}
            <button class="btn-primario" style="flex:2" data-on-click="modalReceber(${i})">Receber ${c.pedidos.length > 1 ? 'tudo · ' : ''}${formatarMoeda(total)}</button>
          </div>
          ${euChefiaCaixa() ? `<button class="btn-perigo btn-bloco" style="margin-top:.45rem;font-size:.8rem;padding:.35rem" data-on-click="pedirPerdaConta(${i})">Cliente saiu sem pagar…</button>` : ''}</div>`;
      }).join('') : '<div class="card muted">Nada por receber.</div>'}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function modalReceber(i, j) {
  const c = window._contas[i]; if (!c) return;
  const escolhidos = j === undefined || j === null ? c.pedidos : [c.pedidos[j]].filter(Boolean);
  if (!escolhidos.length) return;
  const total = escolhidos.reduce((a, p) => a + parseFloat(p.total), 0);
  window._contaActual = { i, total, misto: false, ids: escolhidos.map(p => p.id) };
  window._parcelas = [];
  window._contasCC = null;
  abrirModal(`Receber · ${c.titulo}${escolhidos.length < c.pedidos.length ? ` · Conta ${j + 1}` : ''}`, `
    <p style="margin-bottom:.6rem;font-size:1.2rem">Total: <b class="texto-primario">${formatarMoeda(total)}</b></p>
    <div id="rc-simples" class="campo"><label>Forma de pagamento</label><select id="rc-metodo" data-on-change="receberMetodo(this.value)">${optsFormas(FORMAS_RECEBER)}</select>
      <button class="btn-secundario" style="margin-top:.45rem;padding:.3rem .7rem;font-size:.8rem" data-on-click="receberMisto()">Dividir por várias formas de pagamento</button></div>
    <div id="rc-misto" style="display:none"></div>
    <div id="rc-cash" class="campo"><label id="rc-cash-rot">Valor entregue (Kz, opcional para calcular o troco)</label><input id="rc-entregue" type="number" min="0" data-on-input="receberTroco()"><div id="rc-troco" class="muted texto-pequeno"></div></div>
    <div id="rc-pin" class="campo" style="display:none"><label>PIN do cliente (4 dígitos)</label><input id="rc-pin-v" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></div>
    <div id="rc-cartao" class="campo" style="display:none"><label>Código do cartão de consumo</label><input id="rc-codigo" placeholder="CCXXXXXXXX"></div>
    <div id="rc-conta" class="campo" style="display:none"><label>Cliente com conta corrente</label><select id="rc-conta-cli"><option value="">A carregar…</option></select><div id="rc-conta-info" class="muted texto-pequeno"></div></div>
    <div class="campo"><label style="display:flex;gap:.4rem;align-items:center"><input id="rc-fr" type="checkbox" data-on-change="receberFactura(this.checked)"> Emitir factura-recibo</label>
      <div id="rc-fr-dados" style="display:none;gap:.4rem"><input id="rc-fr-nif" placeholder="NIF do cliente (opcional)" maxlength="20" style="flex:1"><input id="rc-fr-nome" placeholder="Nome (opcional)" maxlength="200" style="flex:1.4"></div></div>
    <button class="btn-primario btn-bloco" data-on-click="confirmarReceber()">Confirmar recebimento</button>`);
}
function receberFactura(ver) { document.getElementById('rc-fr-dados').style.display = ver ? 'flex' : 'none'; }
/** Depois de receber: um documento FR para todos os pedidos recebidos juntos. O recebimento já está feito mesmo que isto falhe. */
async function emitirFacturaRecibo(pedidoIds, nif, nome) {
  try {
    const f = await api('POST', '/caixa/faturar', { pedido_ids: pedidoIds, nif_cliente: nif || undefined, nome_cliente: nome || undefined });
    toast(`Factura-recibo ${f.numero_fatura} emitida`, 'sucesso', 6000);
    descarregarPdf(`/caixa/faturas/${f.id}/pdf`, `${String(f.numero_fatura).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`);
  } catch (e) { toast(`Recebido, mas a factura-recibo falhou: ${e.message} (emita-a em Finanças)`, 'erro', 9000); }
}
function receberMetodo(m) {
  document.getElementById('rc-cash').style.display = m === 'CASH' ? '' : 'none';
  document.getElementById('rc-pin').style.display = m === 'NUKCOIN' ? '' : 'none';
  document.getElementById('rc-cartao').style.display = m === 'CARTAO' ? '' : 'none';
  mostrarConta(m === 'CONTA');
}
/** Campo «cliente com conta corrente»: carrega só os autorizados, com o crédito disponível. */
async function mostrarConta(ver) {
  const box = document.getElementById('rc-conta');
  box.style.display = ver ? '' : 'none';
  if (!ver || window._contasCC) return;
  try {
    window._contasCC = (await api('GET', '/caixa/conta-corrente') || []).filter(c => c.conta_corrente_ativa);
    const c = window._contas[window._contaActual.i];
    const doPedido = (c.pedidos.find(p => p.cliente_id) || {}).cliente_id;
    document.getElementById('rc-conta-cli').innerHTML = window._contasCC.length
      ? window._contasCC.map(x => `<option value="${esc(x.id)}" ${x.id === doPedido ? 'selected' : ''}>${esc(x.nome)} · disponível ${formatarMoeda(x.disponivel)}</option>`).join('')
      : '<option value="">Nenhum cliente com conta corrente (autorize em Configurações)</option>';
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Dividir conta (separar itens para outra pessoa pagar) ──
function podeDividir(c) {
  const itens = c.pedidos.reduce((a, p) => a + (p.itens || []).reduce((b, it) => b + Number(it.quantidade), 0), 0);
  return itens > 1 && c.pedidos.every(p => !(Number(p.desconto) > 0) && !(Number(p.nukcoin_pago) > 0));
}
function modalDividir(i) {
  const c = window._contas[i]; if (!c) return;
  window._divisao = { i, linhas: c.pedidos.flatMap(p => (p.itens || []).map(it => ({ pedido_id: p.id, item_id: it.id, nome: it.produto_nome, max: Number(it.quantidade), preco: Number(it.preco_unitario), q: 0 }))) };
  abrirModal(`Dividir · ${c.titulo}`, `
    <p class="muted texto-pequeno" style="margin-bottom:.5rem">Escolha o que passa para a <b>nova conta</b> (quem paga à parte). O resto fica na conta actual.</p>
    <div id="dv-linhas"></div>
    <div id="dv-total" class="negrito" style="margin:.5rem 0"></div>
    <button class="btn-primario btn-bloco" data-on-click="confirmarDividir()">Separar para nova conta</button>`);
  desenharDivisao();
}
function desenharDivisao() {
  const d = window._divisao;
  document.getElementById('dv-linhas').innerHTML = d.linhas.map((l, k) => `<div style="display:flex;align-items:center;gap:.4rem;margin:.25rem 0">
    <span style="flex:1">${esc(l.nome)} <span class="muted texto-pequeno">(${l.max} × ${formatarMoeda(l.preco)})</span></span>
    <button class="btn-secundario venda-qtd" data-on-click="divisaoQtd(${k},-1)">−</button><b style="min-width:1.5rem;text-align:center">${l.q}</b>
    <button class="btn-secundario venda-qtd" data-on-click="divisaoQtd(${k},1)">+</button></div>`).join('');
  const t = d.linhas.reduce((a, l) => a + l.q * l.preco, 0);
  document.getElementById('dv-total').textContent = `Nova conta: ${formatarMoeda(t)}`;
}
function divisaoQtd(k, delta) {
  const l = window._divisao.linhas[k]; if (!l) return;
  l.q = Math.max(0, Math.min(l.max, l.q + delta));
  desenharDivisao();
}
async function confirmarDividir() {
  const d = window._divisao;
  const escolhidas = d.linhas.filter(l => l.q > 0);
  if (!escolhidas.length) { toast('Escolha pelo menos um item', 'erro'); return; }
  if (escolhidas.every(l => l.q === l.max) && escolhidas.length === d.linhas.length) { toast('Deixe pelo menos um item na conta actual', 'erro'); return; }
  const porPedido = {};
  escolhidas.forEach(l => { (porPedido[l.pedido_id] = porPedido[l.pedido_id] || []).push({ item_id: l.item_id, quantidade: l.q }); });
  try {
    for (const [pedido_id, itens] of Object.entries(porPedido)) await api('POST', '/caixa/dividir', { pedido_id, itens });
    fecharModal();
    toast('Conta dividida: cada parte recebe-se à parte', 'sucesso');
    carregarModulo('recebimentos');
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Pagamento misto (ex.: parte em dinheiro, resto no TPA) ──
const MAX_PARCELAS = 4;
const cent = v => Math.round((parseFloat(v) || 0) * 100);
function receberMisto() {
  window._contaActual.misto = true;
  window._parcelas = [{ metodo: 'CASH', valor: '' }, { metodo: 'TPA', valor: '' }];
  document.getElementById('rc-simples').style.display = 'none';
  document.getElementById('rc-misto').style.display = '';
  desenharParcelas();
}
function desenharParcelas() {
  const ps = window._parcelas;
  const usados = ps.map(x => x.metodo);
  document.getElementById('rc-misto').innerHTML = `
    <label class="negrito">Formas de pagamento</label>
    ${ps.map((x, i) => `<div style="display:flex;gap:.4rem;align-items:center;margin:.35rem 0">
      <select style="flex:1.2" data-on-change="parcelaMetodo(${i},this.value)">${optsFormas(FORMAS_RECEBER, x.metodo)}</select>
      <input id="rc-par-${i}" type="number" min="0" style="flex:1" placeholder="Kz" value="${esc(x.valor)}" data-on-input="parcelaValor(${i},this.value)">
      <button class="btn-secundario" style="padding:.3rem .5rem;font-size:.75rem" data-on-click="parcelaResto(${i})" title="Preencher com o que falta">Resto</button>
      ${ps.length > 2 ? `<button class="btn-secundario" style="padding:.3rem .5rem;font-size:.75rem" data-on-click="parcelaRemover(${i})" title="Retirar">✕</button>` : ''}
    </div>`).join('')}
    ${ps.length < MAX_PARCELAS ? '<button class="btn-secundario" style="padding:.3rem .7rem;font-size:.8rem" data-on-click="parcelaAdicionar()">+ Outra forma</button>' : ''}
    <div id="rc-falta" class="texto-pequeno" style="margin:.5rem 0 .3rem"></div>`;
  document.getElementById('rc-cash').style.display = usados.includes('CASH') ? '' : 'none';
  document.getElementById('rc-cash-rot').textContent = 'Dinheiro entregue pelo cliente (Kz, opcional para calcular o troco da parte em dinheiro)';
  document.getElementById('rc-pin').style.display = usados.includes('NUKCOIN') ? '' : 'none';
  document.getElementById('rc-cartao').style.display = usados.includes('CARTAO') ? '' : 'none';
  mostrarConta(usados.includes('CONTA'));
  actualizarFalta();
}
function parcelaMetodo(i, m) { window._parcelas[i].metodo = m; desenharParcelas(); }
function parcelaValor(i, v) { window._parcelas[i].valor = v; actualizarFalta(); }
function parcelaAdicionar() {
  if (window._parcelas.length >= MAX_PARCELAS) return;
  const livre = Object.keys(FORMAS_RECEBER).find(m => !window._parcelas.some(x => x.metodo === m)) || 'TPA';
  window._parcelas.push({ metodo: livre, valor: '' });
  desenharParcelas();
}
function parcelaRemover(i) { if (window._parcelas.length > 2) { window._parcelas.splice(i, 1); desenharParcelas(); } }
function faltaCent() {
  return cent(window._contaActual.total) - window._parcelas.reduce((a, x) => a + cent(x.valor), 0);
}
function parcelaResto(i) {
  const novo = (cent(window._parcelas[i].valor) + faltaCent()) / 100;
  if (novo <= 0) return;
  window._parcelas[i].valor = String(novo);
  const inp = document.getElementById(`rc-par-${i}`); if (inp) inp.value = String(novo);
  actualizarFalta();
}
function actualizarFalta() {
  const f = faltaCent(), el = document.getElementById('rc-falta');
  if (!el) return;
  el.innerHTML = f === 0 ? '<span style="color:var(--c-success)">✓ Soma certa</span>'
    : f > 0 ? `Falta <b>${formatarMoeda(f / 100)}</b>` : `<span style="color:var(--c-danger)">A soma passa o total em ${formatarMoeda(-f / 100)}</span>`;
  receberTroco();
}
function receberTroco() {
  const e = parseFloat(document.getElementById('rc-entregue').value);
  const a = window._contaActual;
  const alvo = a.misto ? (window._parcelas.find(x => x.metodo === 'CASH') || {}).valor : a.total;
  const t = parseFloat(alvo) || 0;
  document.getElementById('rc-troco').textContent = Number.isFinite(e) ? (e >= t ? `Troco: ${formatarMoeda(e - t)}` : (a.misto ? 'Valor inferior à parte em dinheiro' : 'Valor inferior ao total')) : '';
}
async function confirmarReceber() {
  const c = window._contas[window._contaActual.i];
  const corpo = { pedido_ids: window._contaActual.ids || c.pedidos.map(p => p.id) };
  const cli = c.pedidos.find(p => p.cliente_id);
  if (window._contaActual.misto) {
    if (faltaCent() !== 0) { toast('A soma das formas de pagamento tem de ser igual ao total', 'erro'); return; }
    if (window._parcelas.some(x => cent(x.valor) <= 0)) { toast('Indique o valor de cada forma de pagamento (ou retire-a)', 'erro'); return; }
    corpo.pagamentos = window._parcelas.map(x => {
      const p = { metodo: x.metodo, valor: cent(x.valor) / 100 };
      if (x.metodo === 'CASH') { const e = document.getElementById('rc-entregue').value; if (e !== '') p.valor_entregue = parseFloat(e); }
      if (x.metodo === 'NUKCOIN') { p.pin = document.getElementById('rc-pin-v').value; if (cli) p.cliente_id = cli.cliente_id; }
      if (x.metodo === 'CARTAO') p.codigo_cartao = document.getElementById('rc-codigo').value;
      if (x.metodo === 'CONTA') p.cliente_id = document.getElementById('rc-conta-cli').value || undefined;
      return p;
    });
  } else {
    const metodo = document.getElementById('rc-metodo').value;
    corpo.metodo = metodo;
    if (metodo === 'CASH') { const e = document.getElementById('rc-entregue').value; if (e !== '') corpo.valor_entregue = parseFloat(e); }
    if (metodo === 'NUKCOIN') { corpo.pin = document.getElementById('rc-pin-v').value; if (cli) corpo.cliente_id = cli.cliente_id; }
    if (metodo === 'CARTAO') corpo.codigo_cartao = document.getElementById('rc-codigo').value;
    if (metodo === 'CONTA') corpo.cliente_id = document.getElementById('rc-conta-cli').value || undefined;
  }
  const fr = document.getElementById('rc-fr');
  const factura = fr && fr.checked ? { nif: document.getElementById('rc-fr-nif').value.trim(), nome: document.getElementById('rc-fr-nome').value.trim() } : null;
  if (factura && factura.nif && !/^[A-Za-z0-9]{5,20}$/.test(factura.nif)) { toast('NIF inválido (5 a 20 letras ou números)', 'erro'); return; }
  try {
    const r = await api('POST', '/caixa/receber', corpo);
    fecharModal();
    if (factura) emitirFacturaRecibo(corpo.pedido_ids, factura.nif, factura.nome);
    if (typeof imprimirRecibo === 'function') imprimirRecibo(corpo.pedido_ids); // recibo + gaveta, se este dispositivo tiver impressora
    const formas = r.pagamentos && r.pagamentos.length > 1 ? ` (${r.pagamentos.map(x => `${FORMAS_RECEBER[x.metodo] || x.metodo} ${formatarMoeda(x.valor)}`).join(' + ')})` : '';
    toast(`Recebido ${formatarMoeda(r.total)}${formas}` + (r.troco ? ` · troco ${formatarMoeda(r.troco)}` : '') + (r.saldo_restante !== null && r.saldo_restante !== undefined ? ` · saldo ${formatarMoeda(r.saldo_restante)}` : ''), 'sucesso', 7000);
    carregarModulo('recebimentos');
  } catch (e) { toast(e.message, 'erro'); }
}
