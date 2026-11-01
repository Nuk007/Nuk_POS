'use strict';
// ═══════════════════════════════════════════════
//  PORTAL DO CLIENTE — Nuk_POS
//  Sem modo demo: se o servidor não responder, o cliente é avisado e nada se dá como enviado.
// ═══════════════════════════════════════════════

// ── Configuração ────────────────────────────────
const API_BASE = window.location.origin;
// O estabelecimento vem do QR code: /cliente?r=<slug>. Fica guardado para o resto da visita.
const TENANT_SLUG = (() => {
  const q = new URLSearchParams(location.search);
  let v = (q.get('r') || q.get('slug') || '').toLowerCase().trim();
  try { if (v) sessionStorage.setItem('nuk_slug', v); else v = sessionStorage.getItem('nuk_slug') || ''; } catch (e) {}
  return v;
})();
// QR por mesa: /cliente?r=<slug>&mesa=M03 preenche a mesa no carrinho
const MESA_QR = (new URLSearchParams(location.search).get('mesa') || '').trim().slice(0, 10);

// Categorias do servidor → secções do menu
const SECCOES = {
  comidas:  { grid: 'grid-comidas',  cats: ['CHURRASCO', 'PEIXE', 'PRATO', 'ENTRADA', 'ACOMPANHAMENTO'] },
  bebidas:  { grid: 'grid-bebidas',  cats: ['BEBIDA', 'COCKTAIL'] },
  cigarros: { grid: 'grid-cigarros', cats: ['SHISHA'] },
  outros:   { grid: 'grid-outros',   cats: [] },            // tudo o resto (SOBREMESA, OUTRO, …)
};
const EMOJI_CAT = {
  CHURRASCO: '🍖', PEIXE: '🐟', PRATO: '🍽️', ENTRADA: '🥗', ACOMPANHAMENTO: '🍚',
  BEBIDA: '🥤', COCKTAIL: '🍹', SHISHA: '💨', SOBREMESA: '🍮', OUTRO: '📦',
};
const METODOS = {
  coin:     { api: 'NUKCOIN',       nome: 'Nuk-Coin' },
  cash:     { api: 'CASH',          nome: 'Dinheiro' },
  tpa:      { api: 'TPA',           nome: 'TPA' },
  express:  { api: 'EXPRESS',       nome: 'Express' },
  transfer: { api: 'TRANSFERENCIA', nome: 'Transferência' },
};

// ── Estado da sessão ────────────────────────────
function novaSessao() {
  return {
    nome: '', tel: '', prov: '',
    isCliente: false, clienteId: null, pin: null, stars: 0, wallet: 0,
    cart: {},          // { [produto_id]: { id, nome, preco, qtd } }
    payMethod: null,
    menu: null,        // produtos do servidor (null = ainda não carregado)
    aEnviar: false,    // evita duplo toque (dois pedidos iguais)
  };
}
let session = novaSessao();

// ── Utilidades ──────────────────────────────────
function api(path, opts = {}) {
  const headers = Object.assign({ 'X-Tenant-Slug': TENANT_SLUG }, opts.headers || {});
  return fetch(API_BASE + path, Object.assign({}, opts, { headers }));
}
/** Chamada à API que nunca lança: devolve { ok, status, data, rede } (rede = sem ligação ao servidor). */
async function chamar(path, { method = 'GET', body, headers } = {}) {
  const h = Object.assign({}, headers || {});
  if (body !== undefined) h['Content-Type'] = 'application/json';
  let r;
  try { r = await api(path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { return { ok: false, status: 0, data: {}, rede: true }; }
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data, rede: false };
}
const MSG_REDE = 'Sem ligação ao servidor. Tente novamente.';

function $(id) { return document.getElementById(id); }
function no(tag, cls, texto) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined) e.textContent = texto;
  return e;
}
function go(id) {
  const alvo = $(id); if (!alvo) return;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  alvo.classList.add('active');
  window.scrollTo(0, 0);
}
function fmt(n) { return Number(n || 0).toLocaleString('pt-PT') + ' Kz'; }
function toast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg; t.className = 'show ' + (type || '');
  clearTimeout(t._t); t._t = setTimeout(() => { t.className = ''; }, 3200);
}
function ocupar(botao, ocupado) { if (botao) botao.disabled = !!ocupado; }

