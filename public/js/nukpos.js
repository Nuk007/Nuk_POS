// Nuk_POS — Core JS (auth, API, WebSocket, utilitários)
// Arquitectura igual ao ATC46/AviationMoney

'use strict';

// ── Estado global ─────────────────────────────────────────────
const NUK = {
  token: localStorage.getItem('nukpos_token') || null,
  utilizador: (() => { try { return JSON.parse(localStorage.getItem('nukpos_user')); } catch(e) { localStorage.removeItem('nukpos_user'); return null; } })(),
  socket: null,
  moduloActual: null,
};

// ── API helper ────────────────────────────────────────────────
// Descarrega um PDF gerado pela API (talão, factura). Usa o token do operador; sem janelas/handlers inline (CSP).
async function descarregarPdf(caminho, nomeFicheiro) {
  try {
    const r = await fetch(`/api${caminho}`, { headers: { Authorization: `Bearer ${NUK.token}` } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || `Erro ${r.status}`); }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url; a.download = nomeFicheiro || 'documento.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) { toast(e.message, 'erro'); }
}

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
    // Só faz logout em 401 se já estiver autenticado (não durante o próprio login)
    if (r.status === 401 && NUK.token && path !== '/auth/login') { logout(); return; }
    // Contrato de Adesão por assinar (13/11/2026): mostra o ecrã de assinatura em vez de um erro solto.
    if (r.status === 428 && json.codigo === 'ADESAO_PENDENTE' && typeof mostrarAdesao === 'function') { mostrarAdesao(); }
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
    NUK.utilizador = res.funcionario; // contrato da API: { token, funcionario }
    localStorage.setItem('nukpos_token', res.token);
    localStorage.setItem('nukpos_user', JSON.stringify(res.funcionario)); // (antes guardava res.utilizador = undefined e a sessão perdia-se ao recarregar)
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
  document.getElementById('tela-adesao').style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
}

// ── Arranque da app ───────────────────────────────────────────
// Primeiro confirma o Contrato de Adesão (13/11/2026): por assinar, abre o ecrã de assinatura e só depois
// de assinado arranca a operação.
async function iniciarApp() {
  document.getElementById('tela-login').style.display = 'none';
  if (typeof verificarAdesao === 'function' && await verificarAdesao()) return;
  arrancarOperacao();
}

