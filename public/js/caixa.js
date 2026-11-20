'use strict';
/**
 * Caixa do dia (turno): Caixa do dia | Nuk-Coin | Cartões de consumo | Receber mesas.
 * Tudo o que mexe em dinheiro exige o caixa aberto (o servidor recusa com 409 CAIXA_FECHADO).
 * Sem handlers inline (CSP): data-on-click / data-on-change com argumentos literais.
 */
const FORMAS_BALCAO = { CASH: 'Dinheiro', TPA: 'TPA', TRANSFERENCIA: 'Transferência', EXPRESS: 'Express' };
const FORMAS_RECEBER = { ...FORMAS_BALCAO, NUKCOIN: 'Nuk-Coin (PIN)', CARTAO: 'Cartão de consumo', CONTA: 'Conta corrente (crédito)' };
const ROTULO_MOV = { NUKCOIN_CARREGAMENTO: 'Nuk-Coin', CARTAO_VENDA: 'Cartão de consumo', RECEBIMENTO: 'Recebimento', COMPRA: 'Compra', CONTA_PAGAMENTO: 'Pagamento de conta corrente', DESPESA: 'Despesa' };
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
        ${kpi('Dinheiro esperado na gaveta', r.dinheiro_esperado, `fundo ${formatarMoeda(r.fundo_inicial)} + movimentos em dinheiro ${formatarMoeda(r.dinheiro_recebido)}`)}
        ${Object.entries(r.por_metodo).map(([m, v]) => kpi(FORMAS_RECEBER[m] || m, v)).join('')}
      </div>
      <div class="card tabela-wrapper mt-2"><table>
        <thead><tr><th>N.º</th><th>Hora</th><th>Operação</th><th>Forma</th><th>Detalhe</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>${e.movimentos.map(m => `<tr><td class="muted texto-pequeno">${m.numero || ''}</td><td>${hora(m.criado_em)}</td><td>${esc(ROTULO_MOV[m.tipo] || m.tipo)}</td><td>${esc(FORMAS_RECEBER[m.metodo] || m.metodo)}</td>
          <td>${esc(m.mesa_numero ? 'Mesa ' + m.mesa_numero : (m.cliente_nome || m.descricao || ''))}</td><td style="text-align:right">${formatarMoeda(m.valor)}</td></tr>`).join('')
          || '<tr><td colspan="6" class="muted" style="text-align:center;padding:1rem">Ainda sem movimentos neste caixa</td></tr>'}</tbody></table></div>`;
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
// Os cartões (valores) configuram-se em Configurações → Cartões de consumo e aparecem aqui como botões, como os quartos.
// Vende-se carregando no cartão, indicando a quantidade e os códigos dos cartões impressos entregues, e validando.
// Cobra-se o valor do cartão, sem desconto (decisão do dono de 20/11/2026).
const chefiaCartoes = () => typeof NUK !== 'undefined' && NUK.utilizador && ['ADMIN', 'GERENTE'].includes(NUK.utilizador.nivel_acesso);
const VENDA_CARTOES_MAX = 50;
const RE_CODIGO_CARTAO = /^CC[A-Z0-9]{8}$/;
const normCodigoCartao = c => String(c || '').trim().toUpperCase().replace(/[\s-]/g, '');

/** Lotes de cartões pré-impressos (só chefia). Não mexe em dinheiro, por isso aparece mesmo com o caixa fechado. */
async function htmlLotesCartoes(tipos) {
  if (!chefiaCartoes()) return '';
  const [lotes, ts] = await Promise.all([api('GET', '/caixa/cartoes/lotes'), tipos ? tipos : api('GET', '/caixa/cartoes/tipos')]);
  const valores = (ts || []).map(t => Number(t.valor));
  return `<div class="card mt-2" style="max-width:640px">
      <div class="card-titulo">CARTÕES PARA IMPRIMIR (LOTES)</div>
      <p class="muted texto-pequeno" style="margin:.4rem 0 .6rem">Gere os códigos, imprima a folha em cartolina (10 cartões por página) e recorte. Cada cartão fica sem saldo até ser vendido no caixa: perdido antes disso, não vale nada.</p>
      ${valores.length ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end">
        <div class="campo" style="flex:1;min-width:140px;margin:0"><label>Valor do cartão</label><select id="lote-valor">${valores.map(v => `<option value="${v}">${formatarMoeda(v)}</option>`).join('')}</select></div>
        <div class="campo" style="width:120px;margin:0"><label>Quantidade</label><input id="lote-qtd" type="number" min="1" max="200" value="20"></div>
        <button class="btn-primario" data-on-click="gerarLoteCartoes()">Gerar lote</button>
      </div>` : '<p class="muted texto-pequeno">Crie primeiro os cartões em ⚙️ Configurações → Cartões de consumo.</p>'}
      <div class="tabela-wrapper mt-2"><table>
        <thead><tr><th>Lote</th><th style="text-align:right">Valor</th><th style="text-align:right">Cartões</th><th style="text-align:right">Vendidos</th><th>Criado</th><th></th></tr></thead>
        <tbody>${(lotes || []).map(l => `<tr><td><b>N.º ${l.numero}</b></td><td style="text-align:right">${formatarMoeda(l.valor)}</td><td style="text-align:right">${l.quantidade}</td><td style="text-align:right">${l.vendidos}</td>
            <td class="texto-pequeno">${new Date(l.criado_em).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })}${l.criado_por_nome ? ` · ${esc(l.criado_por_nome)}` : ''}</td>
            <td><button class="btn-secundario" style="padding:.2rem .55rem;font-size:.75rem" data-on-click="imprimirLoteCartoes('${esc(l.id)}','${l.numero}')">🖨️ Imprimir</button></td></tr>`).join('')
          || '<tr><td colspan="6" class="muted" style="text-align:center;padding:1rem">Ainda não gerou lotes</td></tr>'}</tbody></table></div>
    </div>`;
}

