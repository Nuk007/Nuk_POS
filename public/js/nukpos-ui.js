'use strict';
// Nuk_POS — navegação entre módulos, modal, toast, formatadores, acessos, arranque e delegação de eventos (CSP).
// Continua nukpos.js (dividido a 21/11/2026 para nenhum ficheiro passar das 400 linhas); as funções são globais e partilhadas.

// ── Navegação ─────────────────────────────────────────────────
// Cada carregamento desenha num contentor próprio dentro de #main-content. Ao mudar de módulo o contentor anterior
// sai da página: um módulo que acabe de carregar depois (rede lenta, toques rápidos no menu) escreve num contentor
// desligado e já não tapa o módulo escolhido. Os erros de um carregamento antigo também são ignorados.
let _geracaoModulo = 0;
function moduloEmVigor(geracao) { return geracao === _geracaoModulo; }
function carregarModulo(modulo, { deHistorico = false } = {}) {
  // Fechar o menu lateral no telemóvel ANTES de mexer no histórico: fechá-lo recua a entrada do menu, e a do
  // módulo novo tem de entrar depois desse recuo (navegacao.js põe-na em espera)
  if (window.innerWidth <= 768) fecharSidebar();
  if (typeof navAoMudarModulo === 'function') navAoMudarModulo(modulo, deHistorico); // botão «voltar» (navegacao.js)
  NUK.moduloActual = modulo;

  // Actualizar nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.modulo === modulo);
  });
  const activo = document.querySelector(`.nav-item[data-modulo="${modulo}"]`);
  if (activo && activo.closest('.nav-grupo')) abrirGrupoNav(activo.closest('.nav-grupo'), true, false);

  const titulos = {
    dashboard: '📊 Dashboard', pedidos: '🍽️ Pedidos', mesas: '🪑 Mesa', balcao: '🧾 Balcão', remota: '📱 Remota', takeaway: '🥡 Take Away', cozinha: '👨‍🍳 Cozinha e bar',
    quartos: '🛏️ Quartos', caixa: '💵 Caixa do dia', nukcoin: '💜 Nuk-Coin', cartoes: '💳 Cartões de consumo', recebimentos: '🧾 Receber mesas', contas: '📒 Contas correntes', movimentos: '🔎 Movimentos do caixa', compras: '🛒 Compras pontuais', servicos: '🛠️ Avarias e danos', lazer: '🎯 Lazer', loja: '🛍️ Loja', patrimonio: '🏛️ Património', manutencao: '🗓️ Prazos de manutenção', solicitacoes: '🔔 Solicitações', produtos: '📋 Produtos', stock: '📦 Stock',
    financeiro: '💰 Financeiro', relatorios: '📈 Relatórios', clientes: '👥 Clientes',
    funcionarios: '👨‍💼 Funcionários', assiduidade: '🕒 Assiduidade', configuracoes: '⚙️ Configurações',
  };
  document.getElementById('topbar-titulo').textContent = titulos[modulo] || modulo;

  const geracao = ++_geracaoModulo;
  const el = document.createElement('div');
  el.className = 'modulo-contentor';
  el.dataset.modulo = modulo;
  el.innerHTML = '<div class="loading-spinner">A carregar...</div>';
  document.getElementById('main-content').replaceChildren(el);

  const fn = window['modulo_' + modulo];
  if (fn) {
    Promise.resolve().then(() => fn(el)).catch(err => {
      if (!moduloEmVigor(geracao)) return; // já se mudou de módulo: o erro antigo não interessa
      el.innerHTML = `<div class="erro-msg" style="margin:2rem">Erro ao carregar módulo: ${esc(err.message)}</div>`;
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
  const ov = document.getElementById('modal-overlay');
  const jaAberta = ov.style.display === 'flex';
  document.getElementById('modal-titulo').textContent = titulo;
  document.getElementById('modal-corpo').innerHTML = htmlCorpo;
  ov.style.display = 'flex';
  if (typeof navAoAbrirModal === 'function') navAoAbrirModal(jaAberta);
}

/** `peloVoltar` = fechada pelo botão «voltar» (o histórico já recuou). */
function fecharModal(peloVoltar) {
  const ov = document.getElementById('modal-overlay');
  const estavaAberta = ov.style.display === 'flex';
  ov.style.display = 'none';
  if (estavaAberta && typeof navAoFecharModal === 'function') navAoFecharModal(peloVoltar === true);
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
  if (s.classList.contains('aberta')) { fecharSidebar(); return; }
  s.classList.add('aberta');
  document.getElementById('sidebar-overlay').classList.add('visivel');
  if (typeof navAoAbrirSidebar === 'function') navAoAbrirSidebar();
}
/** `peloVoltar` = fechado pelo botão «voltar» (o histórico já recuou). */
function fecharSidebar(peloVoltar) {
  const s = document.getElementById('sidebar');
  const estavaAberta = s.classList.contains('aberta');
  s.classList.remove('aberta');
  document.getElementById('sidebar-overlay').classList.remove('visivel');
  if (estavaAberta && typeof navAoFecharSidebar === 'function') navAoFecharSidebar(peloVoltar === true);
}

// ── Relógio ───────────────────────────────────────────────────
function actualizarHora() {
  const agora = new Date();
  document.getElementById('hora-atual').textContent = agora.toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Luanda' });
}

// ── Formatadores ──────────────────────────────────────────────
/** Quantidade de uma linha: «2×» nas unidades, «0,355 kg» nos produtos vendidos ao peso. */
function fmtQtd(q) {
  const n = Number(q);
  return Number.isInteger(n) ? `${n}×` : `${n.toLocaleString('pt-PT', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}

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

// ── Menu em acordeão (pedido do dono, 22/11/2026): só as categorias ficam à vista; tocar numa abre-a (os
// módulos descem por baixo) e fecha as outras. A categoria do módulo em uso abre sozinha ao mudar de módulo.
function abrirGrupoNav(grupo, abrir, rolar = true) {
  if (!grupo) return;
  if (abrir) {
    document.querySelectorAll('.nav-grupo.aberto').forEach(g => { if (g !== grupo) abrirGrupoNav(g, false); });
  }
  grupo.classList.toggle('aberto', abrir);
  const t = grupo.querySelector('.nav-titulo');
  if (t) t.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  if (abrir && rolar && typeof grupo.scrollIntoView === 'function') {
    requestAnimationFrame(() => grupo.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
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
  // Categoria do menu: abre/fecha (acordeão)
  else if (action === 'nav-grupo') { const g = el.closest('.nav-grupo'); abrirGrupoNav(g, !g.classList.contains('aberto')); }
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


// ── Delegação genérica para o HTML gerado dinamicamente (modulos.js e restantes ficheiros dos módulos) ──────────
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
      else if (t === 'this.checked') args.push(!!el.checked); // caixas de selecção (ex.: «Emitir factura-recibo»)
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
