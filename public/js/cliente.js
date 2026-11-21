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
  comidas:  { grid: 'grid-comidas',  cats: ['CHURRASCO', 'PEIXE', 'PRATO', 'MENU', 'ENTRADA', 'ACOMPANHAMENTO'] },
  bebidas:  { grid: 'grid-bebidas',  cats: ['BEBIDA', 'COCKTAIL'] },
  cigarros: { grid: 'grid-cigarros', cats: ['SHISHA', 'CIGARROS'] },
  loja:     { grid: 'grid-loja',     cats: ['LOJA'] },
  quartos:  { grid: 'grid-quartos',  cats: ['SERVICO_QUARTO'] },
  outros:   { grid: 'grid-outros',   cats: [] },            // tudo o resto (SOBREMESA, OUTRO, …)
};
const EMOJI_CAT = {
  CHURRASCO: '🍖', PEIXE: '🐟', PRATO: '🍽️', MENU: '🍱', ENTRADA: '🥗', ACOMPANHAMENTO: '🍚',
  BEBIDA: '🥤', COCKTAIL: '🍹', SHISHA: '💨', CIGARROS: '🚬', LOJA: '🛍️', LAZER: '🎯', PISCINA: '🏊', SERVICO_QUARTO: '🛎️', SOBREMESA: '🍮', OUTRO: '📦',
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
  if (id === 's-servicos') carregarHospedagem();
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
