let API_KEY = '';
const BASE  = '';
let tPage = 1, tSearch = '', tEstado = '', searchTimer;

// ── UTILS ──────────────────────────────────────────
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = '', 3500);
}

function api(path, opts = {}) {
  return fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Superadmin-Key': API_KEY, ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);
    return d;
  });
}

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysLeft(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - Date.now()) / 86400000);
}

function statusBadge(e) {
  return `<span class="status ${e}">${e}</span>`;
}

function planTag(p) {
  if (!p) return '—';
  return `<span class="plan-tag ${p}">${p}</span>`;
}

function copyText(t) {
  navigator.clipboard.writeText(t).then(() => toast('Copiado para a área de transferência')).catch(() => {
    const el = document.createElement('textarea');
    el.value = t; document.body.appendChild(el); el.select();
    document.execCommand('copy'); el.remove();
    toast('Copiado');
  });
}

// ── LOGIN ───────────────────────────────────────────
document.getElementById('btn-entrar').addEventListener('click', doLogin);
document.getElementById('key-input').addEventListener('keydown', e => e.key === 'Enter' && doLogin());

async function doLogin() {
  const key = document.getElementById('key-input').value.trim();
  if (!key) return;
  const btn = document.getElementById('btn-entrar');
  btn.textContent = 'A verificar…'; btn.disabled = true;
  const errEl = document.getElementById('login-err');
  errEl.hidden = true;
  try {
    API_KEY = key;
    await api('/api/saas/dashboard');
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadDashboard();
  } catch (e) {
    // Mostra o erro real devolvido pelo servidor (ex.: "Chave inválida", "Autenticação
    // obrigatória", "Serviço indisponível") em vez de uma mensagem genérica — sem isto,
    // não há forma de distinguir uma chave errada de uma falha de rede ou do servidor.
    API_KEY = '';
    errEl.textContent = e.message || 'Chave inválida ou serviço indisponível.';
    errEl.hidden = false;
  } finally {
    btn.textContent = 'Entrar no painel'; btn.disabled = false;
  }
}

document.getElementById('btn-logout').addEventListener('click', () => {
  API_KEY = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('key-input').value = '';
});

// ── NAV ─────────────────────────────────────────────
document.querySelectorAll('.nav-item[data-page]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.page)));

function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  const titles = { dashboard: 'Dashboard', tenants: 'Tenants', 'novo-tenant': 'Novo Tenant', expiracoes: 'Expirações' };
  document.getElementById('tb-title').textContent = titles[page] || '';
  if (page === 'dashboard')   loadDashboard();
  if (page === 'tenants')     loadTenants();
  if (page === 'expiracoes')  loadExpiracoes();
}

// ── DASHBOARD ────────────────────────────────────────
async function loadDashboard() {
  try {
    const d = await api('/api/saas/dashboard');
    document.getElementById('s-total').textContent     = d.resumo.total;
    document.getElementById('s-activas').textContent   = d.resumo.activas;
    document.getElementById('s-pendentes').textContent = d.resumo.pendentes;
    document.getElementById('s-suspensas').textContent = d.resumo.suspensas;

    const c = document.getElementById('expiry-alert-list');
    if (!d.expiram_em_7_dias.length) {
      c.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><p>Nenhuma licença a expirar nos próximos 7 dias</p></div>';
    } else {
      c.innerHTML = d.expiram_em_7_dias.map(t => {
        const dias = daysLeft(t.fim);
        return `<div class="exp-card">
          <div>
            <div class="exp-name">${t.nome}</div>
            <div class="exp-meta">/${t.slug} · ${t.telefone_whatsapp || '—'}</div>
          </div>
          <div style="text-align:right">
            <div class="exp-days">${dias <= 0 ? 'Expirada' : `${dias} dia${dias===1?'':'s'}`}</div>
            <div class="exp-date">${fmt(t.fim)}</div>
            <button class="btn btn-sm btn-ghost" style="margin-top:6px" data-action="renovar-licenca" data-id="${t.id}" data-nome="${t.nome}">Renovar</button>
          </div>
        </div>`;
      }).join('');
    }
  } catch (e) { toast('Erro: ' + e.message, 'err'); }
}