function htmlBotaoCartao(t) {
  const n = Number(t.por_vender) || 0;
  return `<div class="quarto-card cartao-card ${n ? 'DISPONIVEL' : 'LIMPEZA'}" data-on-click="modalVenderCartoes(${Number(t.valor)})">
      <div class="card-numero">${formatarMoeda(t.valor)}</div>
      <div class="card-tipo">${esc(t.nome || 'Cartão de consumo')}</div>
      <div class="quarto-estado">${n ? `${n} impresso${n === 1 ? '' : 's'} por vender` : 'Sem impressos por vender'}</div>
    </div>`;
}

async function modulo_cartoes(el) {
  try {
    if (!await caixaAberto(el, '💳 Cartões de consumo')) { el.innerHTML += await htmlLotesCartoes(); return; }
    const [tipos, lista] = await Promise.all([api('GET', '/caixa/cartoes/tipos'), api('GET', '/caixa/cartoes')]);
    window._tiposCartao = tipos || [];
    el.innerHTML = `<div class="toolbar"><span class="secao-titulo">💳 Cartões de consumo</span></div>
      <p class="muted texto-pequeno" style="margin-bottom:.6rem">Cartão pré-pago para quem não usa telemóvel. Toque no cartão, indique a quantidade e os códigos dos cartões que entrega, e valide. Cobra-se o valor do cartão, sem desconto.</p>
      ${window._tiposCartao.length ? `<div class="grid-cards">${window._tiposCartao.map(htmlBotaoCartao).join('')}</div>`
        : '<div class="muted" style="padding:2rem;text-align:center">Ainda não há cartões. Um Administrador cria-os em <b>⚙️ Configurações → Cartões de consumo</b>.</div>'}
      ${window._tiposCartao.length ? `<details class="card mt-2" style="max-width:640px"><summary class="muted texto-pequeno" style="cursor:pointer">Sem cartões impressos? Gerar um código na hora para escrever no cartão</summary>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end;margin-top:.6rem">
          <div class="campo" style="flex:1;min-width:120px;margin:0"><label>Valor</label><select id="cc-valor">${window._tiposCartao.map(t => `<option value="${Number(t.valor)}">${formatarMoeda(t.valor)}</option>`).join('')}</select></div>
          <div class="campo" style="flex:1;min-width:120px;margin:0"><label>Forma de pagamento</label><select id="cc-metodo">${optsFormas(FORMAS_BALCAO)}</select></div>
          <button class="btn-secundario" data-on-click="venderCartaoOutro()">Gerar e vender</button>
        </div></details>` : ''}
      <div class="card tabela-wrapper mt-2" style="max-width:640px"><table>
        <thead><tr><th>Código</th><th style="text-align:right">Valor inicial</th><th style="text-align:right">Saldo</th><th>Vendido às</th></tr></thead>
        <tbody>${(lista || []).map(c => `<tr><td><b>${esc(c.codigo)}</b></td><td style="text-align:right">${formatarMoeda(c.valor_inicial)}</td><td style="text-align:right">${formatarMoeda(c.saldo)}</td><td>${new Date(c.criado_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted" style="text-align:center;padding:1rem">Ainda não vendeu cartões</td></tr>'}</tbody></table></div>
      ${await htmlLotesCartoes(window._tiposCartao)}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}

// Venda pela grelha: quantidade → códigos → validar
function modalVenderCartoes(valor) {
  const t = (window._tiposCartao || []).find(x => Number(x.valor) === Number(valor)) || { valor };
  window._vendaCartoes = { valor: Number(valor), qtd: 1, codigos: [''] };
  abrirModal(`Vender cartões de ${formatarMoeda(valor)}`, `
    ${t.nome ? `<p class="muted texto-pequeno" style="margin-bottom:.4rem">${esc(t.nome)}</p>` : ''}
    <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end">
      <div class="campo" style="margin:0"><label>Quantidade</label>
        <div style="display:flex;gap:.35rem;align-items:center">
          <button class="btn-secundario" style="width:2.4rem" data-on-click="vcQtd(-1)">−</button>
          <input id="vc-qtd" type="number" min="1" max="${VENDA_CARTOES_MAX}" value="1" style="width:4.5rem;text-align:center" data-on-input="vcQtdDefinir(this.value)">
          <button class="btn-secundario" style="width:2.4rem" data-on-click="vcQtd(1)">+</button>
        </div></div>
      <div class="campo" style="flex:1;min-width:140px;margin:0"><label>Forma de pagamento</label><select id="vc-metodo">${optsFormas(FORMAS_BALCAO)}</select></div>
    </div>
    <p class="muted texto-pequeno" style="margin:.7rem 0 .3rem">Códigos dos cartões entregues (escreva ou leia com o leitor; passa sozinho ao seguinte):</p>
    <div id="vc-codigos"></div>
    <p id="vc-total" style="font-size:1.25rem;text-align:center;margin:.8rem 0"></p>
    <div style="display:flex;gap:.5rem">
      <button class="btn-primario" style="flex:1" data-on-click="vcValidar()">Validar venda</button>
      <button class="btn-secundario" style="flex:1" data-on-click="fecharModal()">Cancelar</button></div>`);
  vcDesenhar();
}
function vcDesenhar() {
  const v = window._vendaCartoes; if (!v) return;
  const caixa = document.getElementById('vc-codigos');
  if (caixa) caixa.innerHTML = v.codigos.map((c, i) => `<div class="campo" style="display:flex;gap:.5rem;align-items:center;margin:0 0 .35rem">
      <span class="muted texto-pequeno" style="width:4.2rem">Cartão ${i + 1}</span>
      <input id="vc-cod-${i}" value="${esc(c)}" placeholder="CCXXXXXXXX" autocomplete="off" style="flex:1;text-transform:uppercase" data-on-input="vcCodigo(${i}, this.value)"></div>`).join('');
  const q = document.getElementById('vc-qtd'); if (q) q.value = v.qtd;
  const t = document.getElementById('vc-total');
  if (t) t.innerHTML = `Cobrar ao cliente: <b>${formatarMoeda(v.qtd * v.valor)}</b> <span class="muted texto-pequeno">(${v.qtd} × ${formatarMoeda(v.valor)})</span>`;
}
function vcQtdDefinir(n) {
  const v = window._vendaCartoes; if (!v) return;
  const q = Math.min(VENDA_CARTOES_MAX, Math.max(1, parseInt(n, 10) || 1));
  v.qtd = q;
  v.codigos = Array.from({ length: q }, (_, i) => v.codigos[i] || '');
  vcDesenhar();
  const vazio = v.codigos.findIndex(c => !c);
  const el = document.getElementById(`vc-cod-${vazio < 0 ? q - 1 : vazio}`);
  if (el && el.focus) el.focus();
}
function vcQtd(delta) { const v = window._vendaCartoes; if (v) vcQtdDefinir(v.qtd + Number(delta)); }
function vcCodigo(i, valor) {
  const v = window._vendaCartoes; if (!v) return;
  v.codigos[i] = normCodigoCartao(valor);
  if (RE_CODIGO_CARTAO.test(v.codigos[i])) { const prox = document.getElementById(`vc-cod-${i + 1}`); if (prox && prox.focus) prox.focus(); }
}
async function vcValidar() {
  const v = window._vendaCartoes; if (!v) return;
  const cods = v.codigos.map(normCodigoCartao);
  const falta = cods.findIndex(c => !c);
  if (falta >= 0) return toast(`Falta o código do cartão ${falta + 1}`, 'aviso');
  const mau = cods.findIndex(c => !RE_CODIGO_CARTAO.test(c));
  if (mau >= 0) return toast(`Código do cartão ${mau + 1} inválido (CC + 8 caracteres)`, 'aviso');
  const rep = cods.findIndex((c, i) => cods.indexOf(c) !== i);
  if (rep >= 0) return toast(`O código ${cods[rep]} está repetido`, 'aviso');
  try {
    const r = await api('POST', '/caixa/cartoes/vender', { valor: v.valor, metodo: document.getElementById('vc-metodo').value, codigos: cods });
    window._vendaCartoes = null;
    abrirModal('Venda concluída', `<p style="text-align:center;font-size:1.2rem;margin-bottom:.5rem"><b>${r.quantidade}</b> cartão${r.quantidade === 1 ? '' : 'ões'} · <b>${formatarMoeda(r.total)}</b></p>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem;justify-content:center;margin-bottom:.8rem">${r.cartoes.map(c => `<span class="status-badge status-CHECKIN">${esc(c.codigo)}</span>`).join('')}</div>
      <p class="muted texto-pequeno" style="text-align:center;margin-bottom:.8rem">Cada cartão ficou com ${formatarMoeda(v.valor)} de saldo.</p>
      <button class="btn-primario btn-bloco" data-on-click="fecharModal()">Concluído</button>`);
    carregarModulo('cartoes');
  } catch (e) { toast(e.message, 'erro'); }
}

function venderCartaoOutro() { venderCartao(parseInt(document.getElementById('cc-valor').value, 10)); }
function modalCartaoVendido(c) {
  abrirModal('Cartão vendido', `<p style="margin-bottom:.4rem">Escreva este código no cartão e entregue-o ao cliente:</p>
      <div style="font-size:1.8rem;font-weight:800;letter-spacing:.12em;text-align:center;padding:.8rem;background:var(--c-bg);border-radius:8px">${esc(c.codigo)}</div>
      <p style="text-align:center;margin:.6rem 0">Saldo: <b>${formatarMoeda(c.saldo)}</b></p>
      <button class="btn-primario btn-bloco" data-on-click="fecharModal()">Concluído</button>`);
}
async function venderCartao(valor) {
  try {
    const c = await api('POST', '/caixa/cartoes', { valor, metodo: document.getElementById('cc-metodo').value });
    modalCartaoVendido(c);
    carregarModulo('cartoes');
  } catch (e) { toast(e.message, 'erro'); }
}
async function gerarLoteCartoes() {
  const valor = parseInt(document.getElementById('lote-valor').value, 10);
  const quantidade = parseInt(document.getElementById('lote-qtd').value, 10);
  if (!(quantidade >= 1 && quantidade <= 200)) return toast('Quantidade de 1 a 200 cartões por lote', 'aviso');
  try {
    const l = await api('POST', '/caixa/cartoes/lotes', { valor, quantidade });
    toast(`Lote N.º ${l.numero}: ${l.quantidade} cartões de ${formatarMoeda(l.valor)}. A descarregar a folha para imprimir…`, 'sucesso', 6000);
    imprimirLoteCartoes(l.id, l.numero);
    carregarModulo('cartoes');
  } catch (e) { toast(e.message, 'erro'); }
}
function imprimirLoteCartoes(id, numero) { descarregarPdf(`/caixa/cartoes/lotes/${id}/pdf`, `cartoes-lote-${numero}.pdf`); }

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
              ${(p.itens || []).map(it => `<div class="texto-pequeno">${it.quantidade}× ${esc(it.produto_nome)}</div>`).join('')}</div>`).join('')
            : c.pedidos.flatMap(p => p.itens || []).map(it => `<div class="texto-pequeno">${it.quantidade}× ${esc(it.produto_nome)}</div>`).join('')}
          <div style="display:flex;gap:.5rem;margin-top:.6rem">
            ${podeDividir(c) ? `<button class="btn-secundario" style="flex:1" data-on-click="modalDividir(${i})">Dividir conta</button>` : ''}
            <button class="btn-primario" style="flex:2" data-on-click="modalReceber(${i})">Receber ${c.pedidos.length > 1 ? 'tudo · ' : ''}${formatarMoeda(total)}</button>
          </div></div>`;
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

// ── Contas correntes (crédito a clientes) ───────────────────
async function modulo_contas(el) {
  try {
    const lista = await api('GET', '/caixa/conta-corrente') || [];
    window._listaCC = lista;
    const divida = lista.reduce((a, c) => a + Number(c.saldo || 0), 0);
    el.innerHTML = `<div class="toolbar"><span class="secao-titulo">📒 Contas correntes</span><span class="muted">Em dívida: <b class="texto-primario">${formatarMoeda(divida)}</b></span></div>
      <div class="muted texto-pequeno" style="margin-bottom:.6rem">O consumo entra na conta em Receber mesas → «Conta corrente». Os pagamentos da dívida exigem o caixa aberto. Autorizar clientes e limites: Configurações (administrador).</div>
      ${lista.length ? `<div class="card"><div class="tabela-wrapper"><table>
        <thead><tr><th>Cliente</th><th>Limite</th><th>Em dívida</th><th>Disponível</th><th></th></tr></thead>
        <tbody>${lista.map(c => `<tr>
          <td><b>${esc(c.nome)}</b>${c.telefone ? `<div class="muted texto-pequeno">${esc(c.telefone)}</div>` : ''}${c.conta_corrente_ativa ? '' : '<div class="texto-pequeno" style="color:var(--c-danger)">Conta retirada</div>'}</td>
          <td class="muted">${formatarMoeda(c.limite_credito)}</td>
          <td class="negrito ${Number(c.saldo) > 0 ? 'texto-primario' : 'muted'}">${formatarMoeda(c.saldo)}</td>
          <td class="muted">${formatarMoeda(c.disponivel)}</td>
          <td style="white-space:nowrap"><button class="btn-secundario" style="padding:.25rem .6rem;font-size:.75rem" data-on-click="modalExtractoConta('${esc(c.id)}')">Extracto</button>
            ${Number(c.saldo) > 0 ? `<button class="btn-primario" style="padding:.25rem .6rem;font-size:.75rem" data-on-click="modalPagarConta('${esc(c.id)}')">Receber pagamento</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div></div>` : '<div class="card muted">Ainda não há clientes com conta corrente. O administrador autoriza-os em Configurações.</div>'}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function modalPagarConta(id) {
  const c = (window._listaCC || []).find(x => x.id === id); if (!c) return;
  abrirModal(`Pagamento · ${c.nome}`, `
    <p style="margin-bottom:.6rem">Em dívida: <b class="texto-primario">${formatarMoeda(c.saldo)}</b></p>
    <div class="campo"><label>Valor a pagar (Kz)</label><input id="ccp-valor" type="number" min="0" value="${Number(c.saldo)}"></div>
    <div class="campo"><label>Forma de pagamento</label><select id="ccp-metodo">${optsFormas(FORMAS_BALCAO)}</select></div>
    <div class="campo"><label>Observações (opcional)</label><input id="ccp-obs" maxlength="200" placeholder="Ex.: transferência ref. 1234"></div>
    <button class="btn-primario btn-bloco" data-on-click="confirmarPagarConta('${esc(c.id)}')">Registar pagamento</button>`);
}
async function confirmarPagarConta(id) {
  const valor = parseFloat(document.getElementById('ccp-valor').value);
  if (!(valor > 0)) { toast('Valor inválido', 'erro'); return; }
  try {
    const r = await api('POST', `/caixa/conta-corrente/${id}/pagamentos`, { valor, metodo: document.getElementById('ccp-metodo').value, observacoes: document.getElementById('ccp-obs').value });
    fecharModal();
    toast(`Pagamento de ${formatarMoeda(r.pago)} registado · em dívida ${formatarMoeda(r.saldo)}`, 'sucesso', 7000);
    carregarModulo('contas');
  } catch (e) { toast(e.message, 'erro'); }
}
async function modalExtractoConta(id) {
  try {
    const x = await api('GET', `/caixa/conta-corrente/${id}`);
    abrirModal(`Extracto · ${x.cliente.nome}`, `
      <p style="margin-bottom:.6rem">Em dívida: <b class="texto-primario">${formatarMoeda(x.cliente.saldo)}</b> · limite ${formatarMoeda(x.cliente.limite_credito)}</p>
      <div class="tabela-wrapper" style="max-height:60vh;overflow:auto"><table>
        <thead><tr><th>Data</th><th>Movimento</th><th>Valor</th><th>Saldo</th></tr></thead>
        <tbody>${x.movimentos.length ? x.movimentos.map(m => `<tr>
          <td class="muted texto-pequeno">${new Date(m.criado_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td>
          <td>${m.tipo === 'DEBITO' ? 'Consumo' : `Pagamento (${FORMAS_BALCAO[m.metodo] || m.metodo})`}${m.funcionario ? `<div class="muted texto-pequeno">${esc(m.funcionario)}</div>` : ''}</td>
          <td class="negrito">${m.tipo === 'DEBITO' ? '' : '−'}${formatarMoeda(m.valor)}</td>
          <td class="muted">${formatarMoeda(m.saldo_apos)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Sem movimentos</td></tr>'}</tbody>
      </table></div>`);
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Movimentos do caixa (rasto e auditoria) ─────────────────
// Livro numerado, encadeado (SHA-256) e imutável no servidor; aqui pesquisa-se, exporta-se e verifica-se.
const ROTULO_TIPO_MOV = { NUKCOIN_CARREGAMENTO: 'Carregamento Nuk-Coin', CARTAO_VENDA: 'Venda de cartão', RECEBIMENTO: 'Recebimento', COMPRA: 'Compra pontual', CONTA_PAGAMENTO: 'Pagamento de conta corrente', DESPESA: 'Despesa' };
const ROTULO_FORMA_MOV = { CASH: 'Dinheiro', TPA: 'TPA', TRANSFERENCIA: 'Transferência', EXPRESS: 'Express', NUKCOIN: 'Nuk-Coin', CARTAO: 'Cartão de consumo' };
const hojeLuandaCx = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });

function filtroMovimentos() {
  const v = id => String((document.getElementById(id) || {}).value || '').trim();
  const f = { de: v('mv-de'), ate: v('mv-ate'), tipo: v('mv-tipo'), metodo: v('mv-metodo'), numero: v('mv-numero'), cartao: v('mv-cartao').toUpperCase() };
  return Object.fromEntries(Object.entries(f).filter(([, x]) => x));
}
const qsMov = (f, extra = {}) => new URLSearchParams({ ...f, ...extra }).toString();

async function modulo_movimentos(el) {
  const hoje = hojeLuandaCx();
  window._movFiltro = window._movFiltro || { de: hoje, ate: hoje };
  window._movPagina = 1;
  const f = window._movFiltro;
  const opts = (mapa, sel) => `<option value="">Todos</option>${Object.entries(mapa).map(([k, r]) => `<option value="${k}"${sel === k ? ' selected' : ''}>${r}</option>`).join('')}`;
  el.innerHTML = `<div class="toolbar"><span class="secao-titulo">🔎 Movimentos do caixa</span>
      <span style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn-secundario" data-on-click="verificarLivroCaixa()">🛡️ Verificar integridade</button><button class="btn-secundario" data-on-click="exportarMovimentos()">⬇️ Exportar CSV</button></span></div>
    <p class="muted texto-pequeno" style="margin-bottom:.6rem">Cada entrada e saída de valores fica aqui com número sequencial, hora, forma, funcionário e referência. Nenhum movimento se altera nem apaga: um engano corrige-se com um movimento contrário.</p>
    <div class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.5rem;align-items:end">
      <div class="campo" style="margin:0"><label>De</label><input id="mv-de" type="date" value="${esc(f.de || '')}"></div>
      <div class="campo" style="margin:0"><label>Até</label><input id="mv-ate" type="date" value="${esc(f.ate || '')}"></div>
      <div class="campo" style="margin:0"><label>Tipo</label><select id="mv-tipo">${opts(ROTULO_TIPO_MOV, f.tipo)}</select></div>
      <div class="campo" style="margin:0"><label>Forma</label><select id="mv-metodo">${opts(ROTULO_FORMA_MOV, f.metodo)}</select></div>
      <div class="campo" style="margin:0"><label>N.º do movimento</label><input id="mv-numero" type="number" min="1" value="${esc(f.numero || '')}"></div>
      <div class="campo" style="margin:0"><label>Cartão de consumo</label><input id="mv-cartao" placeholder="CCXXXXXXXX" value="${esc(f.cartao || '')}"></div>
      <button class="btn-primario" data-on-click="pesquisarMovimentos()">Pesquisar</button>
    </div>
    <div id="mv-resultado" class="mt-2"><div class="loading-spinner">A carregar...</div></div>`;
  await carregarMovimentos();
}
function pesquisarMovimentos() { window._movFiltro = filtroMovimentos(); window._movPagina = 1; return carregarMovimentos(); }
function paginaMovimentos(delta) { window._movPagina = Math.max(1, (window._movPagina || 1) + Number(delta)); return carregarMovimentos(); }
async function carregarMovimentos() {
  const alvo = document.getElementById('mv-resultado');
  try {
    const r = await api('GET', `/caixa/auditoria/movimentos?${qsMov(window._movFiltro, { page: window._movPagina || 1, limit: 50 })}`);
    const t = r.totais || { entradas: 0, saidas: 0, liquido: 0, por_metodo: [] };
    const paginas = Math.max(1, Math.ceil((r.total || 0) / (r.limit || 50)));
    alvo.innerHTML = `<div class="card" style="display:flex;gap:1.2rem;flex-wrap:wrap">
        <div><div class="muted texto-pequeno">Movimentos</div><b>${r.total || 0}</b></div>
        <div><div class="muted texto-pequeno">Entradas</div><b class="texto-sucesso">${formatarMoeda(t.entradas)}</b></div>
        <div><div class="muted texto-pequeno">Saídas</div><b class="texto-perigo">${formatarMoeda(t.saidas)}</b></div>
        <div><div class="muted texto-pequeno">Líquido</div><b>${formatarMoeda(t.liquido)}</b></div>
        ${t.por_metodo.map(x => `<div><div class="muted texto-pequeno">${esc(ROTULO_FORMA_MOV[x.metodo] || x.metodo)} (${x.n})</div><b>${formatarMoeda(x.valor)}</b></div>`).join('')}
      </div>
      <div class="card tabela-wrapper mt-2"><table>
        <thead><tr><th>N.º</th><th>Data e hora</th><th>Tipo</th><th>Forma</th><th style="text-align:right">Valor</th><th>Referência</th><th>Funcionário</th></tr></thead>
        <tbody>${(r.data || []).map(m => `<tr>
            <td><b>${m.numero}</b></td>
            <td class="texto-pequeno">${new Date(m.criado_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td>
            <td>${esc(ROTULO_TIPO_MOV[m.tipo] || m.tipo)}${m.descricao ? `<div class="muted texto-pequeno">${esc(m.descricao)}</div>` : ''}</td>
            <td>${esc(ROTULO_FORMA_MOV[m.metodo] || m.metodo)}</td>
            <td style="text-align:right" class="${Number(m.valor) < 0 ? 'texto-perigo' : ''}"><b>${formatarMoeda(m.valor)}</b></td>
            <td class="texto-pequeno">${esc(m.referencia || '—')}${m.cartao_codigo ? ` <button class="btn-secundario" style="padding:.1rem .45rem;font-size:.72rem" data-on-click="rastoCartao('${esc(m.cartao_codigo)}')">Rasto</button>` : ''}</td>
            <td class="texto-pequeno">${esc(m.operador || '—')}</td></tr>`).join('')
          || '<tr><td colspan="7" class="muted" style="text-align:center;padding:1rem">Sem movimentos neste filtro</td></tr>'}</tbody></table></div>
      ${paginas > 1 ? `<div style="display:flex;gap:.5rem;justify-content:center;align-items:center;margin-top:.6rem">
        <button class="btn-secundario" data-on-click="paginaMovimentos(-1)"${r.page <= 1 ? ' disabled' : ''}>‹ Anterior</button>
        <span class="muted texto-pequeno">Página ${r.page} de ${paginas}</span>
        <button class="btn-secundario" data-on-click="paginaMovimentos(1)"${r.page >= paginas ? ' disabled' : ''}>Seguinte ›</button></div>` : ''}`;
  } catch (e) { alvo.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function exportarMovimentos() {
  window._movFiltro = filtroMovimentos();
  const f = window._movFiltro;
  descarregarPdf(`/caixa/auditoria/movimentos.csv?${qsMov(f)}`, `movimentos-caixa-${f.de || 'rasto'}${f.ate && f.ate !== f.de ? '_' + f.ate : ''}.csv`);
}
async function verificarLivroCaixa() {
  try {
    const r = await api('GET', '/caixa/auditoria/verificar');
    abrirModal(r.ok ? '🛡️ Livro do caixa íntegro' : '⚠️ Problemas no livro do caixa', r.ok
      ? `<p>Os <b>${r.movimentos}</b> movimentos (n.º 1 a ${r.ultimo_numero}) estão completos e sem alterações. Os saldos dos cartões e o dinheiro esperado de cada sessão fechada conferem.</p>
         <button class="btn-primario btn-bloco mt-2" data-on-click="fecharModal()">Fechar</button>`
      : `<p style="margin-bottom:.5rem">Encontrei sinais de alteração feita fora do sistema. Guarde esta lista e contacte o suporte:</p>
         <ul style="margin:0 0 .8rem 1.1rem">${r.problemas.map(p => `<li>${esc(p.texto)}</li>`).join('')}</ul>
         <button class="btn-primario btn-bloco" data-on-click="fecharModal()">Fechar</button>`);
  } catch (e) { toast(e.message, 'erro'); }
}
async function rastoCartao(codigo) {
  try {
    const r = await api('GET', `/caixa/auditoria/cartoes/${encodeURIComponent(codigo)}`);
    const c = r.cartao;
    const ROT = { VENDA: 'Venda', CONSUMO: 'Consumo', ESTORNO: 'Estorno' };
    abrirModal(`💳 Cartão ${esc(c.codigo)}`, `<p class="texto-pequeno" style="margin-bottom:.5rem">${c.lote_numero ? `Lote ${esc(c.lote_numero)} · ` : ''}Valor ${formatarMoeda(c.valor_inicial)} · Saldo <b>${formatarMoeda(c.saldo)}</b> · ${c.estado === 'ACTIVO' ? `vendido ${c.vendido_em ? new Date(c.vendido_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' }) : ''}${c.vendido_por_nome ? ` por ${esc(c.vendido_por_nome)}` : ''}` : 'ainda por vender'}</p>
      <div class="tabela-wrapper"><table><thead><tr><th>Quando</th><th>Movimento</th><th style="text-align:right">Valor</th><th style="text-align:right">Saldo</th><th>Onde</th></tr></thead>
      <tbody>${r.movimentos.map(m => `<tr><td class="texto-pequeno">${new Date(m.criado_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td><td>${ROT[m.tipo] || esc(m.tipo)}</td>
        <td style="text-align:right">${m.tipo === 'CONSUMO' ? '−' : ''}${formatarMoeda(m.valor)}</td><td style="text-align:right">${formatarMoeda(m.saldo_depois)}</td>
        <td class="texto-pequeno">${m.mesa_numero ? `Mesa ${esc(m.mesa_numero)}` : m.quarto_numero ? `Quarto ${esc(m.quarto_numero)}` : esc(m.origem || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sem movimentos</td></tr>'}</tbody></table></div>
      <button class="btn-primario btn-bloco mt-2" data-on-click="fecharModal()">Fechar</button>`);
  } catch (e) { toast(e.message, 'erro'); }
}