function arrancarOperacao() {
  document.getElementById('tela-adesao').style.display = 'none';
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

  aplicarAcessos();
  if (typeof actualizarPonto === 'function') actualizarPonto();
  if (typeof impArrancar === 'function') impArrancar();

  // WebSocket
  iniciarWebSocket();
  actualizarBadgeSolicitacoes();
  actualizarBadgeRemota();

  // Relógio
  setInterval(actualizarHora, 1000);
  actualizarHora();

  // Módulo inicial
  carregarModulo(moduloPermitido('dashboard'));
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

  // Pedido feito pelo cliente no portal (QR code)
  NUK.socket.on('novo_pedido_cliente', (p) => {
    toast(`🆕 Pedido remoto por validar ${p.codigo || ''} — ${formatarMoeda(p.total)}`, 'aviso', 8000);
    actualizarBadgePedidos();
    actualizarBadgeRemota();
    if (['pedidos', 'dashboard', 'financeiro', 'remota'].includes(NUK.moduloActual)) carregarModulo(NUK.moduloActual);
  });

  // Serviço, hospedagem ou evento pedido no portal: avisa a equipa e actualiza a caixa de entrada
  NUK.socket.on('nova_solicitacao_portal', (s) => {
    const rotulo = { HOSPEDAGEM: 'Hospedagem', SERVICO: 'Serviço', EVENTO: 'Evento' }[s.tipo] || 'Solicitação';
    toast(`🔔 ${rotulo}: ${s.nome_servico} — ${s.nome_contacto} (${s.telefone_contacto})`, 'aviso', 8000);
    actualizarBadgeSolicitacoes();
    if (NUK.moduloActual === 'solicitacoes') carregarModulo('solicitacoes');
  });

  // Clientes novos e saldos Nuk-Coin alterados refrescam a lista de clientes
  ['cliente_novo', 'nukcoin_carregado'].forEach(ev => NUK.socket.on(ev, () => {
    if (NUK.moduloActual === 'clientes') carregarModulo('clientes');
  }));

  NUK.socket.on('pedido_atualizado', () => {
    actualizarBadgeRemota();
    if (NUK.moduloActual === 'pedidos') carregarModulo('pedidos');
  });

  // Ecrã de cozinha e bar: refaz-se com qualquer mudança; a sala recebe o aviso «pronto»
  ['cozinha_atualizada', 'novo_pedido', 'pedido_atualizado'].forEach(ev => NUK.socket.on(ev, () => {
    if (NUK.moduloActual === 'cozinha' && typeof recarregarCozinha === 'function') recarregarCozinha();
  }));
  // Impressora de cozinha/bar deste dispositivo: pedido novo ou remoto validado → talão
  ['novo_pedido', 'pedido_atualizado'].forEach(ev => NUK.socket.on(ev, () => {
    if (typeof impVerificarPreparacao === 'function') impVerificarPreparacao();
  }));
  NUK.socket.on('pedido_pronto', (d) => {
    if (NUK.moduloActual === 'cozinha') return;
    const onde = d.mesa ? `Mesa ${d.mesa}` : d.quarto ? `Quarto ${d.quarto}` : ({ BALCAO: 'Balcão', TAKEAWAY: 'Take Away', REMOTA: 'Pedido remoto' }[d.origem] || 'Pedido');
    toast(`🔔 ${d.posto === 'BAR' ? 'Bebidas prontas' : 'Comida pronta'} — ${onde}`, 'sucesso', 8000);
  });

  NUK.socket.on('mesa_atualizada', () => {
    // não se refaz o ecrã enquanto está aberto o painel de venda da mesa (perdia-se o pedido a meio)
    if (NUK.moduloActual === 'mesas' && !document.getElementById('venda-grelha')) carregarModulo('mesas');
  });

  NUK.socket.on('quarto_atualizado', () => {
    if (NUK.moduloActual === 'quartos') carregarModulo('quartos');
  });

  // A hora «livre às», a ★ vermelha e o prazo de arrumação mudam com o tempo: refresca a cada minuto (sem interromper um modal aberto)
  if (!NUK._timerQuartos) {
    NUK._timerQuartos = setInterval(() => {
      const ov = document.getElementById('modal-overlay');
      if (NUK.moduloActual === 'quartos' && !(ov && ov.style.display === 'flex')) carregarModulo('quartos');
    }, 60000);
  }

  // Arrumação: só os funcionários com o perfil «arrumar quartos» são avisados; passado o prazo, só a chefia
  NUK.socket.on('quarto_arrumar', (d) => {
    if (!NUK.utilizador || !NUK.utilizador.arruma_quartos) return;
    const hora = new Date(d.prazo_em).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    toast(`🧹 Quarto ${d.numero}: arrumar até às ${hora}`, 'aviso', 10000);
    if (NUK.moduloActual === 'quartos') carregarModulo('quartos');
  });
  NUK.socket.on('quarto_escalado', (d) => {
    if (!NUK.utilizador || !['ADMIN', 'GERENTE'].includes(NUK.utilizador.nivel_acesso)) return;
    toast(`⚠️ Quarto ${d.numero}: o prazo de arrumação terminou — só a chefia o pode abrir`, 'erro', 12000);
    if (NUK.moduloActual === 'quartos') carregarModulo('quartos');
  });

  NUK.socket.on('alerta_stock', (dados) => {
    toast(`⚠️ Stock baixo: ${dados.item.nome}`, 'aviso');
    document.getElementById('badge-stock').style.display = 'inline-block';
  });

  NUK.socket.on('servicos_atualizados', (d) => {
    if (d && ['ALTA', 'URGENTE'].includes(d.prioridade)) toast(`🛠️ Nova ${d.prioridade === 'URGENTE' ? 'ocorrência urgente' : 'ocorrência de prioridade alta'} em Serviços`, 'aviso', 8000);
    if (['servicos', 'manutencao'].includes(NUK.moduloActual)) carregarModulo(NUK.moduloActual);
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
    dashboard: '📊 Dashboard', pedidos: '🍽️ Pedidos', mesas: '🪑 Mesa', balcao: '🧾 Balcão', remota: '📱 Remota', takeaway: '🥡 Take Away', cozinha: '👨‍🍳 Cozinha e bar',
    quartos: '🛏️ Quartos', caixa: '💵 Caixa do dia', nukcoin: '💜 Nuk-Coin', cartoes: '💳 Cartões de consumo', recebimentos: '🧾 Receber mesas', contas: '📒 Contas correntes', compras: '🛒 Compras pontuais', servicos: '🛠️ Avarias e danos', lazer: '🎯 Lazer', loja: '🛍️ Loja', patrimonio: '🏛️ Património', manutencao: '🗓️ Prazos de manutenção', solicitacoes: '🔔 Solicitações', produtos: '📋 Produtos', stock: '📦 Stock',
    financeiro: '💰 Financeiro', relatorios: '📈 Relatórios', clientes: '👥 Clientes',
    funcionarios: '👨‍💼 Funcionários', assiduidade: '🕒 Assiduidade', configuracoes: '⚙️ Configurações',
  };
  document.getElementById('topbar-titulo').textContent = titulos[modulo] || modulo;

  const el = document.getElementById('main-content');
  el.innerHTML = '<div class="loading-spinner">A carregar...</div>';

  const fn = window['modulo_' + modulo];
  if (fn) {
    Promise.resolve().then(() => fn(el)).catch(err => {
      el.innerHTML = `<div class="erro-msg" style="margin:2rem">Erro ao carregar módulo: ${err.message}</div>`;
    });
  } else {
    el.innerHTML = `<div style="padding:2rem;color:var(--c-muted)">Módulo "${modulo}" em construção.</div>`;
  }
}

async function actualizarBadgePedidos() {
  const m = NUK.utilizador && NUK.utilizador.modulos;
  if (Array.isArray(m) && !m.includes('restauracao')) return;
  try {
    const _resp = await api('GET', '/pedidos?status=ABERTO') || [];
    const pedidos = Array.isArray(_resp) ? _resp : (_resp.data || []);
    const badge = document.getElementById('badge-pedidos');
    badge.textContent = pedidos.length;
    badge.style.display = pedidos.length > 0 ? 'inline-block' : 'none';
  } catch {}
}

async function actualizarBadgeSolicitacoes() {
  try {
    const r = await api('GET', '/solicitacoes-portal/pendentes');
    const badge = document.getElementById('badge-solicitacoes');
    badge.textContent = r.pendentes;
    badge.style.display = r.pendentes > 0 ? 'inline-block' : 'none';
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

// Escapa texto vindo de utilizadores (nomes, observações…) antes de o inserir em HTML
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

// ── Acessos delegados: esconde os módulos a que a conta não tem acesso (o servidor também os recusa) ──
function moduloPermitido(m) {
  const p = NUK.utilizador && NUK.utilizador.permissoes;
  if (!Array.isArray(p) || p.includes(m)) return m;
  const primeiro = [...document.querySelectorAll('.nav-item[data-modulo]')].map(e => e.dataset.modulo).find(x => p.includes(x));
  return primeiro || m;
}
function esconderGruposVazios() {
  // esconde subgrupos e categorias que ficaram sem itens (módulo não contratado ou sem acesso)
  const vazio = el => ![...el.querySelectorAll('.nav-item')].some(i => i.style.display !== 'none');
  document.querySelectorAll('.nav-sub').forEach(g => { g.style.display = vazio(g) ? 'none' : ''; });
  document.querySelectorAll('.nav-grupo').forEach(g => { g.style.display = vazio(g) ? 'none' : ''; });
}
function aplicarAcessos() {
  const p = NUK.utilizador && NUK.utilizador.permissoes;
  if (Array.isArray(p)) {
    document.querySelectorAll('.nav-item[data-modulo]').forEach(el => {
      if (!p.includes(el.dataset.modulo)) el.style.display = 'none';
    });
  }
  esconderGruposVazios();
}

// ── Splash de arranque ───────────────────────────────────────
// Puramente decorativo: nunca atrasa nem bloqueia o login/app por baixo, só desaparece sozinho.
window.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('tela-splash');
  if (splash) setTimeout(() => splash.classList.add('a-esconder'), 900);
});

// ── Inicialização ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (NUK.token && NUK.utilizador) {
    iniciarApp();
    // renova os dados do utilizador (perfis de quartos, titular) sem bloquear o arranque
    api('GET', '/auth/me').then(p => {
      const novo = p && (p.funcionario || p);
      if (novo && novo.id) {
        NUK.utilizador = { ...NUK.utilizador, ...novo };
        aplicarAcessos();
        try { localStorage.setItem('nukpos_user', JSON.stringify(NUK.utilizador)); } catch (e) { /* ignorar */ }
      }
    }).catch(() => {});
  }
});

