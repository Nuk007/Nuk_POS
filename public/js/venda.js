'use strict';
/**
 * Fluxos de venda do POS: Mesa | Balcão | Remota | Take Away.
 *  - Mesa: grelha de mesas (modulo_mesas) → clique abre o painel de botões de comidas e bebidas.
 *  - Balcão: vai direto ao painel de botões.
 *  - Remota: fila dos pedidos feitos pelos clientes via QR; o caixa valida ou recusa.
 *  - Take Away: escolhe-se um cliente cadastrado que já usou o espaço; só comidas e bebidas.
 * Sem handlers inline (CSP): data-on-click com argumentos literais.
 */
const NAO_TAKEAWAY_UI = /^(SHISHA|OUTRO)$|LOJA|CIGARR|TABAC|SERVIC|QUARTO/; // espelha pedidos.service (o servidor é que decide)
const ROTULO_ORIGEM = { MESA: 'Mesa', BALCAO: 'Balcão', TAKEAWAY: 'Take Away', REMOTA: 'Remota', LAZER: 'Lazer', LOJA: 'Loja', QUARTO: 'Quarto' };
const CATEGORIAS_ORIGEM_UI = { LAZER: ['LAZER'], LOJA: ['LOJA', 'CIGARROS'] }; // espelha pedidos.service (o servidor é que decide)

