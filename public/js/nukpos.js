// Nuk_POS — Core JS (auth, API, WebSocket, utilitários)
// Arquitectura igual ao ATC46/AviationMoney

'use strict';

// ── Estado global ─────────────────────────────────────────────
const NUK = {
  token: localStorage.getItem('nukpos_token') || null,
  utilizador: JSON.parse(localStorage.getItem('nukpos_user') || 'null'),
  socket: null,
  moduloActual: null,
};

// ── API helper ────────────────────────────────────────────────
async function api(metodo, path, dados) {
  const opts = {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
  };
  if (NUK.token) opts.headers['Authorization'] = `Bearer ${NUK.token}`;
  if (dados && metodo !== 'GET') opts.body = JSON.stringify(dados);

  const r = await fetch(`/api${path}`, opts);
  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    if (r.status === 401) { logout(); return; }
    throw new Error(json.erro || `Erro ${r.status}`);
  }
  return json;
}

// ── Auth ──────────────────────────────────────────────────────
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-senha').value;
  const btnEntrar = document.getElementById('btn-entrar');
  const erroEl = document.getElementById('login-erro');

  erroEl.style.display = 'none';
  btnEntrar.disabled = true;
  btnEntrar.textContent = 'A entrar...';

  try {
    const res = await api('POST', '/auth/login', { email, password });
    NUK.token = res.token;
    NUK.utilizador = res.utilizador;
    localStorage.setItem('nukpos_token', res.token);
    localStorage.setItem('nukpos_user', JSON.stringify(res.utilizador));
    iniciarApp();
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.style.display = 'block';
    btnEntrar.disabled = false;
    btnEntrar.textContent = 'Entrar';
  }
});

function logout() {
  NUK.token = null;
  NUK.utilizador = null;
  localStorage.removeItem('nukpos_token');
  localStorage.removeItem('nukpos_user');
  if (NUK.socket) NUK.socket.disconnect();
  document.getElementById('app').style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
}

// ── Arranque da app ───────────────────────────────────────────
function iniciarApp() {
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Info do utilizador na sidebar
  document.getElementById('sidebar-nome').textContent = NUK.utilizador.nome;
  document.getElementById('sidebar-cargo').textContent = NUK.utilizador.cargo || NUK.utilizador.nivel_acesso;
  document.getElementById('sidebar-avatar').textContent = NUK.utilizador.nome.charAt(0).toUpperCase();

  // Itens de admin
  const isAdmin = ['ADMIN', 'GERENTE'].includes(NUK.utilizador.nivel_acesso);
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? 'flex' : 'none';
  });

  // WebSocket
  iniciarWebSocket();

  // Relógio
  setInterval(actualizarHora, 1000);
  actualizarHora();

  // Módulo inicial
  carregarModulo('dashboard');
}

// ── WebSocket ─────────────────────────────────────────────────
function iniciarWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  NUK.socket = io(location.origin, {
    auth: { token: NUK.token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    maxReconnectionAttempts: 10,
  });

  NUK.socket.on('connect', () => {
    setWsBadge(true);
    NUK.socket.emit('join_room', 'staff');
  });

  NUK.socket.on('disconnect', () => setWsBadge(false));
  NUK.socket.on('connect_error', () => setWsBadge(false));

  // Eventos do servidor
  NUK.socket.on('novo_pedido', (pedido) => {
    toast(`🆕 Novo pedido — Mesa ${pedido.mesa_numero || '?'} — ${formatarMoeda(pedido.total)}`, 'aviso');
    actualizarBadgePedidos();
    if (NUK.moduloActual === 'pedidos' || NUK.moduloActual === 'dashboard') carregarModulo(NUK.moduloActual);
  });

  NUK.socket.on('pedido_atualizado', () => {
    if (NUK.moduloActual === 'pedidos') carregarModulo('pedidos');
  });

  NUK.socket.on('mesa_atualizada', () => {
    if (NUK.moduloActual === 'mesas') carregarModulo('mesas');
  });

  NUK.socket.on('quarto_atualizado', () => {
    if (NUK.moduloActual === 'quartos') carregarModulo('quartos');
  });

  NUK.socket.on('alerta_stock', (dados) => {
    toast(`⚠️ Stock baixo: ${dados.item.nome}`, 'aviso');
    document.getElementById('badge-stock').style.display = 'inline-block';
  });

  NUK.socket.on('chamada_staff', (dados) => {
    toast(`🔔 Chamada da Mesa ${dados.mesa_id} — ${dados.motivo || 'Atenção pedida'}`, 'aviso');
  });
}