// ── Event delegation — substitui onclick= inline (bloqueados pela CSP) ────────
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  // Sidebar
  if (action === 'toggle-sidebar') { e.stopPropagation(); toggleSidebar(); }
  // Logout
  else if (action === 'logout') logout();
  // Modal fechar (click no fundo ou no botão X) — só fechar se não for o modal-box em si
  else if (action === 'fechar-modal') {
    // fecha só se o clique for no próprio fundo ou no botão X (não em conteúdo do modal)
    if (e.target === el || el.tagName === 'BUTTON') fecharModal();
  }
  // Módulos de navegação (nav-items)
  else if (action === 'carregar-modulo') carregarModulo(el.dataset.modulo);
});

// nav-items: já têm data-modulo mas o onclick foi removido — usar delegação no sidebar
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item[data-modulo]').forEach(btn => {
    btn.addEventListener('click', () => carregarModulo(btn.dataset.modulo));
  });
  // modal-box stopPropagation (foi removido o onclick inline)
});


// ── Delegação genérica para o HTML gerado dinamicamente (modulos.js) ──────────
// Substitui onclick/onchange/oninput inline (bloqueados pela CSP). Sem eval: só chama funções
// globais já existentes, com argumentos literais (texto, número, true/false/null) ou this.value.
function _parseArgs(txt, el) {
  const args = []; let i = 0;
  const skip = () => { while (i < txt.length && /\s/.test(txt[i])) i++; };
  while (true) {
    skip(); if (i >= txt.length) break;
    const c = txt[i];
    if (c === "'" || c === '"') {
      let v = ''; i++;
      while (i < txt.length && txt[i] !== c) { if (txt[i] === '\\') i++; v += txt[i++]; }
      i++; args.push(v);
    } else {
      let j = i; while (j < txt.length && txt[j] !== ',') j++;
      const t = txt.slice(i, j).trim(); i = j;
      if (t === 'this.value') args.push(el.value);
      else if (t === 'true') args.push(true); else if (t === 'false') args.push(false);
      else if (t === 'null') args.push(null); else if (t === 'undefined' || t === '') args.push(undefined);
      else if (!isNaN(Number(t))) args.push(Number(t));
      else throw new Error('argumento não suportado: ' + t);
    }
    skip(); if (txt[i] === ',') i++;
  }
  return args;
}
function _executarHandler(codigo, el) {
  // separa instruções por ';' fora de aspas
  const partes = []; let q = null, atual = '';
  for (let k = 0; k < codigo.length; k++) {
    const ch = codigo[k];
    if (q) { atual += ch; if (ch === '\\') atual += codigo[++k]; else if (ch === q) q = null; }
    else if (ch === "'" || ch === '"') { q = ch; atual += ch; }
    else if (ch === ';') { partes.push(atual); atual = ''; } else atual += ch;
  }
  partes.push(atual);
  for (const instr of partes.map(x => x.trim()).filter(Boolean)) {
    const m = instr.match(/^([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/);
    if (!m || typeof window[m[1]] !== 'function') throw new Error('handler inválido: ' + instr);
    window[m[1]](..._parseArgs(m[2], el));
  }
}
['click', 'change', 'input'].forEach(tipo => {
  document.addEventListener(tipo, e => {
    const el = e.target.closest('[data-on-' + tipo + ']');
    if (!el) return;
    try { _executarHandler(el.getAttribute('data-on-' + tipo), el); }
    catch (err) { console.error('[ui]', err.message); }
  });
});
