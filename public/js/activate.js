// ── Extract key from URL ──
const path = window.location.pathname; // /activate/SOMEKEY
const key = path.split('/').filter(Boolean).pop();

// ── UI helpers ──
function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }
function showBlock(id) {
  ['loading-state','form-section','success-state','active-state','revoked-state','invalid-state']
    .forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = (s === id) ? (id === 'form-section' ? 'block' : 'flex') : 'none';
    });
}

// ── Load tenant info ──
async function loadLicense() {
  if (!key || key === 'activate') {
    showBlock('invalid-state');
    return;
  }

  try {
    const r = await fetch(`/api/activate/${encodeURIComponent(key)}`);
    const data = await r.json();

    if (r.status === 409) {
      // Already active
      showBlock('active-state');
      if (data.slug) {
        const btn = document.getElementById('btn-active-access');
        btn.href = `/${data.slug}`;
        btn.style.display = 'inline-flex';
      }
      return;
    }

    if (r.status === 403) {
      showBlock('revoked-state');
      return;
    }

    if (!r.ok || !data.valida) {
      document.getElementById('invalid-body').textContent =
        data.erro || 'Link inválido ou expirado.';
      showBlock('invalid-state');
      return;
    }

    // Show form with tenant info
    document.getElementById('t-nome').textContent = data.tenant_nome;

    const tags = [
      { k: 'Plano', v: data.plano },
      { k: 'Utilizadores', v: data.max_funcionarios },
      { k: 'Produtos', v: data.max_produtos },
      { k: 'Duração', v: `${data.duracao_dias} dias` },
      { k: 'Valor', v: `${Number(data.preco_mensal || 0).toLocaleString('pt-AO')} Kz/mês` },
    ];

    const container = document.getElementById('t-tags');
    tags.forEach(t => {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.innerHTML = `${t.k}: <span>${t.v}</span>`;
      container.appendChild(tag);
    });

    document.getElementById('tenant-banner').classList.add('visible');
    showBlock('form-section');

  } catch (e) {
    document.getElementById('invalid-body').textContent = 'Erro ao verificar licença. Tente novamente.';
    showBlock('invalid-state');
  }
}

// ── Password strength ──
document.getElementById('password').addEventListener('input', function () {
  const pw = this.value;
  const fill = document.getElementById('pw-fill');
  const label = document.getElementById('pw-label');

  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const colors = ['#EF4444','#F97316','#EAB308','#22C55E','#16A34A'];
  const labels = ['Muito fraca','Fraca','Razoável','Boa','Excelente'];

  if (pw.length === 0) {
    fill.style.width = '0%';
    label.textContent = 'Introduza uma password';
    label.style.color = 'var(--gray-400)';
  } else {
    fill.style.width = `${(score / 5) * 100}%`;
    fill.style.background = colors[score - 1] || colors[0];
    label.textContent = labels[score - 1] || labels[0];
    label.style.color = colors[score - 1] || colors[0];
  }
});

// ── Form validation & submit ──
document.getElementById('activation-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const nome    = document.getElementById('nome_admin').value.trim();
  const email   = document.getElementById('email_admin').value.trim();
  const tel     = document.getElementById('tel_admin').value.trim();
  const pw      = document.getElementById('password').value;

  let valid = true;

  // Clear previous errors
  ['err-nome','err-email','err-tel','err-pw'].forEach(id =>
    document.getElementById(id).classList.remove('visible')
  );
  ['nome_admin','email_admin','tel_admin','password'].forEach(id =>
    document.getElementById(id).classList.remove('error')
  );

  if (!nome) {
    valid = false;
    document.getElementById('err-nome').classList.add('visible');
    document.getElementById('nome_admin').classList.add('error');
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    valid = false;
    document.getElementById('err-email').classList.add('visible');
    document.getElementById('email_admin').classList.add('error');
  }

  if (!tel) {
    valid = false;
    document.getElementById('err-tel').classList.add('visible');
    document.getElementById('tel_admin').classList.add('error');
  }

  if (!pw || pw.length < 8) {
    valid = false;
    document.getElementById('err-pw').classList.add('visible');
    document.getElementById('password').classList.add('error');
  }

  if (!valid) return;

  // Submit
  const btn = document.getElementById('btn-submit');
  const spinner = document.getElementById('submit-spinner');
  const btnLabel = document.getElementById('btn-label');

  btn.disabled = true;
  spinner.style.display = 'block';
  btnLabel.textContent = 'A activar…';

  try {
    const r = await fetch(`/api/activate/${encodeURIComponent(key)}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_admin: nome,
        email_admin: email,
        telefone_admin: tel,
        password: pw,
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      // Show inline error
      btn.disabled = false;
      spinner.style.display = 'none';
      btnLabel.textContent = 'Activar Sistema';
      const errEl = document.getElementById('err-pw');
      errEl.textContent = data.erro || 'Erro ao activar. Tente novamente.';
      errEl.classList.add('visible');
      return;
    }

    // SUCCESS
    document.getElementById('s-empresa').textContent  = data.tenant || '—';
    document.getElementById('s-plano').textContent    = data.plano  || '—';
    document.getElementById('s-email').textContent    = data.email_admin || '—';
    document.getElementById('s-validade').textContent = data.valido_ate  || '—';

    if (data.slug) {
      document.getElementById('btn-access').href = `/${data.slug}`;
    }

    document.getElementById('success-body').textContent =
      `${data.tenant} foi activado com sucesso. Guarde as credenciais abaixo em local seguro.`;

    showBlock('success-state');

  } catch (err) {
    btn.disabled = false;
    spinner.style.display = 'none';
    btnLabel.textContent = 'Activar Sistema';
    const errEl = document.getElementById('err-pw');
    errEl.textContent = 'Erro de ligação. Verifique a sua internet e tente novamente.';
    errEl.classList.add('visible');
  }
});

// ── Init ──
loadLicense();