// ── Painel de botões ────────────────────────────────────────
async function abrirPainelVenda(el, { origem, mesa = null, cliente = null, quarto = null }) {
  el.innerHTML = '<div class="loading-spinner">A carregar...</div>';
  try {
    let produtos = await api('GET', '/produtos?disponivel=true') || [];
    if (origem === 'TAKEAWAY') produtos = produtos.filter(p => !NAO_TAKEAWAY_UI.test(String(p.categoria || '').toUpperCase()));
    if (CATEGORIAS_ORIGEM_UI[origem]) produtos = produtos.filter(p => CATEGORIAS_ORIGEM_UI[origem].includes(String(p.categoria || '').toUpperCase()));
    // Nível de preço em vigor (o servidor volta a decidir ao gravar o pedido) e prato do dia em primeiro lugar
    let nivel = { tabela: null, precos: {} };
    try { nivel = await api('GET', `/precos/actuais?origem=${origem}`) || nivel; } catch { /* sem tabelas: preços base */ }
    const precosNivel = (nivel && nivel.precos) || {};
    const descNivel = nivel && nivel.desconto_pct ? Number(nivel.desconto_pct) : 0;
    produtos = produtos.map(p => (precosNivel[p.id] !== undefined ? { ...p, preco_base: p.preco, preco: precosNivel[p.id] }
      : descNivel ? { ...p, preco_base: p.preco, preco: Math.round(Number(p.preco) * (100 - descNivel)) / 100 } : p))
      .sort((a, b) => (b.prato_do_dia ? 1 : 0) - (a.prato_do_dia ? 1 : 0));
    window._venda = { origem, mesa, cliente, quarto, produtos, categoria: '', carrinho: [], tabela: nivel && nivel.tabela };
    el.innerHTML = htmlPainelVenda();
    vendaRender();
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`;
  }
}

function htmlPainelVenda() {
  const v = window._venda;
  const titulo = v.origem === 'MESA' ? `🪑 Mesa ${esc(v.mesa.numero)}` : v.origem === 'TAKEAWAY' ? `🥡 Take Away · ${esc(v.cliente.nome)}` : v.origem === 'LAZER' ? '🎯 Lazer' : v.origem === 'LOJA' ? '🛍️ Loja' : v.origem === 'QUARTO' ? `🛏️ Consumo · Quarto ${esc(v.quarto.numero)}` : '🧾 Balcão';
  const voltar = v.origem === 'QUARTO' ? '<button class="btn-secundario" data-on-click="vendaVoltar()">← Quartos</button>' : v.origem === 'MESA' ? '<button class="btn-secundario" data-on-click="vendaVoltar()">← Mesas</button>'
    : v.origem === 'TAKEAWAY' ? '<button class="btn-secundario" data-on-click="vendaVoltar()">← Outro cliente</button>' : '';
  const estado = v.origem === 'MESA' ? `<button class="btn-secundario" data-on-click="modalMesa('${esc(v.mesa.id)}','${esc(v.mesa.numero)}','${esc(v.mesa.status)}')">Estado da mesa</button>` : '';
  return `
    <div class="toolbar">
      <span class="secao-titulo">${titulo}${v.tabela ? ` <span class="status-badge status-EM_PREPARO" title="Tabela de preços em vigor">💲 ${esc(v.tabela.nome)}</span>` : ''}</span>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">${voltar}${estado}</div>
    </div>
    <div class="venda-layout">
      <div class="venda-produtos">
        <div id="venda-categorias" class="venda-categorias"></div>
        <div id="venda-grelha" class="venda-grelha"></div>
      </div>
      <div class="venda-carrinho card">
        <div class="card-titulo">PEDIDO</div>
        <div id="venda-itens"></div>
        <div id="venda-total" class="venda-total"></div>
        <div class="campo"><label>Observações</label><textarea id="venda-obs" rows="2" placeholder="Notas especiais..."></textarea></div>
        <button class="btn-primario btn-bloco" data-on-click="vendaConfirmar()">${CATEGORIAS_ORIGEM_UI[v.origem] ? 'Registar venda' : 'Enviar pedido'}</button>
      </div>
    </div>`;
}

function vendaRender() {
  const v = window._venda;
  const cats = [...new Set(v.produtos.map(p => p.categoria))].sort();
  document.getElementById('venda-categorias').innerHTML =
    `<button class="btn-secundario venda-cat ${v.categoria ? '' : 'activa'}" data-on-click="vendaCategoria('')">Tudo</button>` +
    cats.map((c, i) => `<button class="btn-secundario venda-cat ${v.categoria === c ? 'activa' : ''}" data-on-click="vendaCategoria(${i})">${esc(c)}</button>`).join('');
  window._vendaCats = cats;
  const lista = v.produtos.map((p, i) => ({ p, i })).filter(x => !v.categoria || x.p.categoria === v.categoria);
  document.getElementById('venda-grelha').innerHTML = lista.length
    ? lista.map(({ p, i }) => {
        const n = (v.carrinho.find(c => c.produto_id === p.id) || {}).quantidade || 0;
        return `<button class="venda-produto ${n ? 'no-carrinho' : ''}" data-on-click="vendaAdd(${i})"${p.prato_do_dia ? ' style="border-color:var(--c-primary,#E8650A)"' : ''}>
          <span class="venda-produto-nome">${p.prato_do_dia ? '⭐ ' : ''}${esc(p.nome)}${p.prato_do_dia ? '<span class="muted texto-pequeno" style="display:block">Prato do dia</span>' : ''}</span>
          <span class="venda-produto-preco">${p.preco_base !== undefined && Number(p.preco_base) !== Number(p.preco) ? `<s class="muted texto-pequeno">${formatarMoeda(p.preco_base)}</s> ` : ''}${formatarMoeda(p.preco)}</span>
          ${n ? `<span class="venda-produto-qtd">${n}</span>` : ''}
        </button>`;
      }).join('')
    : `<div class="muted">${CATEGORIAS_ORIGEM_UI[v.origem] && !v.produtos.length ? `Ainda não há produtos para ${ROTULO_ORIGEM[v.origem]}. Crie-os em Configurações → Ementa com a categoria ${CATEGORIAS_ORIGEM_UI[v.origem].join(' ou ')}.` : 'Sem produtos nesta categoria.'}</div>`;
  vendaRenderCarrinho();
}

function vendaCategoria(i) {
  window._venda.categoria = i === '' ? '' : window._vendaCats[i];
  vendaRender();
}
function vendaAdd(i) {
  const v = window._venda; const p = v.produtos[i]; if (!p) return;
  const ex = v.carrinho.find(c => c.produto_id === p.id);
  if (ex) ex.quantidade++; else v.carrinho.push({ produto_id: p.id, nome: p.nome, preco: parseFloat(p.preco), quantidade: 1 });
  vendaRender();
}
function vendaMenos(i) { const c = window._venda.carrinho[i]; if (c) { c.quantidade--; if (c.quantidade < 1) window._venda.carrinho.splice(i, 1); vendaRender(); } }
function vendaMais(i) { const c = window._venda.carrinho[i]; if (c) { c.quantidade++; vendaRender(); } }

function vendaRenderCarrinho() {
  const v = window._venda; const itens = document.getElementById('venda-itens'); const tot = document.getElementById('venda-total');
  if (!v.carrinho.length) { itens.innerHTML = '<span class="muted texto-pequeno">Toque nos botões para adicionar</span>'; tot.textContent = ''; return; }
  let total = 0;
  itens.innerHTML = v.carrinho.map((c, i) => {
    total += c.preco * c.quantidade;
    return `<div class="venda-linha"><span class="venda-linha-nome">${esc(c.nome)}</span>
      <button class="btn-secundario venda-qtd" data-on-click="vendaMenos(${i})">−</button><b>${c.quantidade}</b>
      <button class="btn-secundario venda-qtd" data-on-click="vendaMais(${i})">+</button>
      <span class="texto-primario venda-linha-valor">${formatarMoeda(c.preco * c.quantidade)}</span></div>`;
  }).join('');
  tot.textContent = 'Total: ' + formatarMoeda(total);
}

async function vendaConfirmar() {
  const v = window._venda;
  if (!v.carrinho.length) { toast('Adicione itens ao pedido', 'erro'); return; }
  const corpo = {
    origem: v.origem,
    mesa_id: v.mesa ? v.mesa.id : null,
    quarto_id: v.quarto ? v.quarto.id : null,
    cliente_id: v.cliente ? v.cliente.id : null,
    itens: v.carrinho.map(c => ({ produto_id: c.produto_id, quantidade: c.quantidade })),
    observacoes: (document.getElementById('venda-obs').value || '').trim() || null,
  };
  try {
    await api('POST', '/pedidos', corpo);
    toast(CATEGORIAS_ORIGEM_UI[v.origem] ? `Venda registada (${ROTULO_ORIGEM[v.origem]}). Receba-a no Caixa → Receber mesas` : `Pedido enviado (${ROTULO_ORIGEM[v.origem]})`, 'sucesso', CATEGORIAS_ORIGEM_UI[v.origem] ? 6000 : undefined);
    if (v.origem === 'BALCAO' || CATEGORIAS_ORIGEM_UI[v.origem]) { v.carrinho = []; document.getElementById('venda-obs').value = ''; vendaRender(); }
    else carregarModulo(v.origem === 'MESA' ? 'mesas' : v.origem === 'QUARTO' ? 'quartos' : 'takeaway');
  } catch (e) { toast(e.message, 'erro'); }
}
function vendaVoltar() { carregarModulo(window._venda.origem === 'MESA' ? 'mesas' : window._venda.origem === 'QUARTO' ? 'quartos' : 'takeaway'); }
// Consumo no quarto: a conta fica por pagar e o quarto não fica disponível até o Caixa a receber
async function consumoQuarto(id) {
  const q = quartoPorId(id);
  if (!q) return;
  fecharModal();
  await abrirPainelVenda(document.getElementById('main-content'), { origem: 'QUARTO', quarto: { id: q.id, numero: q.numero } });
}

// ── Mesa / Balcão ───────────────────────────────────────────
async function abrirVendaMesa(id) {
  const m = (window._mesasLista || []).find(x => x.id === id); if (!m) return;
  await abrirPainelVenda(document.getElementById('main-content'), { origem: 'MESA', mesa: { id: m.id, numero: m.numero, status: m.status } });
}
async function modulo_balcao(el) { await abrirPainelVenda(el, { origem: 'BALCAO' }); }
async function modulo_lazer(el) { await abrirPainelVenda(el, { origem: 'LAZER' }); }
async function modulo_loja(el) { await abrirPainelVenda(el, { origem: 'LOJA' }); }

// ── Take Away ───────────────────────────────────────────────
async function modulo_takeaway(el) {
  el.innerHTML = `
    <div class="toolbar"><span class="secao-titulo">🥡 Take Away</span></div>
    <div class="card" style="max-width:560px">
      <p class="muted" style="margin-bottom:.75rem">Só para clientes cadastrados que já usaram o espaço, e só comidas e bebidas. Procure o cliente pelo nome ou telefone.</p>
      <div style="display:flex;gap:.5rem"><input id="ta-q" class="campo-input" placeholder="Nome ou telefone" style="flex:1"><button class="btn-primario" data-on-click="takeAwayProcurar()">Procurar</button></div>
      <div id="ta-resultados" style="margin-top:.75rem"></div>
    </div>`;
}
async function takeAwayProcurar() {
  const q = (document.getElementById('ta-q').value || '').trim();
  const box = document.getElementById('ta-resultados');
  if (q.length < 2) { box.innerHTML = '<span class="muted">Escreva pelo menos 2 caracteres.</span>'; return; }
  try {
    const r = await api('GET', `/clientes?q=${encodeURIComponent(q)}&limit=10`);
    const lista = Array.isArray(r) ? r : (r.data || []);
    window._takeAwayClientes = lista;
    box.innerHTML = lista.length ? lista.map((c, i) => `<button class="btn-secundario btn-bloco" style="text-align:left;margin-bottom:.4rem" data-on-click="takeAwayEscolher(${i})">${esc(c.nome)} <span class="muted">${esc(c.telefone || '')}</span></button>`).join('')
      : '<span class="muted">Nenhum cliente cadastrado encontrado.</span>';
  } catch (e) { box.innerHTML = `<span class="erro-msg">${esc(e.message)}</span>`; }
}
async function takeAwayEscolher(i) {
  const c = (window._takeAwayClientes || [])[i]; if (!c) return;
  try {
    const r = await api('GET', `/pedidos/takeaway/elegivel?cliente_id=${c.id}`);
    if (!r.elegivel) { document.getElementById('ta-resultados').innerHTML = `<div class="erro-msg">${esc(c.nome)} ainda não usou o espaço, por isso não pode pedir Take Away.</div>`; return; }
    await abrirPainelVenda(document.getElementById('main-content'), { origem: 'TAKEAWAY', cliente: { id: c.id, nome: c.nome } });
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Remota: fila de validação do caixa ──────────────────────
async function modulo_remota(el) {
  try {
    const lista = await api('GET', '/pedidos/por-validar') || [];
    el.innerHTML = `
      <div class="toolbar"><span class="secao-titulo">📱 Remota</span><span class="muted">Pedidos feitos pelos clientes via QR, à espera de validação</span></div>
      ${lista.length ? lista.map(htmlPedidoRemoto).join('') : '<div class="card muted">Sem pedidos por validar.</div>'}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function htmlPedidoRemoto(p) {
  const quem = p.cliente_nome ? `${esc(p.cliente_nome)} <span class="muted">${esc(p.cliente_telefone || '')}</span>` : '<span class="muted">Cliente não cadastrado</span>';
  const pago = parseFloat(p.nukcoin_pago) > 0 ? `<span class="status-badge status-LIVRE">Pago com Nuk-Coin</span>` : '';
  return `<div class="card mb-2" style="max-width:640px">
    <div class="toolbar" style="margin-bottom:.4rem"><b>${quem}</b>${p.mesa_numero ? `<span>Mesa ${esc(p.mesa_numero)}</span>` : ''}${pago}</div>
    ${(p.itens || []).map(i => `<div class="texto-pequeno">${i.quantidade}× ${esc(i.produto_nome)}</div>`).join('')}
    ${p.observacoes ? `<div class="muted texto-pequeno" style="margin-top:.3rem">Obs.: ${esc(p.observacoes)}</div>` : ''}
    <div style="text-align:right;font-weight:700;margin:.4rem 0">${formatarMoeda(p.total)}</div>
    <div style="display:flex;gap:.5rem">
      <button class="btn-sucesso" style="flex:1" data-on-click="validarPedidoRemoto('${esc(p.id)}')">Validar</button>
      <button class="btn-perigo" style="flex:1" data-on-click="pedirRecusarRemoto('${esc(p.id)}')">Recusar</button>
    </div></div>`;
}
async function validarPedidoRemoto(id) {
  try { await api('PATCH', `/pedidos/${id}/status`, { status: 'EM_PREPARO' }); toast('Pedido validado', 'sucesso'); carregarModulo('remota'); actualizarBadgeRemota(); }
  catch (e) { toast(e.message, 'erro'); }
}
function pedirRecusarRemoto(id) {
  modalConfirmar('Recusar pedido', 'Tem a certeza que quer <b>recusar este pedido</b>? O stock é devolvido e, se foi pago com Nuk-Coin, o valor é estornado.', 'recusarRemotoConfirmado', id);
}
async function recusarRemotoConfirmado(id) {
  fecharModal();
  try { await api('PATCH', `/pedidos/${id}/status`, { status: 'CANCELADO', motivo: 'Pedido remoto recusado pelo caixa' }); toast('Pedido recusado', 'sucesso'); carregarModulo('remota'); actualizarBadgeRemota(); }
  catch (e) { toast(e.message, 'erro'); }
}
async function actualizarBadgeRemota() {
  const b = document.getElementById('badge-remota'); if (!b) return;
  const m = NUK.utilizador && NUK.utilizador.modulos;
  if (Array.isArray(m) && !m.includes('restauracao')) return;
  try {
    const l = await api('GET', '/pedidos/por-validar') || [];
    b.textContent = l.length; b.style.display = l.length ? 'inline-block' : 'none';
  } catch {}
}
