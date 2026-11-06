'use strict';
/**
 * Caixa do dia (turno): Caixa do dia | Nuk-Coin | Cartões de consumo | Receber mesas.
 * Tudo o que mexe em dinheiro exige o caixa aberto (o servidor recusa com 409 CAIXA_FECHADO).
 * Sem handlers inline (CSP): data-on-click / data-on-change com argumentos literais.
 */
const FORMAS_BALCAO = { CASH: 'Dinheiro', TPA: 'TPA', TRANSFERENCIA: 'Transferência', EXPRESS: 'Express' };
const FORMAS_RECEBER = { ...FORMAS_BALCAO, NUKCOIN: 'Nuk-Coin (PIN)', CARTAO: 'Cartão de consumo' };
const ROTULO_MOV = { NUKCOIN_CARREGAMENTO: 'Nuk-Coin', CARTAO_VENDA: 'Cartão de consumo', RECEBIMENTO: 'Recebimento', COMPRA: 'Compra' };
const optsFormas = (f, sel = 'CASH') => Object.entries(f).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
const hora = d => new Date(d).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' });

/** Mostra o aviso «caixa fechado» com atalho, ou devolve true se estiver aberto. */
async function caixaAberto(el, titulo) {
  const e = await api('GET', '/caixa');
  window._caixaEstado = e;
  if (e.aberta) return true;
  el.innerHTML = `<div class="toolbar"><span class="secao-titulo">${titulo}</span></div>
    <div class="card" style="max-width:520px"><p style="margin-bottom:.8rem">O caixa do dia está <b>fechado</b>. Abra-o para receber valores.</p>
    <button class="btn-primario" data-on-click="carregarModulo('caixa')">Ir para o Caixa do dia</button></div>`;
  return false;
}