// ── TENANTS ──────────────────────────────────────────
document.getElementById('search-tenants').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { tSearch = e.target.value; tPage = 1; loadTenants(); }, 350);
});
document.getElementById('filter-estado').addEventListener('change', e => {
  tEstado = e.target.value; tPage = 1; loadTenants();
});

async function loadTenants() {
  const tbody = document.getElementById('tenants-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="6"><span class="spinner"></span></td></tr>';
  const p = new URLSearchParams({ page: tPage });
  if (tSearch) p.set('q', tSearch);
  if (tEstado) p.set('estado', tEstado);
  try {
    const d = await api(`/api/saas/tenants?${p}`);
    if (!d.tenants.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="empty-icon">🏢</div><p>Nenhum tenant encontrado</p></div></td></tr>';
    } else {
      tbody.innerHTML = d.tenants.map(t => {
        const dias = daysLeft(t.licenca_fim);
        const expCls = dias !== null && dias <= 7 ? 'exp-warn' : 'exp-ok';
        const expLabel = t.licenca_fim
          ? `<span class="${expCls}">${fmt(t.licenca_fim)}${dias !== null && dias <= 7 ? ` · ${dias}d` : ''}</span>`
          : '—';
        return `<tr>
          <td><div class="t-name">${t.nome}</div><div class="t-slug">/${t.slug}</div></td>
          <td>${statusBadge(t.estado)}</td>
          <td>${planTag(t.plano_nome)}</td>
          <td>${expLabel}</td>
          <td style="font-family:monospace;font-size:12px;color:var(--muted)">${t.telefone_whatsapp || '—'}</td>
          <td><button class="btn btn-sm btn-ghost" data-tenant-id="${t.id}">Ver</button></td>
        </tr>`;
      }).join('');
    }
    const total = d.total || 0;
    const pages = Math.ceil(total / 20);
    document.getElementById('tenants-pagination').innerHTML = `
      <span>${total} tenant${total!==1?'s':''}</span>
      <div class="pag-btns">
        <button data-action="change-page" data-dir="-1" ${tPage<=1?'disabled':''}>← Anterior</button>
        <button data-action="change-page" data-dir="1"  ${tPage>=pages?'disabled':''}>Seguinte →</button>
      </div>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-err" style="margin:16px">${e.message}</div></td></tr>`;
  }
}

function changePage(d) { tPage += d; loadTenants(); }

// Event delegation para botões Ver — mais robusto que onclick inline
document.getElementById('tenants-tbody').addEventListener('click', e => {
  const btn = e.target.closest('button[data-tenant-id]');
  if (btn) verTenant(btn.dataset.tenantId);
});

async function verTenant(id) {
  const body   = document.getElementById('modal-tenant-body');
  const footer = document.getElementById('modal-tenant-footer');
  body.innerHTML = '<div style="text-align:center;padding:24px"><span class="spinner"></span></div>';
  footer.innerHTML = '';
  document.getElementById('modal-tenant-title').textContent = '…';
  document.getElementById('modal-tenant').hidden = false;
  try {
    const t = await api(`/api/saas/tenants/${id}`);
    const licKey = (t.licencas && t.licencas[0] && t.licencas[0].license_key) ? t.licencas[0].license_key : null;
    document.getElementById('modal-tenant-title').textContent = t.nome;
    const dias = daysLeft(t.licenca_fim);
    body.innerHTML = `
      ${dias !== null && dias <= 7 ? `<div class="alert alert-warn">A licença expira em ${dias <= 0 ? 0 : dias} dia${dias===1?'':'s'} — renove para evitar interrupção.</div>` : ''}
      <div class="detail-grid">
        <div class="detail-item"><div class="di-label">ESTADO</div><div class="di-val">${statusBadge(t.estado)}</div></div>
        <div class="detail-item"><div class="di-label">PLANO</div><div class="di-val">${planTag(t.plano_nome)}</div></div>
        <div class="detail-item"><div class="di-label">SLUG</div><div class="di-val"><code style="font-size:13px;background:var(--bg);padding:2px 6px;border-radius:4px">/${t.slug}</code></div></div>
        <div class="detail-item"><div class="di-label">CRIADO EM</div><div class="di-val">${fmt(t.criado_em)}</div></div>
        <div class="detail-item"><div class="di-label">WHATSAPP</div><div class="di-val" style="font-family:monospace">${t.telefone_whatsapp || '—'}</div></div>
        <div class="detail-item"><div class="di-label">EMAIL</div><div class="di-val">${t.email || '—'}</div></div>
        <div class="detail-item"><div class="di-label">NIF</div><div class="di-val">${t.nif || '—'}</div></div>
        <div class="detail-item"><div class="di-label">LICENÇA EXPIRA</div><div class="di-val ${dias!==null&&dias<=7?'exp-warn':''}">${fmt(t.licenca_fim)}</div></div>
        ${licKey ? `<div class="detail-item full"><div class="di-label">CHAVE DE LICENÇA</div><div class="key-box"><code>${licKey}</code><button class="copy-btn" title="Copiar" data-action="copy" data-key="${licKey}">📋</button></div></div>` : ''}
        ${t.notas ? `<div class="detail-item full"><div class="di-label">NOTAS</div><div class="di-val" style="color:var(--muted);font-size:13px">${t.notas}</div></div>` : ''}
      </div>`;
    footer.innerHTML = `
      <button class="btn btn-ghost btn-sm" data-action="close-modal" data-modal="modal-tenant">Fechar</button>
      ${t.estado==='ACTIVA'   ? `<button class="btn btn-danger btn-sm"  data-action="alterar-estado" data-id="${t.id}" data-estado="SUSPENSA" data-nome="${t.nome}">Suspender</button>`  : ''}
      ${t.estado==='SUSPENSA' ? `<button class="btn btn-success btn-sm" data-action="alterar-estado" data-id="${t.id}" data-estado="ACTIVA"   data-nome="${t.nome}">Reactivar</button>` : ''}
      <button class="btn btn-blue btn-sm" data-action="renovar-licenca" data-id="${t.id}" data-nome="${t.nome}">Renovar licença</button>
      ${licKey ? `<button class="btn btn-ghost btn-sm" data-action="reenviar-wa" data-key="${licKey}" data-nome="${t.nome}">📲 Reenviar link</button>` : ''}`;
  } catch (e) { body.innerHTML = `<div class="alert alert-err">${e.message}</div>`; }
}

async function alterarEstado(id, s, nome) {
  const label = s==='SUSPENSA' ? 'Suspender' : 'Reactivar';
  miniConfirm(`${label} "${nome}"?`, async () => {
    try {
      await api(`/api/saas/tenants/${id}/estado`, { method: 'PATCH', body: { estado: s } });
      toast(`${nome} — ${s==='SUSPENSA'?'suspenso':'reactivado'}`);
      closeModal('modal-tenant'); loadTenants();
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function renovarLicenca(id, nome) {
  miniPrompt(`Renovar licença de "${nome}" — dias a adicionar:`, '30', async (val) => {
    if (!val || isNaN(+val)) return;
    try {
      const r = await api(`/api/saas/tenants/${id}/renovar`, { method: 'POST', body: { duracao_dias: +val } });
      toast(`Licença renovada até ${fmt(r.novo_fim)}`);
      closeModal('modal-tenant'); loadTenants(); loadDashboard();
    } catch (e) { toast(e.message, 'err'); }
  });
}

// Mini confirm/prompt inline (sem window.confirm/prompt que bloqueiam em alguns contextos)
function miniConfirm(msg, onOk) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.style.zIndex = '400';
  ov.innerHTML = `<div class="modal" style="max-width:360px">
    <div class="modal-body" style="padding:24px 24px 16px">
      <p style="font-size:15px;font-weight:600;margin-bottom:6px">Confirmar acção</p>
      <p style="color:var(--muted);font-size:14px">${msg}</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" id="mc-cancel">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mc-ok">Confirmar</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  // Impedir que clicks no overlay do miniConfirm propaguem para modais pai
  ov.addEventListener('click', e => e.stopPropagation());
  ov.querySelector('#mc-cancel').onclick = e => { e.stopPropagation(); document.body.removeChild(ov); };
  ov.querySelector('#mc-ok').onclick = e => { e.stopPropagation(); document.body.removeChild(ov); onOk(); };
}

function miniPrompt(msg, defaultVal, onOk) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.style.zIndex = '400';
  ov.innerHTML = `<div class="modal" style="max-width:360px">
    <div class="modal-body" style="padding:24px 24px 16px">
      <p style="font-size:14px;font-weight:600;margin-bottom:12px">${msg}</p>
      <input type="number" id="mp-input" value="${defaultVal}" min="1" max="365"
        style="width:100%;padding:9px 12px;border:1.5px solid var(--border2);border-radius:6px;font-size:14px;font-family:inherit;outline:none">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" id="mp-cancel">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mp-ok">Confirmar</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const inp = ov.querySelector('#mp-input');
  inp.focus(); inp.select();
  ov.querySelector('#mp-cancel').onclick = () => document.body.removeChild(ov);
  ov.querySelector('#mp-ok').onclick = () => { const v = inp.value; document.body.removeChild(ov); onOk(v); };
  inp.onkeydown = e => { if (e.key==='Enter') { const v = inp.value; document.body.removeChild(ov); onOk(v); } };
}

async function reenviarWA(key, nome) {
  miniConfirm(`Reenviar link de activação para "${nome}" via WhatsApp?`, async () => {
    try {
      await api(`/api/saas/licencas/${key}/reenviar`, { method: 'POST' });
      toast('Link de activação reenviado via WhatsApp');
    } catch (e) { toast(e.message, 'err'); }
  });
}

// ── NOVO TENANT ──────────────────────────────────────
document.getElementById('btn-criar-tenant').addEventListener('click', criarTenant);

async function criarTenant() {
  const nome  = document.getElementById('nt-nome').value.trim();
  const tel   = document.getElementById('nt-tel').value.trim();
  const nif   = document.getElementById('nt-nif').value.trim();
  const email = document.getElementById('nt-email').value.trim();
  const plano = document.getElementById('nt-plano').value;
  const dias  = +document.getElementById('nt-dias').value;
  const notas = document.getElementById('nt-notas').value.trim();
  const result = document.getElementById('nt-result');
  result.hidden = true;
  if (!nome) { toast('Nome do estabelecimento é obrigatório', 'err'); return; }
  if (!tel)  { toast('Telefone WhatsApp é obrigatório', 'err'); return; }
  const btn = document.getElementById('btn-criar-tenant');
  btn.disabled = true; btn.textContent = 'A criar…';
  try {
    const r = await api('/api/saas/tenants', {
      method: 'POST',
      body: { nome, telefone_whatsapp: tel, nif, email, plano_nome: plano, duracao_dias: dias, notas },
    });
    result.hidden = false;
    result.className = 'alert alert-ok';
    result.innerHTML = `<strong>${nome}</strong> registado com sucesso.<br>
      Slug: <code>/${r.slug}</code><br>
      ${r.whatsapp_enviado ? '📲 Link de activação enviado via WhatsApp.' : `⚠️ WhatsApp não enviado — link de activação:<br><code style="word-break:break-all;font-size:12px">${r.activation_link}</code>`}
      <div class="key-box" style="margin-top:10px"><code>${r.license_key}</code><button class="copy-btn" data-action="copy" data-key="${r.license_key}">📋</button></div>`;
    ['nt-nome','nt-nif','nt-tel','nt-email','nt-notas'].forEach(i => document.getElementById(i).value='');
    document.getElementById('nt-dias').value = '30';
    loadDashboard();
  } catch (e) {
    result.hidden = false;
    result.className = 'alert alert-err';
    result.innerHTML = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Criar tenant e enviar activação';
  }
}

// ── EXPIRAÇÕES ───────────────────────────────────────
async function loadExpiracoes() {
  const c = document.getElementById('exp-content');
  c.innerHTML = '<div style="text-align:center;padding:36px"><span class="spinner"></span></div>';
  try {
    const d = await api('/api/saas/dashboard');
    if (!d.expiram_em_7_dias.length) {
      c.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><p>Nenhuma licença a expirar nos próximos 7 dias</p></div>';
    } else {
      c.innerHTML = '<div class="card-header"><div class="card-title">Requer atenção imediata</div></div>' +
        d.expiram_em_7_dias.map(t => {
          const dias = daysLeft(t.fim);
          return `<div class="exp-card">
            <div>
              <div class="exp-name">${t.nome}</div>
              <div class="exp-meta">/${t.slug} · ${t.telefone_whatsapp || '—'}</div>
              <div class="exp-meta" style="margin-top:2px">Expira: ${fmt(t.fim)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
              <div class="exp-days">${dias<=0?'Expirada':`${dias} dia${dias===1?'':'s'}`}</div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm btn-blue" data-action="renovar-licenca" data-id="${t.id}" data-nome="${t.nome}">Renovar</button>
                <button class="btn btn-sm btn-ghost" data-action="reenviar-wa-by-id" data-id="${t.id}" data-nome="${t.nome}">📲</button>
              </div>
            </div>
          </div>`;
        }).join('');
    }
  } catch (e) { c.innerHTML = `<div class="alert alert-err" style="margin:16px">${e.message}</div>`; }
}

async function reenviarWAById(id, nome) {
  try {
    const t = await api(`/api/saas/tenants/${id}`);
    const licKey = (t.licencas && t.licencas[0] && t.licencas[0].license_key) ? t.licencas[0].license_key : null;
    if (!licKey) { toast('Sem chave de licença', 'err'); return; }
    await reenviarWA(licKey, nome);
  } catch (e) { toast(e.message, 'err'); }
}

// ── MODAL ────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).hidden = true; }
document.querySelectorAll('.modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target===m) closeModal(m.id); })
);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // Fechar primeiro qualquer miniConfirm/miniPrompt dinâmico (sem id estático)
  const dinamico = document.querySelector('.modal-overlay:not([id])');
  if (dinamico) { document.body.removeChild(dinamico); return; }
  // Só então fechar modais estáticos
  document.querySelectorAll('.modal-overlay:not([hidden])').forEach(m => m.hidden = true);
});

// Event delegation — substitui todos os onclick= inline (bloqueados pela CSP)
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.stopPropagation();
  const action = btn.dataset.action;
  if      (action === 'copy')              copyText(btn.dataset.key);
  else if (action === 'close-modal')       closeModal(btn.dataset.modal);
  else if (action === 'alterar-estado')    alterarEstado(btn.dataset.id, btn.dataset.estado, btn.dataset.nome);
  else if (action === 'renovar-licenca')   renovarLicenca(btn.dataset.id, btn.dataset.nome);
  else if (action === 'reenviar-wa')       reenviarWA(btn.dataset.key, btn.dataset.nome);
  else if (action === 'reenviar-wa-by-id') reenviarWAById(btn.dataset.id, btn.dataset.nome);
  else if (action === 'navigate')          navigate(btn.dataset.view);
  else if (action === 'change-page')       changePage(parseInt(btn.dataset.dir));
});
