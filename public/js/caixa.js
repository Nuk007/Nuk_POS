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
      el.innerHTML = `<div class="toolbar"><span class="secao-titulo">💵 Caixa do dia</span>${botaoFolhaCaixa()}</div>
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
        ${botaoFolhaCaixa()}
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
      <td style="text-align:right;color:${parseFloat(h.diferenca) === 0 ? 'inherit' : 'var(--c-danger)'}">${formatarMoeda(h.diferenca)}</td></tr>${h.justificacao ? `<tr><td colspan="5" class="texto-pequeno muted" style="padding-top:0">Justificação: ${esc(h.justificacao)}</td></tr>` : ''}`).join('')}</tbody></table></div>`;
}
async function abrirCaixa() {
  try { await api('POST', '/caixa/abrir', { fundo_inicial: parseFloat(document.getElementById('cx-fundo').value) || 0 }); toast('Caixa aberto', 'sucesso'); carregarModulo('caixa'); }
  catch (e) { toast(e.message, 'erro'); }
}
// Fecho do caixa (regras do dono, 20/11/2026): nunca com contas por pagar; se a contagem não bater certo com o
// esperado, só com justificação escrita. O servidor decide sempre; o ecrã mostra antes para não haver surpresas.
const ESTADO_PEDIDO_CX = { ABERTO: 'na cozinha', EM_PREPARO: 'em preparação', PRONTO: 'pronto, por fechar', FECHADO: 'por receber' };
function htmlContasPorPagar(p) {
  window._pendenciasFecho = p;
  const ref = c => c.mesa_numero ? `Mesa ${esc(c.mesa_numero)}` : c.quarto_numero ? `Quarto ${esc(c.quarto_numero)}` : esc(c.cliente_nome || (c.origem === 'REMOTA' ? 'Pedido remoto' : 'Balcão'));
  return `<div class="erro-msg" style="margin-bottom:.6rem"><b>Não pode fechar o caixa:</b> ${p.n === 1 ? 'existe 1 conta' : `existem ${p.n} contas`} por pagar (${formatarMoeda(p.total)}). ${p.n === 1 ? 'Receba-a ou termine-a' : 'Receba-as ou termine-as'} primeiro.</div>
    <div class="tabela-wrapper" style="max-height:40vh;overflow:auto;margin-bottom:.8rem"><table>
      <thead><tr><th>Conta</th><th>Situação</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>${p.contas.map(c => `<tr><td>${ref(c)}</td><td class="texto-pequeno">${c.por_validar ? 'remoto por validar' : esc(ESTADO_PEDIDO_CX[c.status] || c.status)}</td><td style="text-align:right">${formatarMoeda(c.total)}</td>${euChefiaCaixa() && !c.por_validar ? `<td><button class="btn-perigo" style="padding:.2rem .5rem;font-size:.72rem" data-on-click="pedirPerdaPendencia('${esc(c.id)}')">Não paga…</button></td>` : ''}</tr>`).join('')}</tbody></table></div>
    <div style="display:flex;gap:.5rem"><button class="btn-primario" style="flex:1" data-on-click="fecharModal();carregarModulo('recebimentos')">Ir para Receber mesas</button>
    <button class="btn-secundario" style="flex:1" data-on-click="fecharModal()">Voltar</button></div>`;
}
function modalFecharCaixa() {
  const e = window._caixaEstado || {};
  const r = e.resumo || {};
  if (e.pendencias && e.pendencias.n) { abrirModal('Fechar caixa', htmlContasPorPagar(e.pendencias)); return; }
  abrirModal('Fechar caixa', `
    <p style="margin-bottom:.6rem">Conte o dinheiro que está na gaveta. Esperado: <b>${formatarMoeda(r.dinheiro_esperado || 0)}</b>.</p>
    <div class="campo"><label>Dinheiro contado (Kz)</label><input id="cx-contado" type="number" min="0" data-on-input="actualizarDiferencaCaixa()"></div>
    <p id="cx-dif" class="texto-pequeno" style="margin:-.3rem 0 .6rem" hidden></p>
    <div class="campo" id="cx-just-campo" hidden><label>Justificação da diferença (obrigatória)</label><textarea id="cx-just" rows="2" maxlength="500" placeholder="Ex.: troco dado a mais à mesa 4; nota de 1000 Kz rasgada"></textarea></div>
    <div class="campo"><label>Observações</label><textarea id="cx-obs" rows="2" placeholder="Opcional"></textarea></div>
    <p class="muted texto-pequeno" style="margin-bottom:.8rem">Depois de fechar, só se volta a receber valores abrindo um novo caixa.</p>
    <div style="display:flex;gap:.5rem"><button class="btn-perigo" style="flex:1" data-on-click="fecharCaixa()">Fechar caixa</button>
    <button class="btn-secundario" style="flex:1" data-on-click="fecharModal()">Voltar</button></div>`);
}
/** Diferença entre o contado e o esperado (ao cêntimo); null enquanto não há contagem. */
function diferencaCaixa() {
  const v = document.getElementById('cx-contado').value;
  if (v === '') return null;
  const esperado = Number(((window._caixaEstado || {}).resumo || {}).dinheiro_esperado || 0);
  return Math.round((parseFloat(v) - esperado) * 100) / 100;
}
function actualizarDiferencaCaixa() {
  const d = diferencaCaixa();
  const p = document.getElementById('cx-dif'), campo = document.getElementById('cx-just-campo');
  p.hidden = d === null;
  campo.hidden = d === null || d === 0;
  if (d === null) return;
  p.textContent = d === 0 ? 'Contas certas.' : `${d > 0 ? 'Sobram' : 'Faltam'} ${formatarMoeda(Math.abs(d))}: escreva a justificação para poder fechar.`;
  p.style.color = d === 0 ? 'var(--c-success)' : 'var(--c-danger)';
}
async function fecharCaixa() {
  const contado = document.getElementById('cx-contado').value;
  if (contado === '' || !(parseFloat(contado) >= 0)) { toast('Indique o dinheiro contado (0 ou mais)', 'erro'); return; }
  const d = diferencaCaixa();
  const justificacao = (document.getElementById('cx-just').value || '').trim();
  if (d !== 0 && justificacao.length < 10) {
    actualizarDiferencaCaixa();
    toast('A contagem não bate certo: escreva a justificação da diferença (pelo menos 10 caracteres)', 'erro', 6000);
    return;
  }
  try {
    const corpo = { contado: parseFloat(contado), observacoes: document.getElementById('cx-obs').value };
    if (d !== 0) corpo.justificacao = justificacao;
    const r = await api('POST', '/caixa/fechar', corpo);
    fecharModal();
    const dif = parseFloat(r.sessao.diferenca);
    toast(dif === 0 ? 'Caixa fechado: contas certas' : `Caixa fechado com diferença justificada de ${formatarMoeda(dif)}`, dif === 0 ? 'sucesso' : 'aviso', 7000);
    carregarModulo('caixa');
  } catch (e) {
    // entretanto apareceu uma conta por pagar (outro posto): mostra a lista em vez de um erro solto
    if (e.codigo === 'CONTAS_POR_PAGAR' && e.dados && e.dados.pendencias) { abrirModal('Fechar caixa', htmlContasPorPagar(e.dados.pendencias)); return; }
    toast(e.message, 'erro', 7000);
  }
}

// Cliente saiu sem pagar (decisão do dono, 20/11/2026): só a chefia regista, com motivo; não se desfaz.
function euChefiaCaixa() { return ['ADMIN', 'GERENTE'].includes(((typeof NUK !== 'undefined' && NUK.utilizador) || {}).nivel_acesso); }
function pedirPerdaConta(i) {
  const c = (window._contas || [])[i];
  if (!c) return;
  const total = c.pedidos.reduce((a, p) => a + parseFloat(p.total), 0);
  pedirPerdaPedidos(c.pedidos.map(p => p.id).join(','), c.titulo, String(total));
}
function pedirPerdaPendencia(id) {
  const c = ((window._pendenciasFecho || {}).contas || []).find(x => x.id === id);
  if (!c) return;
  const titulo = c.mesa_numero ? `Mesa ${c.mesa_numero}` : c.quarto_numero ? `Quarto ${c.quarto_numero}` : (c.cliente_nome || 'Balcão');
  pedirPerdaPedidos(c.id, titulo, String(c.total));
}
function pedirPerdaPedidos(ids, titulo, total) {
  modalConfirmar('Cliente saiu sem pagar',
    `A conta <b>${esc(titulo)}</b> (${formatarMoeda(Number(total))}) fica registada como <b>não paga</b>: deixa de contar como por pagar, a mesa ou o quarto ficam livres e o valor aparece nos Relatórios como perda. <b>Não pode ser desfeito</b> e fica registado quem o fez.<br><br>
     <label for="perda-motivo" class="negrito">Motivo (obrigatório)</label><br>
     <input type="text" id="perda-motivo" maxlength="300" placeholder="Ex.: cliente da mesa 4 saiu sem pagar, chamado o segurança" class="campo-motivo">`,
    'registarPerdaConfirmada', ids);
}
async function registarPerdaConfirmada(ids) {
  const motivo = (document.getElementById('perda-motivo').value || '').trim();
  if (motivo.length < 10) { toast('Escreva o motivo (pelo menos 10 caracteres)', 'erro'); return; }
  try {
    const r = await api('POST', '/caixa/perdas', { pedido_ids: String(ids).split(',').filter(Boolean), motivo });
    fecharModal();
    toast(`Conta registada como não paga (${formatarMoeda(r.total)})`, 'aviso', 6000);
    carregarModulo(NUK.moduloActual === 'caixa' ? 'caixa' : 'recebimentos');
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
// Regra do dono: os códigos só são gerados pelo Administrador (lotes em Configurações) ou, com um cartão esgotado,
// aqui mesmo com as credenciais do Administrador ou de quem ele autorizou (caixa-producao.js).
// Cobra-se o valor do cartão, sem desconto (decisão do dono de 20/11/2026).
const VENDA_CARTOES_MAX = 50;
const RE_CODIGO_CARTAO = /^CC[A-Z0-9]{8}$/;
const normCodigoCartao = c => String(c || '').trim().toUpperCase().replace(/[\s-]/g, '');

function htmlBotaoCartao(t) {
  const n = Number(t.por_vender) || 0;
  // Esgotado (21/11/2026, pedido do dono): o botão fica vermelho e, tocado, abre a produção de cartões (caixa-producao.js)
  return `<div class="quarto-card cartao-card ${n ? 'DISPONIVEL' : 'ESGOTADO'}" data-on-click="${n ? 'modalVenderCartoes' : 'modalProduzirCartoes'}(${Number(t.valor)})">
      <div class="card-numero">${formatarMoeda(t.valor)}</div>
      <div class="card-tipo">${esc(t.nome || 'Cartão de consumo')}</div>
      <div class="quarto-estado">${n ? `${n} impresso${n === 1 ? '' : 's'} por vender` : 'Esgotado · toque para imprimir mais'}</div>
    </div>`;
}

async function modulo_cartoes(el) {
  try {
    if (!await caixaAberto(el, '💳 Cartões de consumo')) return;
    const [tipos, lista] = await Promise.all([api('GET', '/caixa/cartoes/tipos'), api('GET', '/caixa/cartoes')]);
    window._tiposCartao = tipos || [];
    el.innerHTML = `<div class="toolbar"><span class="secao-titulo">💳 Cartões de consumo</span></div>
      <p class="muted texto-pequeno" style="margin-bottom:.6rem">Cartão pré-pago para quem não usa telemóvel. Toque no cartão, indique a quantidade e os códigos dos cartões que entrega, e valide. Cobra-se o valor do cartão, sem desconto.</p>
      ${window._tiposCartao.length ? `<div class="grid-cards">${window._tiposCartao.map(htmlBotaoCartao).join('')}</div>`
        : '<div class="muted" style="padding:2rem;text-align:center">Ainda não há cartões. Um Administrador cria-os em <b>⚙️ Configurações → Cartões de consumo</b>.</div>'}
      <div class="card tabela-wrapper mt-2" style="max-width:640px"><table>
        <thead><tr><th>Código</th><th style="text-align:right">Valor inicial</th><th style="text-align:right">Saldo</th><th>Vendido às</th></tr></thead>
        <tbody>${(lista || []).map(c => `<tr><td><b>${esc(c.codigo)}</b></td><td style="text-align:right">${formatarMoeda(c.valor_inicial)}</td><td style="text-align:right">${formatarMoeda(c.saldo)}</td><td>${new Date(c.criado_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted" style="text-align:center;padding:1rem">Ainda não vendeu cartões</td></tr>'}</tbody></table></div>`;
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