// ── Caixa do dia ────────────────────────────────────────────
async function modulo_caixa(el) {
  try {
    const e = await api('GET', '/caixa');
    window._caixaEstado = e;
    if (!e.aberta) {
      const hist = (await api('GET', '/caixa/sessoes')) || [];
      el.innerHTML = `<div class="toolbar"><span class="secao-titulo">💵 Caixa do dia</span></div>
        <div class="card" style="max-width:480px">
          <div class="card-titulo">ABRIR CAIXA</div>
          <p class="muted texto-pequeno" style="margin:.4rem 0 .8rem">Indique o dinheiro que está na gaveta ao começar (fundo de caixa).</p>
          <div class="campo"><label>Fundo de caixa (Kz)</label><input id="cx-fundo" type="number" min="0" value="0"></div>
          <button class="btn-primario btn-bloco" data-on-click="abrirCaixa()">Abrir caixa</button>
        </div>
        ${htmlHistoricoCaixa(hist)}`;
      return;
    }
    const r = e.resumo;
    const kpi = (t, v, s = '') => `<div class="kpi-card"><div class="kpi-label">${t}</div><div class="kpi-valor">${formatarMoeda(v)}</div>${s ? `<div class="kpi-sub">${s}</div>` : ''}</div>`;
    el.innerHTML = `
      <div class="toolbar"><span class="secao-titulo">💵 Caixa do dia</span>
        <span class="muted">Aberto às ${hora(e.sessao.aberta_em)}</span>
        <button class="btn-perigo" data-on-click="modalFecharCaixa()">Fechar caixa</button></div>
      <div class="kpi-grid">
        ${kpi('Dinheiro esperado na gaveta', r.dinheiro_esperado, `fundo ${formatarMoeda(r.fundo_inicial)} + recebido ${formatarMoeda(r.dinheiro_recebido)}`)}
        ${Object.entries(r.por_metodo).map(([m, v]) => kpi(FORMAS_RECEBER[m] || m, v)).join('')}
      </div>
      <div class="card tabela-wrapper mt-2"><table>
        <thead><tr><th>Hora</th><th>Operação</th><th>Forma</th><th>Detalhe</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>${e.movimentos.map(m => `<tr><td>${hora(m.criado_em)}</td><td>${esc(ROTULO_MOV[m.tipo] || m.tipo)}</td><td>${esc(FORMAS_RECEBER[m.metodo] || m.metodo)}</td>
          <td>${esc(m.mesa_numero ? 'Mesa ' + m.mesa_numero : (m.cliente_nome || m.descricao || ''))}</td><td style="text-align:right">${formatarMoeda(m.valor)}</td></tr>`).join('')
          || '<tr><td colspan="5" class="muted" style="text-align:center;padding:1rem">Ainda sem movimentos neste caixa</td></tr>'}</tbody></table></div>`;
  } catch (err) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(err.message)}</div>`; }
}
function htmlHistoricoCaixa(hist) {
  if (!hist.length) return '';
  return `<div class="card tabela-wrapper mt-2"><div class="card-titulo" style="padding:.6rem .8rem 0">CAIXAS ANTERIORES</div><table>
    <thead><tr><th>Abertura</th><th>Fecho</th><th style="text-align:right">Esperado</th><th style="text-align:right">Contado</th><th style="text-align:right">Diferença</th></tr></thead>
    <tbody>${hist.filter(h => h.fechada_em).map(h => `<tr><td>${new Date(h.aberta_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td><td>${new Date(h.fechada_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td>
      <td style="text-align:right">${formatarMoeda(h.esperado)}</td><td style="text-align:right">${formatarMoeda(h.contado)}</td>
      <td style="text-align:right;color:${parseFloat(h.diferenca) === 0 ? 'inherit' : 'var(--c-danger)'}">${formatarMoeda(h.diferenca)}</td></tr>`).join('')}</tbody></table></div>`;
}
async function abrirCaixa() {
  try { await api('POST', '/caixa/abrir', { fundo_inicial: parseFloat(document.getElementById('cx-fundo').value) || 0 }); toast('Caixa aberto', 'sucesso'); carregarModulo('caixa'); }
  catch (e) { toast(e.message, 'erro'); }
}
function modalFecharCaixa() {
  const r = (window._caixaEstado || {}).resumo || {};
  abrirModal('Fechar caixa', `
    <p style="margin-bottom:.6rem">Conte o dinheiro que está na gaveta. Esperado: <b>${formatarMoeda(r.dinheiro_esperado || 0)}</b>.</p>
    <div class="campo"><label>Dinheiro contado (Kz)</label><input id="cx-contado" type="number" min="0"></div>
    <div class="campo"><label>Observações</label><textarea id="cx-obs" rows="2" placeholder="Opcional"></textarea></div>
    <p class="muted texto-pequeno" style="margin-bottom:.8rem">Depois de fechar, só se volta a receber valores abrindo um novo caixa.</p>
    <div style="display:flex;gap:.5rem"><button class="btn-perigo" style="flex:1" data-on-click="fecharCaixa()">Fechar caixa</button>
    <button class="btn-secundario" style="flex:1" data-on-click="fecharModal()">Voltar</button></div>`);
}
async function fecharCaixa() {
  const contado = document.getElementById('cx-contado').value;
  if (contado === '') { toast('Indique o dinheiro contado', 'erro'); return; }
  try {
    const r = await api('POST', '/caixa/fechar', { contado: parseFloat(contado), observacoes: document.getElementById('cx-obs').value });
    fecharModal();
    const d = parseFloat(r.sessao.diferenca);
    toast(d === 0 ? 'Caixa fechado: contas certas' : `Caixa fechado com diferença de ${formatarMoeda(d)}`, d === 0 ? 'sucesso' : 'aviso', 7000);
    carregarModulo('caixa');
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Nuk-Coin ────────────────────────────────────────────────
async function modulo_nukcoin(el) {
  try {
    if (!await caixaAberto(el, '💜 Nuk-Coin')) return;
    el.innerHTML = `<div class="toolbar"><span class="secao-titulo">💜 Carregar Nuk-Coin</span></div>
      <div class="card" style="max-width:560px">
        <div style="display:flex;gap:.5rem"><input id="nc-q" placeholder="Nome ou telefone do cliente" style="flex:1"><button class="btn-primario" data-on-click="nukcoinProcurar()">Procurar</button></div>
        <div id="nc-res" style="margin-top:.75rem"></div>
      </div>`;
    if (window._nukcoinPre) { const id = window._nukcoinPre; window._nukcoinPre = null; await nukcoinEscolherId(id); }
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
async function nukcoinProcurar() {
  const q = (document.getElementById('nc-q').value || '').trim();
  const box = document.getElementById('nc-res');
  if (q.length < 2) { box.innerHTML = '<span class="muted">Escreva pelo menos 2 caracteres.</span>'; return; }
  try {
    const r = await api('GET', `/clientes?q=${encodeURIComponent(q)}&limit=10`);
    const lista = Array.isArray(r) ? r : (r.data || []);
    window._nukcoinClientes = lista;
    box.innerHTML = lista.length ? lista.map((c, i) => `<button class="btn-secundario btn-bloco" style="text-align:left;margin-bottom:.4rem" data-on-click="nukcoinEscolher(${i})">${esc(c.nome)} <span class="muted">${esc(c.telefone || '')}</span> <span style="float:right">💜 ${formatarMoeda(c.nukcoin_saldo || 0)}</span></button>`).join('')
      : '<span class="muted">Nenhum cliente cadastrado encontrado.</span>';
  } catch (e) { box.innerHTML = `<span class="erro-msg">${esc(e.message)}</span>`; }
}
function nukcoinEscolher(i) { const c = (window._nukcoinClientes || [])[i]; if (c) nukcoinPainel(c); }
async function nukcoinEscolherId(id) {
  const r = await api('GET', '/clientes?limit=500'); const lista = Array.isArray(r) ? r : (r.data || []);
  const c = lista.find(x => x.id === id); if (c) nukcoinPainel(c);
}
function nukcoinPainel(c) {
  window._nukcoinCliente = c;
  document.getElementById('nc-res').innerHTML = `
    <p style="margin:.4rem 0"><b>${esc(c.nome)}</b> — saldo actual 💜 ${formatarMoeda(c.nukcoin_saldo || 0)}</p>
    <div class="campo"><label>Forma de pagamento recebida</label><select id="nc-metodo">${optsFormas(FORMAS_BALCAO)}</select></div>
    <p class="muted texto-pequeno" style="margin-bottom:.5rem">Valor a creditar:</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
      ${NUKCOIN_VALORES.map(v => `<button class="btn-primario" data-on-click="nukcoinCarregar(${v})">${formatarMoeda(v)}</button>`).join('')}
    </div>`;
}
async function nukcoinCarregar(valor) {
  const c = window._nukcoinCliente; if (!c) return;
  try {
    const r = await api('POST', '/caixa/nukcoin', { cliente_id: c.id, valor, metodo: document.getElementById('nc-metodo').value });
    toast(`${formatarMoeda(valor)} carregados a ${c.nome}. Saldo: ${formatarMoeda(r.saldo_atual)}`, 'sucesso', 6000);
    carregarModulo('nukcoin');
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Cartões de consumo ──────────────────────────────────────
const CARTAO_VALORES = [5000, 10000, 20000, 50000];
async function modulo_cartoes(el) {
  try {
    if (!await caixaAberto(el, '💳 Cartões de consumo')) return;
    const lista = await api('GET', '/caixa/cartoes') || [];
    el.innerHTML = `<div class="toolbar"><span class="secao-titulo">💳 Cartões de consumo</span></div>
      <div class="card" style="max-width:520px">
        <div class="card-titulo">VENDER CARTÃO</div>
        <p class="muted texto-pequeno" style="margin:.4rem 0 .6rem">Cartão pré-pago com código. Quem o tiver paga pedidos até gastar o saldo, sem precisar de cadastro.</p>
        <div class="campo"><label>Forma de pagamento recebida</label><select id="cc-metodo">${optsFormas(FORMAS_BALCAO)}</select></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;margin-bottom:.6rem">
          ${CARTAO_VALORES.map(v => `<button class="btn-primario" data-on-click="venderCartao(${v})">${formatarMoeda(v)}</button>`).join('')}
        </div>
        <div style="display:flex;gap:.5rem"><input id="cc-valor" type="number" min="1000" max="500000" placeholder="Outro valor (Kz)" style="flex:1"><button class="btn-secundario" data-on-click="venderCartaoOutro()">Vender</button></div>
      </div>
      <div class="card tabela-wrapper mt-2"><table>
        <thead><tr><th>Código</th><th style="text-align:right">Valor inicial</th><th style="text-align:right">Saldo</th><th>Vendido às</th></tr></thead>
        <tbody>${lista.map(c => `<tr><td><b>${esc(c.codigo)}</b></td><td style="text-align:right">${formatarMoeda(c.valor_inicial)}</td><td style="text-align:right">${formatarMoeda(c.saldo)}</td><td>${new Date(c.criado_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted" style="text-align:center;padding:1rem">Ainda não vendeu cartões</td></tr>'}</tbody></table></div>`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function venderCartaoOutro() { venderCartao(parseInt(document.getElementById('cc-valor').value, 10)); }
async function venderCartao(valor) {
  try {
    const c = await api('POST', '/caixa/cartoes', { valor, metodo: document.getElementById('cc-metodo').value });
    abrirModal('Cartão vendido', `<p style="margin-bottom:.4rem">Entregue o cartão com este código ao cliente:</p>
      <div style="font-size:1.8rem;font-weight:800;letter-spacing:.12em;text-align:center;padding:.8rem;background:var(--c-bg);border-radius:8px">${esc(c.codigo)}</div>
      <p style="text-align:center;margin:.6rem 0">Saldo: <b>${formatarMoeda(c.saldo)}</b></p>
      <button class="btn-primario btn-bloco" data-on-click="fecharModal()">Concluído</button>`);
    carregarModulo('cartoes');
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Receber mesas (pedidos fechados) ────────────────────────
async function modulo_recebimentos(el) {
  try {
    if (!await caixaAberto(el, '🧾 Receber mesas')) return;
    const lista = await api('GET', '/caixa/por-receber') || [];
    // uma conta por mesa; os restantes (balcão, take away, remota) cada um com a sua
    const contas = {};
    lista.forEach(p => { const k = p.mesa_numero ? 'M' + p.mesa_numero : 'P' + p.id; (contas[k] = contas[k] || { titulo: p.mesa_numero ? `Mesa ${p.mesa_numero}` : ({ BALCAO: 'Balcão', TAKEAWAY: 'Take Away', REMOTA: 'Remota' }[p.origem] || 'Pedido') + (p.cliente_nome ? ` · ${p.cliente_nome}` : ''), pedidos: [] }).pedidos.push(p); });
    window._contas = Object.values(contas);
    el.innerHTML = `<div class="toolbar"><span class="secao-titulo">🧾 Receber mesas</span><span class="muted">Pedidos já fechados, à espera de pagamento</span></div>
      ${window._contas.length ? window._contas.map((c, i) => {
        const total = c.pedidos.reduce((a, p) => a + parseFloat(p.total), 0);
        return `<div class="card mb-2" style="max-width:640px"><div class="toolbar" style="margin-bottom:.4rem"><b>${esc(c.titulo)}</b><b class="texto-primario">${formatarMoeda(total)}</b></div>
          ${c.pedidos.flatMap(p => p.itens || []).map(it => `<div class="texto-pequeno">${it.quantidade}× ${esc(it.produto_nome)}</div>`).join('')}
          <button class="btn-primario btn-bloco" style="margin-top:.6rem" data-on-click="modalReceber(${i})">Receber ${formatarMoeda(total)}</button></div>`;
      }).join('') : '<div class="card muted">Nada por receber.</div>'}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function modalReceber(i) {
  const c = window._contas[i]; if (!c) return;
  const total = c.pedidos.reduce((a, p) => a + parseFloat(p.total), 0);
  window._contaActual = { i, total };
  abrirModal(`Receber · ${c.titulo}`, `
    <p style="margin-bottom:.6rem;font-size:1.2rem">Total: <b class="texto-primario">${formatarMoeda(total)}</b></p>
    <div class="campo"><label>Forma de pagamento</label><select id="rc-metodo" data-on-change="receberMetodo(this.value)">${optsFormas(FORMAS_RECEBER)}</select></div>
    <div id="rc-cash" class="campo"><label>Valor entregue (Kz, opcional para calcular o troco)</label><input id="rc-entregue" type="number" min="0" data-on-input="receberTroco()"><div id="rc-troco" class="muted texto-pequeno"></div></div>
    <div id="rc-pin" class="campo" style="display:none"><label>PIN do cliente (4 dígitos)</label><input id="rc-pin-v" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></div>
    <div id="rc-cartao" class="campo" style="display:none"><label>Código do cartão de consumo</label><input id="rc-codigo" placeholder="CCXXXXXXXX"></div>
    <button class="btn-primario btn-bloco" data-on-click="confirmarReceber()">Confirmar recebimento</button>`);
}
function receberMetodo(m) {
  document.getElementById('rc-cash').style.display = m === 'CASH' ? '' : 'none';
  document.getElementById('rc-pin').style.display = m === 'NUKCOIN' ? '' : 'none';
  document.getElementById('rc-cartao').style.display = m === 'CARTAO' ? '' : 'none';
}
function receberTroco() {
  const e = parseFloat(document.getElementById('rc-entregue').value);
  const t = window._contaActual.total;
  document.getElementById('rc-troco').textContent = Number.isFinite(e) ? (e >= t ? `Troco: ${formatarMoeda(e - t)}` : 'Valor inferior ao total') : '';
}
async function confirmarReceber() {
  const c = window._contas[window._contaActual.i];
  const metodo = document.getElementById('rc-metodo').value;
  const corpo = { pedido_ids: c.pedidos.map(p => p.id), metodo };
  if (metodo === 'CASH') { const e = document.getElementById('rc-entregue').value; if (e !== '') corpo.valor_entregue = parseFloat(e); }
  if (metodo === 'NUKCOIN') { corpo.pin = document.getElementById('rc-pin-v').value; const cli = c.pedidos.find(p => p.cliente_id); if (cli) corpo.cliente_id = cli.cliente_id; }
  if (metodo === 'CARTAO') corpo.codigo_cartao = document.getElementById('rc-codigo').value;
  try {
    const r = await api('POST', '/caixa/receber', corpo);
    fecharModal();
    toast(`Recebido ${formatarMoeda(r.total)}` + (r.troco ? ` · troco ${formatarMoeda(r.troco)}` : '') + (r.saldo_restante !== null && r.saldo_restante !== undefined ? ` · saldo ${formatarMoeda(r.saldo_restante)}` : ''), 'sucesso', 7000);
    carregarModulo('recebimentos');
  } catch (e) { toast(e.message, 'erro'); }
}
