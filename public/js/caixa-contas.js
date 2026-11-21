'use strict';
// Caixa → Contas correntes e Movimentos do caixa (rasto, integridade, CSV).
// Continua caixa.js (dividido a 21/11/2026 para nenhum ficheiro passar das 400 linhas); as funções são globais e partilhadas.

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