function setWsBadge(conectado) {
  const el = document.getElementById('ws-status');
  el.className = 'ws-badge ' + (conectado ? 'ws-conectado' : 'ws-desconectado');
  el.title = conectado ? 'Ligado em tempo real' : 'Sem ligação em tempo real';
}

// ── Navegação ─────────────────────────────────────────────────
function carregarModulo(modulo) {
  NUK.moduloActual = modulo;

  // Actualizar nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.modulo === modulo);
  });

  // Fechar sidebar mobile
  if (window.innerWidth <= 768) fecharSidebar();

  const titulos = {
    dashboard: '📊 Dashboard', pedidos: '🍽️ Pedidos', mesas: '🪑 Mesas',
    quartos: '🛏️ Quartos', produtos: '📋 Produtos', stock: '📦 Stock',
    financeiro: '💰 Financeiro', clientes: '👥 Clientes',
    funcionarios: '👨‍💼 Funcionários', configuracoes: '⚙️ Configurações',
  };
  document.getElementById('topbar-titulo').textContent = titulos[modulo] || modulo;

  const el = document.getElementById('main-content');
  el.innerHTML = '<div class="loading-spinner">A carregar...</div>';

  const fn = window['modulo_' + modulo];
  if (fn) fn(el);
  else el.innerHTML = `<div style="padding:2rem;color:var(--c-muted)">Módulo "${modulo}" em construção.</div>`;
}

async function actualizarBadgePedidos() {
  try {
    const pedidos = await api('GET', '/pedidos?status=ABERTO') || [];
    const badge = document.getElementById('badge-pedidos');
    badge.textContent = pedidos.length;
    badge.style.display = pedidos.length > 0 ? 'inline-block' : 'none';
  } catch {}
}

// ── Modal ─────────────────────────────────────────────────────
function abrirModal(titulo, htmlCorpo) {
  document.getElementById('modal-titulo').textContent = titulo;
  document.getElementById('modal-corpo').innerHTML = htmlCorpo;
  document.getElementById('modal-overlay').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, tipo = 'sucesso', duracao = 4000) {
  const div = document.createElement('div');
  div.className = `toast ${tipo}`;
  div.textContent = msg;
  document.getElementById('toast-container').appendChild(div);
  setTimeout(() => div.remove(), duracao);
}

// ── Sidebar mobile ────────────────────────────────────────────
function toggleSidebar() {
  const s = document.getElementById('sidebar');
  const o = document.getElementById('sidebar-overlay');
  s.classList.toggle('aberta');
  o.classList.toggle('visivel');
}
function fecharSidebar() {
  document.getElementById('sidebar').classList.remove('aberta');
  document.getElementById('sidebar-overlay').classList.remove('visivel');
}

// ── Relógio ───────────────────────────────────────────────────
function actualizarHora() {
  const agora = new Date();
  document.getElementById('hora-atual').textContent = agora.toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Luanda' });
}

// ── Formatadores ──────────────────────────────────────────────
function formatarMoeda(val) {
  const n = parseFloat(val) || 0;
  return n.toLocaleString('pt-AO') + ' Kz';
}

function formatarData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-AO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' });
}

function tempoDesde(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso)) / 60000;
  if (diff < 1) return 'Agora';
  if (diff < 60) return `${Math.floor(diff)}min`;
  return `${Math.floor(diff / 60)}h ${Math.floor(diff % 60)}min`;
}

function badgeStatus(status) {
  return `<span class="status-badge status-${status}">${status.replace(/_/g,' ')}</span>`;
}

// ── Inicialização ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (NUK.token && NUK.utilizador) {
    iniciarApp();
  }
});
