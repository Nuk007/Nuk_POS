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

  let r;
  try { r = await fetch(`/api${path}`, opts); }
  catch (e) {
    // sem rede: as leituras do painel de venda usam a última cópia guardada (offline.js)
    if (metodo === 'GET' && typeof offlineLer === 'function') {
      const copia = offlineLer(path);
      if (copia !== undefined) { if (typeof offlineIndicador === 'function') offlineIndicador(); return copia; }
    }
    const err = new Error('Sem ligação ao servidor'); err.semRede = true; throw err;
  }
  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    // Só faz logout em 401 se já estiver autenticado (não durante o próprio login)
    if (r.status === 401 && NUK.token && path !== '/auth/login') { logout(); return; }
    // Contrato de Adesão por assinar (13/11/2026): mostra o ecrã de assinatura em vez de um erro solto.
    if (r.status === 428 && json.codigo === 'ADESAO_PENDENTE' && typeof mostrarAdesao === 'function') { mostrarAdesao(); }
    // Licença expirada / conta suspensa (14/11/2026): ecrã próprio em vez do erro solto em cada módulo.
    if (r.status === 403 && ['LICENCA_EXPIRADA', 'TENANT_SUSPENSA'].includes(json.codigo) && typeof mostrarLicencaBloqueada === 'function') { mostrarLicencaBloqueada(json); }
    // o erro leva o código e os dados da resposta (ex.: fecho do caixa recusado com a lista de contas por pagar)
    throw Object.assign(new Error(json.erro || `Erro ${r.status}`), { status: r.status, codigo: json.codigo, dados: json });
  }
  if (metodo === 'GET' && typeof offlineGuardarLeitura === 'function') offlineGuardarLeitura(path, json);
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
  const telaLic = document.getElementById('tela-licenca'); if (telaLic) telaLic.style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
}

// ── Arranque da app ───────────────────────────────────────────
// Primeiro confirma o Contrato de Adesão (13/11/2026): por assinar, abre o ecrã de assinatura e só depois
// de assinado arranca a operação.
async function iniciarApp() {
  document.getElementById('tela-login').style.display = 'none';
  if (typeof verificarLicenca === 'function' && await verificarLicenca()) return;
  if (typeof verificarAdesao === 'function' && await verificarAdesao()) return;
  arrancarOperacao();
}

function arrancarOperacao() {
  document.getElementById('tela-adesao').style.display = 'none';
  const telaLic = document.getElementById('tela-licenca'); if (telaLic) telaLic.style.display = 'none';
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
  if (typeof cadeiaArrancar === 'function') cadeiaArrancar();
  if (typeof offlineArrancar === 'function') offlineArrancar();

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