if (!TENANT_SLUG) { const a = $('acc-sem-slug'); if (a) a.style.display = 'block'; }

// ── Ecrã 0 — Acesso ─────────────────────────────
async function submitAcesso() {
  if (session.aEnviar) return;
  const nome = $('acc-nome').value.trim();
  const tel = $('acc-tel').value.trim();
  const prov = $('acc-prov').value;
  if (!nome) { toast('Insira o seu nome.', 'err'); return; }
  if (!/^9[0-9]{8}$/.test(tel)) { toast('Telemóvel inválido (9XXXXXXXX).', 'err'); return; }
  if (!prov) { toast('Seleccione a sua província.', 'err'); return; }
  const pin = $('acc-pin').value.trim();
  if (pin && !/^\d{4}$/.test(pin)) { toast('O PIN tem 4 dígitos.', 'err'); return; }

  // Sem PIN → visitante. Com PIN → identifica o cliente registado.
  const novo = novaSessao();
  novo.nome = nome; novo.tel = tel; novo.prov = prov;
  if (pin) {
    session.aEnviar = true;
    let r = await chamar('/api/cliente/login', { method: 'POST', body: { telefone: tel, pin } });
    if (r.status === 403 && r.data.sem_pin) {
      // cliente antigo sem PIN: o PIN escolhido fica definido (só é possível enquanto não existir um)
      const d = await chamar('/api/cliente/definir-pin', { method: 'POST', body: { telefone: tel, pin } });
      if (d.ok) { toast('PIN definido. Guarde-o: é a sua chave.', 'ok'); r = await chamar('/api/cliente/login', { method: 'POST', body: { telefone: tel, pin } }); }
    }
    session.aEnviar = false;
    if (r.rede) { toast(MSG_REDE, 'err'); return; }
    if (r.status === 401) { toast('Telefone ou PIN incorrecto. Ainda não tem conta? Crie uma abaixo.', 'err'); return; }
    if (!r.ok) { toast(r.data.erro || 'Não foi possível entrar. Tente novamente.', 'err'); return; }
    const c = r.data.cliente;
    Object.assign(novo, { isCliente: true, clienteId: c.id, pin, stars: c.estrelas || 0, wallet: parseFloat(c.nukcoin_saldo) || 0, nome: c.nome });
  }
  session = novo;

  $('auth-greeting').textContent = 'Seja bem-vindo' + (session.isCliente ? ', ' + session.nome.split(' ')[0] + '!' : '!');
  $('auth-name-sub').textContent = session.isCliente ? 'Como pretende prosseguir?' : 'Seleccione uma opção abaixo.';
  if (session.isCliente) renderStars(session.stars); else $('stars-bar').style.display = 'none';
  go('s-auth');
}

function renderStars(n) {
  const bar = $('stars-bar');
  bar.style.display = 'flex';
  bar.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('on', i < n));
  $('stars-desc').textContent = n >= 5 ? '🎁 Tem 20% de desconto disponível!' : n + ' / 5 para 20% desconto';
}

function sair() {
  session = novaSessao();
  ['acc-nome', 'acc-tel', 'acc-pin'].forEach(id => { $(id).value = ''; });
  go('s-acesso');
}

// ── Navegação ───────────────────────────────────
function voltarMenu() { if (session.isCliente) loadClienteMenu(); else go('s-convidado'); }
function voltarInicio() { if (session.isCliente) loadClienteMenu(); else go('s-auth'); }

