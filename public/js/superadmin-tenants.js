// Painel Superadmin — módulos contratados, cadeias, novo estabelecimento, expirações e modais.
// Continua superadmin.js (dividido a 21/11/2026 para nenhum ficheiro passar das 400 linhas); as funções são globais e partilhadas.

// ── MÓDULOS CONTRATADOS ──────────────────────────────
let CATALOGO_MODULOS = null;
async function catalogoModulos() {
  if (!CATALOGO_MODULOS) CATALOGO_MODULOS = await api('/api/saas/modulos');
  return CATALOGO_MODULOS;
}
function htmlModulos(cat, marcados, prefixo) {
  return cat.modulos.map(m => `<label class="${m.pronto ? '' : 'off'}">
    <input type="checkbox" data-mod="${m.chave}" id="${prefixo}-${m.chave}" ${marcados.includes(m.chave) ? 'checked' : ''} ${m.pronto ? '' : 'disabled'}>
    <span>${m.rotulo}${m.pronto ? '' : ' <small>(em breve)</small>'}</span></label>`).join('');
}
function lerModulos(contentor) {
  return [...contentor.querySelectorAll('input[data-mod]:checked')].map(i => i.dataset.mod);
}
async function prepararModulosNovo() {
  const box = document.getElementById('nt-modulos');
  try {
    const cat = await catalogoModulos();
    const pintar = () => { box.innerHTML = htmlModulos(cat, cat.planos[document.getElementById('nt-plano').value] || [], 'nt-mod'); };
    pintar();
    document.getElementById('nt-plano').addEventListener('change', pintar);
  } catch (e) { box.textContent = e.message; }
}
prepararModulosNovo();

async function guardarModulos(id) {
  const lista = lerModulos(document.getElementById('det-modulos'));
  try {
    await api(`/api/saas/tenants/${id}/modulos`, { method: 'PUT', body: { modulos: lista } });
    toast('Módulos actualizados');
  } catch (e) { toast(e.message, 'err'); }
}

const escAttr = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function guardarCadeia(id) {
  const nome = document.getElementById('det-cadeia').value.trim();
  try {
    await api(`/api/saas/tenants/${id}/cadeia`, { method: 'PUT', body: { nome } });
    toast(nome ? `Estabelecimento na cadeia «${nome}»` : 'Estabelecimento retirado da cadeia');
  } catch (e) { toast(e.message, 'err'); }
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
      body: { nome, telefone_whatsapp: tel, nif, email, plano_nome: plano, duracao_dias: dias, notas, modulos: lerModulos(document.getElementById('nt-modulos')) },
    });
    result.hidden = false;
    result.className = 'alert alert-ok';
    result.innerHTML = `<strong>${nome}</strong> registado com sucesso.<br>
      Slug: <code>/${r.slug}</code><br>
      ${r.whatsapp_enviado
        ? '📲 Link de activação enviado via WhatsApp.'
        : `⚠️ WhatsApp automático não enviado — link de activação:<br><code style="word-break:break-all;font-size:12px">${r.activation_link}</code>` +
          (r.whatsapp_manual ? `<br><a href="${r.whatsapp_manual}" target="_blank" class="btn btn-sm btn-blue" style="margin-top:8px;display:inline-block">📲 Abrir WhatsApp com a mensagem</a>` : '')}
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
  else if (action === 'guardar-modulos')    guardarModulos(btn.dataset.id);
  else if (action === 'guardar-cadeia')     guardarCadeia(btn.dataset.id);
  else if (action === 'reenviar-wa')       reenviarWA(btn.dataset.key, btn.dataset.nome);
  else if (action === 'reenviar-wa-by-id') reenviarWAById(btn.dataset.id, btn.dataset.nome);
  else if (action === 'navigate')          navigate(btn.dataset.view);
  else if (action === 'change-page')       changePage(parseInt(btn.dataset.dir));
});