function abrirCliente() {
  if (!session.nome) { toast('Identifique-se primeiro no formulário.', 'err'); go('s-acesso'); return; }
  if (!session.isCliente) { toast('Crie a sua conta para aceder à área de cliente.', 'info'); abrirCadastrar(); return; }
  loadClienteMenu();
}
function abrirCadastrar() {
  if (session.nome && !$('cad-nome').value) $('cad-nome').value = session.nome;
  if (session.tel && !$('cad-tel').value) $('cad-tel').value = session.tel;
  if (session.prov && !$('cad-prov').value) $('cad-prov').value = session.prov;
  go('s-cadastrar');
}
function loadClienteMenu() {
  $('cli-nome-tile').textContent = session.nome || '—';
  $('cli-tel-tile').textContent = '+244 ' + session.tel;
  $('cli-avatar').textContent = (session.nome || '?')[0].toUpperCase();
  $('cli-wallet-pill').textContent = '💜 ' + fmt(session.wallet);
  $('cli-stars-pill').textContent = '⭐ ' + session.stars + '/5';
  go('s-cliente-menu');
}

// ── Nuk-Coin ────────────────────────────────────
function setSaldo(n) {
  const e = $('wlt-saldo');
  e.replaceChildren(document.createTextNode(Number(n || 0).toLocaleString('pt-PT') + ' '), no('span', null, 'Kz'));
}
function loadNukCoin() {
  setSaldo(session.wallet);
  go('s-nukcoin');
  atualizarSaldo();
}
/** Saldo, estrelas e movimentos reais (exige o PIN da sessão). */
async function atualizarSaldo() {
  if (!session.isCliente || !session.pin) return;
  const p = await chamar('/api/cliente/perfil', { method: 'POST', body: { telefone: session.tel, pin: session.pin } });
  if (p.ok) {
    session.wallet = parseFloat(p.data.cliente.nukcoin_saldo) || 0;
    session.stars = p.data.cliente.estrelas || 0;
    setSaldo(session.wallet);
    $('cli-wallet-pill').textContent = '💜 ' + fmt(session.wallet);
    $('cli-stars-pill').textContent = '⭐ ' + session.stars + '/5';
    renderStars(session.stars);
  } else if (p.rede) { toast(MSG_REDE, 'err'); return; }
  const h = await chamar('/api/cliente/nukcoin/historico?cliente_id=' + encodeURIComponent(session.clienteId), { headers: { 'X-Cliente-Pin': session.pin } });
  if (!h.ok) return;
  const nomes = { CARREGAMENTO: 'Carregamento', CONSUMO: 'Consumo', ESTORNO: 'Estorno', BONUS: 'Bónus' };
  const lista = $('wlt-hist');
  lista.replaceChildren();
  const movs = h.data.movimentos || [];
  if (!movs.length) { const v = no('div', 'hist-item'); v.appendChild(no('div', 'hist-date', 'Ainda sem movimentos')); lista.appendChild(v); return; }
  movs.forEach(m => {
    const linha = no('div', 'hist-item');
    const esq = no('div');
    const tit = no('div', null, nomes[m.tipo] || m.tipo); tit.style.fontWeight = '600';
    esq.appendChild(tit);
    esq.appendChild(no('div', 'hist-date', new Date(m.criado_em).toLocaleString('pt-PT')));
    linha.appendChild(esq);
    linha.appendChild(no('div', 'hist-val', (m.tipo === 'CONSUMO' ? '−' : '+') + fmt(parseFloat(m.valor))));
    lista.appendChild(linha);
  });
}

// ── Restaurante ─────────────────────────────────
function gridDe(cat) {
  const c = String(cat || '').toUpperCase();
  const k = Object.keys(SECCOES).find(s => SECCOES[s].cats.includes(c));
  return k ? SECCOES[k].grid : SECCOES.outros.grid;
}
function buildMenu() {
  const grids = Object.values(SECCOES).map(s => s.grid);
  grids.forEach(id => $(id).replaceChildren());
  (session.menu || []).forEach(p => {
    const qtd = (session.cart[p.id] || {}).qtd || 0;
    const d = no('div', 'menu-item' + (qtd > 0 ? ' in-cart' : ''));
    d.dataset.action = 'add-produto'; d.dataset.id = p.id;
    d.appendChild(no('span', 'menu-item-emoji', EMOJI_CAT[String(p.categoria || '').toUpperCase()] || '📦'));
    d.appendChild(no('div', 'menu-item-name', p.nome));
    d.appendChild(no('div', 'menu-item-price', fmt(parseFloat(p.preco))));
    if (qtd > 0) d.appendChild(no('div', 'menu-item-qty', 'No carrinho: ' + qtd));
    $(gridDe(p.categoria)).appendChild(d);
  });
  grids.forEach(id => { const g = $(id); g.parentElement.style.display = g.children.length ? '' : 'none'; });
}
async function loadRestaurante() {
  go('s-restaurante');
  if (!session.menu) {
    const r = await chamar('/api/cliente/cardapio');
    if (r.ok && Array.isArray(r.data.produtos) && r.data.produtos.length) {
      session.menu = r.data.produtos;
      $('menu-erro').style.display = 'none';
    } else {
      Object.values(SECCOES).forEach(s => { const g = $(s.grid); g.replaceChildren(); g.parentElement.style.display = 'none'; });
      $('menu-erro-msg').textContent = r.rede ? MSG_REDE : (r.ok ? 'Ainda não há produtos disponíveis neste estabelecimento.' : (r.data.erro || 'Não foi possível carregar o menu.'));
      $('menu-erro').style.display = 'block';
      return;
    }
  }
  buildMenu(); updateCartBadge();
}
function recarregarMenu() { session.menu = null; loadRestaurante(); }

function itensCarrinho() { return Object.values(session.cart); }
function totalBruto() { return itensCarrinho().reduce((s, i) => s + i.preco * i.qtd, 0); }
function updateCartBadge() {
  const n = itensCarrinho().reduce((s, i) => s + i.qtd, 0);
  ['cart-badge', 'cart-badge-btn', 'cart-count'].forEach(id => { $(id).textContent = n; });
}
function addProduto(id) {
  const p = (session.menu || []).find(x => x.id === id); if (!p) return;
  const it = session.cart[id] || (session.cart[id] = { id: p.id, nome: p.nome, preco: parseFloat(p.preco), qtd: 0 });
  if (it.qtd >= 100) { toast('Máximo de 100 unidades por produto.', 'err'); return; }
  it.qtd++;
  updateCartBadge(); buildMenu();
  toast('➕ ' + p.nome + ' adicionado', 'info');
}
function alterarQtd(id, delta) {
  const it = session.cart[id]; if (!it) return;
  it.qtd = Math.min(100, it.qtd + delta);
  if (it.qtd <= 0) delete session.cart[id];
  updateCartBadge(); buildMenu(); verCarrinho();
}

// ── Carrinho ────────────────────────────────────
function verCarrinho() {
  const ul = $('cart-list');
  ul.replaceChildren();
  const itens = itensCarrinho();
  if (!itens.length) {
    const li = no('li', null, 'Carrinho vazio');
    li.style.cssText = 'color:var(--muted);font-size:.82rem;padding:12px 0;text-align:center';
    ul.appendChild(li);
  }
  itens.forEach(i => {
    const li = no('li', 'cart-item');
    const qtd = no('span', 'cart-item-qty');
    const menos = no('button', 'qty-btn', '−'); menos.dataset.action = 'qtd'; menos.dataset.id = i.id; menos.dataset.delta = '-1';
    const mais = no('button', 'qty-btn', '+'); mais.dataset.action = 'qtd'; mais.dataset.id = i.id; mais.dataset.delta = '1';
    qtd.append(menos, no('span', null, String(i.qtd)), mais);
    li.append(no('span', 'cart-item-name', i.nome), qtd, no('span', 'cart-item-price', fmt(i.preco * i.qtd)));
    ul.appendChild(li);
  });
  // Estimativa: quem decide o desconto final é o servidor
  const bruto = totalBruto();
  const comEstrelas = session.isCliente && session.stars >= 5 && bruto <= 25000;
  $('disc-info').style.display = comEstrelas ? 'block' : 'none';
  $('cart-total').textContent = fmt(comEstrelas ? Math.round(bruto * 0.8 * 100) / 100 : bruto);
  // Convidado não tem carteira
  $('pay-coin').style.display = session.isCliente ? '' : 'none';
  if (!session.isCliente && session.payMethod === 'coin') limparPagamento();
  $('pay-coin-sub').textContent = 'Saldo: ' + fmt(session.wallet);
  $('coin-pay-info').style.display = session.payMethod === 'coin' ? 'block' : 'none';
  if (!$('cart-mesa').value && MESA_QR) $('cart-mesa').value = MESA_QR;
  go('s-carrinho');
}
function limparPagamento() {
  session.payMethod = null;
  document.querySelectorAll('.pay-opt').forEach(o => o.classList.remove('selected'));
  $('coin-pay-info').style.display = 'none';
}
function selectPay(el, method) {
  if (method === 'coin' && !session.isCliente) { toast('O Nuk-Coin é só para clientes registados.', 'err'); return; }
  session.payMethod = method;
  document.querySelectorAll('.pay-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  $('coin-pay-info').style.display = method === 'coin' ? 'block' : 'none';
}

async function confirmarPedido() {
  if (session.aEnviar) return;
  const itens = itensCarrinho();
  if (!itens.length) { toast('Adicione produtos ao carrinho.', 'err'); return; }
  if (!session.payMethod) { toast('Seleccione a forma de pagamento.', 'err'); return; }
  const metodo = METODOS[session.payMethod];
  const body = { itens: itens.map(i => ({ produto_id: i.id, quantidade: i.qtd })), metodo_pagamento: metodo.api };
  if (session.isCliente) { body.cliente_id = session.clienteId; body.pin = session.pin; }
  const mesa = $('cart-mesa').value.trim();
  if (mesa) body.mesa_ref = mesa;

  const botao = document.querySelector('[data-action="confirmar-pedido"]');
  session.aEnviar = true; ocupar(botao, true);
  const r = await chamar('/api/cliente/pedido-restaurante', { method: 'POST', body });
  session.aEnviar = false; ocupar(botao, false);
  if (!r.ok) {
    // O pedido NÃO foi enviado: o carrinho fica intacto para tentar de novo
    toast(r.rede ? 'Sem ligação ao servidor. O pedido NÃO foi enviado — tente novamente.' : (r.data.erro || 'Não foi possível enviar o pedido.'), 'err');
    return;
  }
  const d = r.data;
  session.cart = {}; limparPagamento(); updateCartBadge(); buildMenu();
  if (session.isCliente) {
    if (d.nukcoin_saldo_novo != null) session.wallet = parseFloat(d.nukcoin_saldo_novo);
    atualizarSaldo(); // sincroniza estrelas e saldo reais
    $('cli-wallet-pill').textContent = '💜 ' + fmt(session.wallet);
  }
  $('pedido-ok-msg').textContent = 'Pedido ' + d.codigo + ' enviado. Pagamento: ' + metodo.nome + ' — ' + fmt(parseFloat(d.total_final));
  $('star-earned').style.display = d.estrela_ganha ? 'block' : 'none';
  const desc = parseFloat(d.desconto) || 0;
  $('disc-earned').style.display = desc > 0 ? 'block' : 'none';
  if (desc > 0) $('disc-earned').textContent = '🎁 Desconto de ' + fmt(desc) + ' aplicado neste pedido!';
  go('s-pedido-ok');
}

// ── Serviços e Eventos ──────────────────────────
/** Envia a solicitação ao POS. Devolve true só se o servidor a registou. */
async function enviarSolicitacao(tipo, nomeServico) {
  if (session.aEnviar) return false;
  if (!session.nome || !session.tel) { toast('Identifique-se primeiro.', 'err'); go('s-acesso'); return false; }
  session.aEnviar = true;
  const r = await chamar('/api/cliente/solicitacao', { method: 'POST', body: { tipo, nome_servico: nomeServico, nome: session.nome, telefone: session.tel } });
  session.aEnviar = false;
  if (!r.ok) { toast(r.rede ? 'Sem ligação ao servidor. O pedido NÃO foi enviado — tente novamente.' : (r.data.erro || 'Não foi possível enviar o pedido.'), 'err'); return false; }
  return true;
}
function mostrarConfirmacao(emoji, titulo, msg) {
  $('sol-emoji').textContent = emoji;
  $('sol-titulo').textContent = titulo;
  $('sol-msg').textContent = msg;
  go('s-solicitacao-ok');
}
async function solicitarServico(nome, preco, categoria) {
  const tipo = categoria === 'HOSPEDAGEM' ? 'HOSPEDAGEM' : 'SERVICO';
  if (!(await enviarSolicitacao(tipo, nome))) return;
  mostrarConfirmacao('🛎️', 'Pedido enviado!', nome + (preco ? ' (' + preco + ')' : '') + ' — a nossa equipa entrará em contacto para confirmar.');
}
async function solicitarEvento(nome) {
  if (!(await enviarSolicitacao('EVENTO', nome))) return;
  mostrarConfirmacao('🎉', 'Evento solicitado!', nome + ' — receberá um orçamento personalizado em breve. Obrigado!');
}

// ── Cadastro ────────────────────────────────────
async function cadastrar() {
  if (session.aEnviar) return;
  const nome = $('cad-nome').value.trim();
  const tel = $('cad-tel').value.trim();
  const prov = $('cad-prov').value;
  const ref = $('cad-ref').value.trim();
  const pin = $('cad-pin').value.trim();
  if (!nome) { toast('Insira o nome.', 'err'); return; }
  if (!/^9[0-9]{8}$/.test(tel)) { toast('Telemóvel inválido (9XXXXXXXX).', 'err'); return; }
  if (!prov) { toast('Seleccione a província.', 'err'); return; }
  if (!/^\d{4}$/.test(pin)) { toast('Escolha um PIN de 4 dígitos.', 'err'); return; }

  session.aEnviar = true;
  const r = await chamar('/api/cliente/cadastrar', { method: 'POST', body: { nome, telefone: tel, provincia: prov, pin, referido_por_tel: ref || null } });
  session.aEnviar = false;
  if (!r.ok) { toast(r.rede ? MSG_REDE : (r.data.erro || 'Erro no cadastro.'), 'err'); return; }

  const c = r.data.cliente;
  session = Object.assign(novaSessao(), {
    nome: c.nome, tel: c.telefone, prov: c.provincia || prov,
    isCliente: true, clienteId: c.id, pin, stars: c.estrelas || 0, wallet: parseFloat(c.nukcoin_saldo) || 0,
  });
  $('cad-pin').value = '';
  if (r.data.referral_bonus) toast('⭐ O seu amigo (+244 ' + ref + ') ganhou uma estrela!', 'info');
  renderStars(session.stars);
  mostrarConfirmacao('🎉', 'Cadastro concluído!', 'Bem-vindo, ' + session.nome.split(' ')[0] + '! Recebeu ' + (c.pontos || 0) + ' pontos de boas-vindas. Pode agora aceder a todos os serviços.');
}

// ── Delegação de eventos (a CSP bloqueia onclick= inline) ──
const ACOES = {
  'go':                   el => go(el.dataset.screen),
  'submit-acesso':        () => submitAcesso(),
  'sair':                 () => sair(),
  'abrir-cliente':        () => abrirCliente(),
  'abrir-cadastrar':      () => abrirCadastrar(),
  'abrir-nukcoin':        () => loadNukCoin(),
  'abrir-restaurante':    () => loadRestaurante(),
  'recarregar-menu':      () => recarregarMenu(),
  'atualizar-saldo':      () => atualizarSaldo(),
  'add-produto':          el => addProduto(el.dataset.id),
  'ver-carrinho':         () => verCarrinho(),
  'qtd':                  el => alterarQtd(el.dataset.id, parseInt(el.dataset.delta, 10)),
  'select-pay':           el => selectPay(el, el.dataset.method),
  'confirmar-pedido':     () => confirmarPedido(),
  'voltar-inicio':        () => voltarInicio(),
  'voltar-de-restaurante': () => voltarMenu(),
  'voltar-de-servicos':   () => voltarMenu(),
  'voltar-de-eventos':    () => voltarMenu(),
  'solicitar-servico':    el => solicitarServico(el.dataset.tipo, el.dataset.preco, el.dataset.categoria),
  'solicitar-evento':     el => solicitarEvento(el.dataset.tipo),
  'cadastrar':            () => cadastrar(),
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACOES[el.dataset.action];
  if (fn) fn(el);
});
