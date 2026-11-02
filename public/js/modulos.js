// Nuk_POS — Módulos da Interface
// Dashboard, Pedidos, Mesas, Quartos, Produtos, Stock, Financeiro, Clientes, Funcionários, Configs

'use strict';

// ════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════
// ── Dashboard: comparação hoje / ontem / dia homólogo (barras; só a de hoje cresce com a facturação) ──
const _fmtDia = d => { const [a, m, dd] = d.split('-'); return `${dd}/${m}`; };
const _diaSemana = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short' });

function htmlBarras(v, dias, fmt) {
  const max = Math.max(v.hoje, v.ontem, v.homologo, 1);
  const linha = (cls, rot, val) => `<div class="cmp-linha ${cls}"><span class="cmp-rot">${rot}</span><span class="cmp-barra"><i style="width:${Math.round((val / max) * 100)}%"></i></span><span class="cmp-num">${fmt(val)}</span></div>`;
  return linha('cmp-linha--hoje', 'Hoje', v.hoje)
    + linha('', `Ontem <small>${_fmtDia(dias.ontem)}</small>`, v.ontem)
    + linha('', `${_diaSemana(dias.homologo)} <small>${_fmtDia(dias.homologo)}</small>`, v.homologo);
}
function htmlVariacao(v) {
  const f = (ref, nome) => {
    if (!ref) return `<span class="igual">${nome}: —</span>`;
    const p = Math.round(((v.hoje - ref) / ref) * 100);
    return `<span class="${p > 0 ? 'sobe' : p < 0 ? 'desce' : 'igual'}">${nome}: ${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)}%</span>`;
  };
  return `<div class="cmp-var">${f(v.ontem, 'vs ontem')}${f(v.homologo, 'vs semana passada')}</div>`;
}
function htmlCartaoItem(it, dias) {
  const n = x => String(x);
  let topo = `<div class="cmp-sub">${it.unidade === 'un' ? 'unidades vendidas' : it.unidade === 'vendas' ? 'vendas' : it.unidade === 'pedidos' ? 'pedidos' : 'registos'} hoje</div>`;
  let extra = '';
  if (it.fonte === 'CONTADOR') {
    topo = `<div class="cmp-grande-num">${it.agora}</div><div class="cmp-sub">agora · entradas de hoje comparadas abaixo</div>`;
    extra = `<div class="cmp-acoes"><button class="btn-primario" data-on-click="registarDashboard('${esc(it.id)}','MAIS')">＋ Entrou</button><button class="btn-secundario" data-on-click="registarDashboard('${esc(it.id)}','MENOS')">－ Saiu</button></div>`;
  } else if (it.fonte === 'PENDENCIA') {
    topo = `<div class="cmp-grande-num">${it.em_aberto} <small style="font-size:.8rem;color:var(--c-muted)">em aberto</small></div><div class="cmp-sub">tratadas: hoje ${it.tratadas.hoje} · ontem ${it.tratadas.ontem} · ${_diaSemana(dias.homologo)} ${it.tratadas.homologo}</div>`;
    extra = `<div class="cmp-acoes"><button class="btn-primario" data-on-click="registarDashboard('${esc(it.id)}','ABRIR')">＋ Nova</button><button class="btn-secundario" data-on-click="registarDashboard('${esc(it.id)}','TRATAR')">✓ Tratada</button></div>`;
  } else if (it.valor) {
    topo = `<div class="cmp-grande-num">${n(it.quantidade.hoje)}</div><div class="cmp-sub">${it.unidade === 'un' ? 'unidades' : 'vendas'} hoje · ${formatarMoeda(it.valor.hoje)}</div>`;
  } else {
    topo = `<div class="cmp-grande-num">${n(it.quantidade.hoje)}</div>${topo.replace(/<div class="cmp-sub">.*?<\/div>/, '<div class="cmp-sub">hoje</div>')}`;
  }
  return `<div class="cmp-card"><div class="cmp-titulo">${esc(it.nome)}</div>${topo}${htmlBarras(it.quantidade, dias, x => String(x))}${htmlVariacao(it.quantidade)}${extra}</div>`;
}
function htmlComparativo(c) {
  if (!c) return '';
  const f = c.facturacao;
  const itens = c.itens.map(it => htmlCartaoItem(it, c.dias)).join('');
  return `
    <div class="cmp-grid">
      <div class="cmp-card cmp-card--grande">
        <div class="cmp-titulo">Facturação — hoje, ontem e ${_diaSemana(c.dias.homologo)} passada</div>
        <div class="cmp-sub">Pedidos fechados + quartos vendidos. A barra de hoje cresce ao longo do dia; as outras são o total do dia.</div>
        ${htmlBarras(f.valor, c.dias, formatarMoeda)}
        ${htmlVariacao(f.valor)}
      </div>
      ${itens}
    </div>`;
}

async function registarDashboard(id, evento) {
  try {
    await api('POST', `/dashboard/itens/${id}/registos`, { evento });
    carregarModulo('dashboard');
  } catch (e) { toast(e.message || 'Erro ao registar', 'erro'); }
}

async function modulo_dashboard(el) {
  try {
    const [d, cmp] = await Promise.all([api('GET', '/dashboard'), api('GET', '/dashboard/comparativo').catch(() => null)]);
    const mesasLivres = d.mesas.find(m => m.status === 'LIVRE')?.total || 0;
    const mesasOcupadas = d.mesas.find(m => m.status === 'OCUPADA')?.total || 0;
    const quartosDisp = d.quartos.find(q => q.status === 'DISPONIVEL')?.total || 0;
    const quartosOcup = d.quartos.find(q => q.status === 'OCUPADO')?.total || 0;

    el.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Receita Hoje <span class="kpi-icon">💰</span></div>
          <div class="kpi-valor texto-primario">${formatarMoeda(d.resumo_hoje.receita_hoje)}</div>
          <div class="kpi-sub">${d.resumo_hoje.fechados || 0} pedidos fechados</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Pedidos Activos <span class="kpi-icon">🍽️</span></div>
          <div class="kpi-valor">${d.pedidos_abertos.length}</div>
          <div class="kpi-sub">em aberto / preparo</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Mesas <span class="kpi-icon">🪑</span></div>
          <div class="kpi-valor"><span class="texto-primario">${mesasOcupadas}</span> <span style="font-size:.9rem;color:var(--c-muted)">/ ${mesasLivres} livres</span></div>
          <div class="kpi-sub">ocupadas agora</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Quartos <span class="kpi-icon">🛏️</span></div>
          <div class="kpi-valor"><span class="texto-primario">${quartosOcup}</span> <span style="font-size:.9rem;color:var(--c-muted)">/ ${quartosDisp} livres</span></div>
          <div class="kpi-sub">ocupados agora</div>
        </div>
        ${d.alertas_stock > 0 ? `
        <div class="kpi-card" style="border-color:var(--c-warning)">
          <div class="kpi-label">Alertas Stock <span class="kpi-icon">⚠️</span></div>
          <div class="kpi-valor texto-aviso">${d.alertas_stock}</div>
          <div class="kpi-sub"><button class="btn-primario" style="padding:.3rem .75rem;font-size:.78rem" data-on-click="carregarModulo('stock')">Ver stock</button></div>
        </div>` : ''}
      </div>

      ${htmlComparativo(cmp)}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div class="card">
          <div class="card-header"><span class="card-titulo">Pedidos em Aberto</span>
            <button class="btn-primario" style="padding:.3rem .75rem;font-size:.78rem" data-on-click="carregarModulo('pedidos')">Ver todos</button></div>
          ${d.pedidos_abertos.length === 0 ? '<p class="muted" style="padding:.5rem 0">Sem pedidos activos</p>' :
            d.pedidos_abertos.slice(0, 5).map(p => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--c-border)">
              <span><b>Mesa ${p.mesa || '?'}</b> · ${p.num_itens} itens</span>
              <span>${badgeStatus(p.status)}</span>
              <span class="texto-primario">${formatarMoeda(p.total)}</span>
            </div>`).join('')}
        </div>
        <div class="card">
          <div class="card-header"><span class="card-titulo">Top Produtos Hoje</span></div>
          ${d.top_produtos.length === 0 ? '<p class="muted" style="padding:.5rem 0">Sem vendas hoje</p>' :
            d.top_produtos.map((p, i) => `
            <div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--c-border)">
              <span style="color:var(--c-primary);font-weight:700;min-width:20px">${i+1}.</span>
              <span style="flex:1">${p.nome}</span>
              <span class="muted">${p.total_vendido}x</span>
            </div>`).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro ao carregar dashboard: ${e.message}</div>`;
  }
}

// ════════════════════════════════════════════════════════════
// PEDIDOS
// ════════════════════════════════════════════════════════════
async function modulo_pedidos(el) {
  try {
    const _pedidosResp = await api('GET', '/pedidos') || [];
    const pedidos = Array.isArray(_pedidosResp) ? _pedidosResp : (_pedidosResp.data || []);
    const abertos = pedidos.filter(p => ['ABERTO','EM_PREPARO','PRONTO'].includes(p.status));
    const fechados = pedidos.filter(p => p.status === 'FECHADO').slice(0, 20);

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">🍽️ Pedidos</span>
        <button class="btn-primario" data-on-click="modalNovoPedido()">+ Novo Pedido</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div>
          <div class="secao-titulo" style="font-size:.85rem;margin-bottom:.75rem">
            EM ABERTO (${abertos.length})
          </div>
          ${abertos.length === 0 ? '<div class="card muted" style="text-align:center;padding:2rem">Sem pedidos activos</div>' :
            abertos.map(p => renderPedidoCard(p)).join('')}
        </div>
        <div>
          <div class="secao-titulo" style="font-size:.85rem;margin-bottom:.75rem">
            FECHADOS HOJE (${fechados.length})
          </div>
          ${fechados.length === 0 ? '<div class="card muted" style="text-align:center;padding:2rem">Sem pedidos fechados</div>' :
            fechados.map(p => renderPedidoCard(p)).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

function renderPedidoCard(p) {
  const itensTexto = (p.itens || []).slice(0, 3).map(i => `${i.quantidade}x ${i.produto_nome}`).join(', ');
  const acoes = p.status === 'ABERTO' ? `
    <button class="btn-secundario" style="padding:.35rem .7rem;font-size:.8rem" data-on-click="mudarStatusPedido('${p.id}','EM_PREPARO')">Em Preparo</button>
    <button class="btn-perigo" style="padding:.35rem .7rem;font-size:.8rem" data-on-click="pedirCancelarPedido('${p.id}')">Cancelar</button>` :
  p.status === 'EM_PREPARO' ? `
    <button class="btn-sucesso" style="padding:.35rem .7rem;font-size:.8rem" data-on-click="mudarStatusPedido('${p.id}','PRONTO')">Pronto</button>` :
  p.status === 'PRONTO' ? `
    <button class="btn-primario" style="padding:.35rem .7rem;font-size:.8rem" data-on-click="mudarStatusPedido('${p.id}','FECHADO')">Fechar</button>` : '';

  return `
    <div class="pedido-card ${p.status}">
      <div class="pedido-header">
        <span class="pedido-mesa">Mesa ${p.mesa_numero || '?'} <span class="texto-pequeno muted">${p.mesa_zona ? '· '+p.mesa_zona : ''}</span></span>
        ${badgeStatus(p.status)}
      </div>
      <div class="pedido-itens">${itensTexto || 'Sem itens'}${(p.itens||[]).length > 3 ? ' …' : ''}</div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="pedido-total">${formatarMoeda(p.total)}</span>
        <span class="pedido-hora">${tempoDesde(p.criado_em)}</span>
      </div>
      <div class="pedido-acoes">${acoes}
        <button class="btn-secundario" style="padding:.35rem .7rem;font-size:.8rem" data-on-click="descarregarPdf('/pedidos/${p.id}/talao.pdf','talao-${String(p.id).slice(0, 8)}.pdf')">🖨 Talão</button>
      </div>
    </div>`;
}

// ── Confirmação obrigatória antes de apagar/cancelar/desactivar: nada destrutivo corre sem um "Sim" explícito ──
// `funcao` é uma função global chamada com argumentos literais (a CSP não permite JS inline).
function modalConfirmar(titulo, texto, funcao, ...args) {
  const lit = args.map(a => `'${String(a).replace(/'/g, '')}'`).join(',');
  abrirModal(titulo, `
    <p style="margin-bottom:1rem">${texto}</p>
    <div style="display:flex;gap:.5rem">
      <button class="btn-perigo" style="flex:1" data-on-click="${funcao}(${lit})">Sim, confirmar</button>
      <button class="btn-secundario" style="flex:1" data-on-click="fecharModal()">Não, voltar</button>
    </div>`);
}

function pedirCancelarPedido(id) {
  modalConfirmar('Cancelar pedido', 'Tem a certeza que quer <b>cancelar este pedido</b>? O stock é devolvido e, se foi pago com Nuk-Coin, o valor é estornado. Não pode ser desfeito.', 'cancelarPedidoConfirmado', id);
}
function cancelarPedidoConfirmado(id) { fecharModal(); mudarStatusPedido(id, 'CANCELADO'); }

async function mudarStatusPedido(id, status) {
  try {
    await api('PATCH', `/pedidos/${id}/status`, { status });
    toast(`Pedido marcado como: ${status}`, 'sucesso');
    carregarModulo('pedidos');
  } catch (e) { toast(e.message, 'erro'); }
}

async function modalNovoPedido() {
  const [mesas, produtos] = await Promise.all([
    api('GET', '/mesas'),
    api('GET', '/produtos?disponivel=true'),
  ]);

  const categorias = [...new Set((produtos||[]).map(p => p.categoria))].sort();

  abrirModal('Novo Pedido', `
    <div class="campo">
      <label>Mesa</label>
      <select id="np-mesa">
        <option value="">— Seleccionar mesa —</option>
        ${(mesas||[]).map(m => `<option value="${m.id}">${m.numero} (${m.zona}) — ${m.status}</option>`).join('')}
      </select>
    </div>
    <div class="campo">
      <label>Filtrar por categoria</label>
      <select id="np-categoria" data-on-change="filtrarProdutosModal(this.value)">
        <option value="">Todas</option>
        ${categorias.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div id="lista-produtos-modal" style="margin-bottom:1rem">
      ${renderProdutosModal(produtos, '')}
    </div>
    <div id="carrinho" style="background:var(--c-bg);border-radius:8px;padding:.75rem;min-height:60px;margin-bottom:1rem">
      <b class="muted texto-pequeno">CARRINHO</b>
      <div id="carrinho-itens" style="margin-top:.5rem">
        <span class="muted texto-pequeno">Sem itens</span>
      </div>
      <div id="carrinho-total" style="text-align:right;font-weight:700;color:var(--c-primary);margin-top:.5rem"></div>
    </div>
    <div class="campo">
      <label>Observações</label>
      <textarea id="np-obs" rows="2" placeholder="Notas especiais..."></textarea>
    </div>
    <button class="btn-primario btn-bloco" data-on-click="confirmarNovoPedido()">Confirmar Pedido</button>
  `);

  window._produtosModal = produtos || [];
  window._carrinhoItens = [];

  // Aplicar mesa pré-seleccionada (quando chamado a partir do modal de mesa)
  if (window._mesaPreSelecionada) {
    const sel = document.getElementById('np-mesa');
    if (sel) sel.value = window._mesaPreSelecionada;
    window._mesaPreSelecionada = null;
  }
}

function renderProdutosModal(prods, cat) {
  const lista = cat ? prods.filter(p => p.categoria === cat) : prods;
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;max-height:250px;overflow-y:auto">
    ${lista.map(p => `
      <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:6px;padding:.6rem;cursor:pointer"
           data-on-click="adicionarAoCarrinho('${p.id}','${p.nome.replace(/'/g,"\\'")}',${p.preco})">
        <div style="font-size:.88rem;font-weight:600">${p.nome}</div>
        <div class="produto-preco">${formatarMoeda(p.preco)}</div>
      </div>`).join('')}
  </div>`;
}

function filtrarProdutosModal(cat) {
  document.getElementById('lista-produtos-modal').innerHTML = renderProdutosModal(window._produtosModal, cat);
}

function adicionarAoCarrinho(id, nome, preco) {
  const existente = window._carrinhoItens.find(i => i.produto_id === id);
  if (existente) existente.quantidade++;
  else window._carrinhoItens.push({ produto_id: id, nome, preco: parseFloat(preco), quantidade: 1 });
  renderCarrinho();
}

function renderCarrinho() {
  const el = document.getElementById('carrinho-itens');
  const totalEl = document.getElementById('carrinho-total');
  if (!window._carrinhoItens.length) {
    el.innerHTML = '<span class="muted texto-pequeno">Sem itens</span>';
    totalEl.textContent = '';
    return;
  }
  let total = 0;
  el.innerHTML = window._carrinhoItens.map((item, i) => {
    const sub = item.preco * item.quantidade;
    total += sub;
    return `<div style="display:flex;align-items:center;gap:.4rem;margin:.2rem 0;font-size:.85rem">
      <button data-on-click="carrinhoRemover(${i})" style="background:none;border:none;color:var(--c-danger);cursor:pointer;font-size:.9rem">✕</button>
      <span style="flex:1">${item.nome}</span>
      <button data-on-click="carrinhoMenos(${i})" style="background:var(--c-surface2);border:none;color:var(--c-text);cursor:pointer;border-radius:4px;padding:0 6px">−</button>
      <span style="min-width:20px;text-align:center">${item.quantidade}</span>
      <button data-on-click="carrinhoMais(${i})" style="background:var(--c-surface2);border:none;color:var(--c-text);cursor:pointer;border-radius:4px;padding:0 6px">+</button>
      <span class="texto-primario" style="min-width:80px;text-align:right">${formatarMoeda(sub)}</span>
    </div>`;
  }).join('');
  totalEl.textContent = 'Total: ' + formatarMoeda(total);
}

async function confirmarNovoPedido() {
  if (!window._carrinhoItens.length) { toast('Adicione itens ao carrinho', 'erro'); return; }
  const mesa_id = document.getElementById('np-mesa').value;
  const observacoes = document.getElementById('np-obs').value;
  try {
    await api('POST', '/pedidos', {
      mesa_id: mesa_id || null,
      itens: window._carrinhoItens.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade })),
      observacoes: observacoes || null,
    });
    toast('Pedido criado!', 'sucesso');
    fecharModal();
    carregarModulo('pedidos');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// MESAS
// ════════════════════════════════════════════════════════════
async function modulo_mesas(el) {
  try {
    const mesas = await api('GET', '/mesas') || [];
    const zonas = [...new Set(mesas.map(m => m.zona || 'Geral'))].sort();

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">🪑 Mesas</span>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${['LIVRE','OCUPADA','LIMPEZA'].map(s => `<span class="status-badge status-${s}">${s}</span>`).join('')}
        </div>
      </div>
      ${zonas.map(zona => {
        const mesasZona = mesas.filter(m => (m.zona || 'Geral') === zona);
        return `
          <div class="mb-2">
            <div class="secao-titulo" style="font-size:.8rem;color:var(--c-muted);margin-bottom:.5rem">${zona.toUpperCase()} (${mesasZona.length})</div>
            <div class="grid-cards">
              ${mesasZona.map(m => `
                <div class="mesa-card ${m.status}" data-on-click="modalMesa('${m.id}','${m.numero}','${m.status}')">
                  <div class="card-numero">${m.numero}</div>
                  <div class="card-zona">${m.capacidade} lugares</div>
                  <div class="status-badge status-${m.status}" style="font-size:.7rem;margin-top:.3rem">${m.status}</div>
                  ${parseInt(m.pedidos_activos) > 0 ? `<div class="card-pedidos" style="margin-top:.2rem">${m.pedidos_activos} pedido(s)</div>` : ''}
                </div>`).join('')}
            </div>
          </div>`;
      }).join('')}
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

function modalMesa(id, numero, statusActual) {
  const statuses = ['LIVRE','OCUPADA','RESERVADA','LIMPEZA','MANUTENCAO'];
  abrirModal(`Mesa ${numero}`, `
    <p class="muted mb-2">Estado actual: ${badgeStatus(statusActual)}</p>
    <div class="campo">
      <label>Alterar estado para</label>
      <select id="nova-status-mesa">
        ${statuses.map(s => `<option value="${s}" ${s === statusActual ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.5rem">
      <button class="btn-primario" style="flex:1" data-on-click="salvarStatusMesa('${id}')">Actualizar</button>
      <button class="btn-secundario" data-on-click="fecharModal()">Cancelar</button>
    </div>
    <hr style="border-color:var(--c-border);margin:1rem 0">
    <button class="btn-primario btn-bloco" data-on-click="novoPedidoNaMesa('${id}')">
      + Novo Pedido nesta mesa
    </button>
  `);
}

async function salvarStatusMesa(id) {
  const status = document.getElementById('nova-status-mesa').value;
  try {
    await api('PATCH', `/mesas/${id}/status`, { status });
    toast('Estado da mesa actualizado', 'sucesso');
    fecharModal();
    carregarModulo('mesas');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// QUARTOS
// ════════════════════════════════════════════════════════════
async function modulo_quartos(el) {
  try {
    const quartos = await api('GET', '/quartos') || [];
    window._quartos = quartos;
    const tipos = [...new Set(quartos.map(q => q.tipo))].sort();
    const u = NUK.utilizador || {};
    const chefia = ['ADMIN', 'GERENTE'].includes(u.nivel_acesso);
    const porArrumar = quartos.filter(q => q.status === 'LIMPEZA');
    const meus = porArrumar.filter(q => (q.limpeza && q.limpeza.escalado) ? chefia : (u.arruma_quartos || (!q.limpeza && chefia)));

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">🛏️ Quartos</span>
        <span class="quartos-legenda muted texto-pequeno"><span class="estrela amarela">★</span> reservado &nbsp; <span class="estrela vermelha">★</span> reserva em menos de 1 h (vendas bloqueadas)</span>
      </div>
      ${meus.length ? `<div class="quartos-aviso">🧹 ${meus.length === 1 ? 'Um quarto por arrumar' : meus.length + ' quartos por arrumar'}: ${meus.map(q => `<b>${esc(q.numero)}</b>`).join(', ')} — toque no quarto para o dar como limpo.</div>` : ''}
      ${quartos.length ? '' : '<div class="muted" style="padding:2rem;text-align:center">Ainda não há quartos. Um Administrador pode criá-los em <b>⚙️ Configurações → Quartos e preços</b>.</div>'}
      ${tipos.map(tipo => {
        const qs = quartos.filter(q => q.tipo === tipo);
        return `
          <div class="mb-2">
            <div class="secao-titulo" style="font-size:.8rem;color:var(--c-muted);margin-bottom:.5rem">${esc(tipo.replace(/_/g,' '))} (${qs.length})</div>
            <div class="grid-cards">${qs.map(htmlBotaoQuarto).join('')}</div>
          </div>`;
      }).join('')}
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`;
  }
}

// Hora local (HH:MM; com dd/mm quando não é hoje)
function horaQuarto(x) {
  const d = new Date(x), h = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? h : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${h}`;
}
const NOME_ESTADO_QUARTO = { DISPONIVEL: 'Disponível', OCUPADO: 'Ocupado', LIMPEZA: 'A arrumar', MANUTENCAO: 'Em manutenção', BLOQUEADO: 'Bloqueado' };
function textoEstadoQuarto(q) {
  if (q.status === 'OCUPADO' && q.livre_as) return `Ocupado · livre às ${horaQuarto(q.livre_as)}`;
  if (q.status === 'LIMPEZA' && q.limpeza) return q.limpeza.escalado ? 'A arrumar · prazo excedido' : `A arrumar · até ${horaQuarto(q.livre_as)}`;
  return NOME_ESTADO_QUARTO[q.status] || q.status;
}
// Segunda linha do botão, por baixo do estado: a hora a que o quarto fica livre / o prazo de arrumação
function subtextoLivreQuarto(q) {
  if (q.status === 'OCUPADO') return q.livre_as ? `livre às ${horaQuarto(q.livre_as)}` : 'hora por definir';
  if (q.status === 'LIMPEZA' && q.limpeza) return q.limpeza.escalado ? 'prazo excedido' : `livre às ${horaQuarto(q.livre_as)}`;
  return '';
}
function htmlBotaoQuarto(q) {
  const estrela = q.estrela ? `<div class="estrela ${q.estrela === 'VERMELHA' ? 'vermelha' : 'amarela'}" title="${q.estrela === 'VERMELHA' ? 'Reserva em menos de 1 hora: vendas bloqueadas' : 'Reservado para um período'}">★ reservado</div>` : '<div class="estrela vazia">&nbsp;</div>';
  return `
    <div class="quarto-card ${esc(q.status)} ${q.limpeza && q.limpeza.escalado ? 'escalado' : ''}" data-on-click="modalQuarto('${esc(q.id)}')">
      <div class="card-numero">${esc(q.numero)}</div>
      <div class="card-tipo">${esc(q.tipo.replace(/_/g, ' '))}</div>
      <div class="quarto-estado">${esc(NOME_ESTADO_QUARTO[q.status] || q.status)}</div>
      <div class="quarto-livre">${esc(subtextoLivreQuarto(q))}</div>
      ${estrela}
    </div>`;
}

const FRACOES_QUARTO = { DUAS_HORAS: ['Hora', '2 h', 'preco_2h'], PERNOITE: ['Noite', '12 h', 'preco_pernoite'], DIARIA: ['Diária', '24 h', 'preco_diaria'] };
const quartoPorId = id => (window._quartos || []).find(q => q.id === id);

// Clique no botão do quarto: estado, serviço (Hora/Noite/Diária) e as acções Vender / Reservar / Abrir Quarto
function modalQuarto(id) {
  const q = quartoPorId(id);
  if (!q) return;
  const u = NUK.utilizador || {};
  const chefia = ['ADMIN', 'GERENTE'].includes(u.nivel_acesso);
  window._quartoSel = { id, fracao: null };
  const vende = !!u.pode_vender_quartos;
  const bloqueio = q.venda_bloqueada || (q.status !== 'DISPONIVEL' ? NOME_ESTADO_QUARTO[q.status] : null);
  const podeVender = vende && q.status === 'DISPONIVEL' && !q.venda_bloqueada;
  const podeReservar = vende && !['MANUTENCAO', 'BLOQUEADO'].includes(q.status);
  const podeAbrir = vende && q.status === 'OCUPADO';

  const escalado = q.limpeza && q.limpeza.escalado;
  const podeLimpar = q.status === 'LIMPEZA' && (q.limpeza ? (escalado ? chefia : !!u.arruma_quartos) : (chefia || !!u.arruma_quartos));
  const reservas = (q.reservas_futuras || []).map(r => {
    const perto = new Date(r.checkin) - Date.now() <= 3600e3;
    return `<div class="quarto-reserva">
      <div><b>${horaQuarto(r.checkin)}</b> → ${horaQuarto(r.checkout)} · ${esc(FRACOES_QUARTO[r.fracao][0])}${r.nome_hospede ? ' · ' + esc(r.nome_hospede) : ''}</div>
      ${vende ? `<div class="row-acoes">
        ${perto && q.status === 'DISPONIVEL' ? `<button class="btn-primario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="entradaReservaQuarto('${esc(r.id)}')">Dar entrada</button>` : ''}
        <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="pedirCancelarReservaQuarto('${esc(r.id)}')">Cancelar</button>
      </div>` : ''}
    </div>`;
  }).join('');

  abrirModal(`Quarto ${q.numero} — ${q.tipo.replace(/_/g, ' ')}`, `
    <p class="mb-2">${badgeStatus(q.status)} <span class="muted">${esc(textoEstadoQuarto(q))}</span></p>
    ${q.ocupacao ? `<p class="muted texto-pequeno mb-2">Em curso: ${horaQuarto(q.ocupacao.checkin)} → ${horaQuarto(q.ocupacao.checkout)} · ${esc(FRACOES_QUARTO[q.ocupacao.fracao][0])}${q.ocupacao.nome_hospede ? ' · ' + esc(q.ocupacao.nome_hospede) : ''}</p>` : ''}
    ${q.status === 'LIMPEZA' ? `<div class="quartos-aviso">${escalado ? '⚠️ O prazo de arrumação terminou: só um gerente ou supervisor pode abrir este quarto.' : `🧹 Arrumar até às ${horaQuarto(q.livre_as)}.`}
      ${podeLimpar ? '<button class="btn-primario btn-bloco" style="margin-top:.5rem" data-on-click="pedirQuartoLimpo()">Dar como limpo e disponível</button>' : '<div class="muted texto-pequeno" style="margin-top:.4rem">Só quem tem o perfil de arrumação o pode dar como limpo.</div>'}</div>` : ''}
    <div class="campo"><label>Serviço</label>
      <div class="servicos-quarto">
        ${Object.entries(FRACOES_QUARTO).map(([k, [nome, dur, col]]) => `
          <button type="button" class="servico-quarto" id="srv-${k}" data-on-click="escolherServicoQuarto('${k}')"><b>${nome}</b><span>${dur}</span><span>${formatarMoeda(q[col])}</span></button>`).join('')}
      </div>
    </div>
    ${!vende ? '<p class="muted texto-pequeno mb-2">Não tem o perfil «Vender quartos». O Administrador activa-o na sua ficha de funcionário.</p>' : (bloqueio && !podeReservar ? `<p class="muted texto-pequeno mb-2">${esc(bloqueio)}</p>` : '')}
    ${vende && q.venda_bloqueada ? `<p class="aviso-vermelho mb-2">★ ${esc(q.venda_bloqueada)}</p>` : ''}
    <div class="acoes-quarto">
      <button class="btn-primario" ${podeVender ? '' : 'disabled'} data-on-click="passoQuarto('VENDER')">Vender</button>
      <button class="btn-secundario" ${podeReservar ? '' : 'disabled'} data-on-click="passoQuarto('RESERVAR')">Reservar</button>
      <button class="btn-secundario" ${podeAbrir ? '' : 'disabled'} data-on-click="passoQuarto('ABRIR')" title="O cliente saiu antes da hora">Abrir Quarto</button>
    </div>
    <div id="passo-quarto"></div>
    ${reservas ? `<div class="campo" style="margin-top:1rem"><label>Reservas</label>${reservas}</div>` : ''}
    ${chefia ? `<details style="margin-top:1rem"><summary class="muted texto-pequeno">Estado manual (manutenção / bloqueio)</summary>
      <div class="campo" style="margin-top:.5rem"><select id="novo-status-quarto">${['DISPONIVEL', 'MANUTENCAO', 'BLOQUEADO'].map(s => `<option value="${s}" ${s === q.status ? 'selected' : ''}>${NOME_ESTADO_QUARTO[s]}</option>`).join('')}</select></div>
      <button class="btn-secundario" data-on-click="salvarStatusQuarto('${esc(q.id)}')">Actualizar estado</button></details>` : ''}
  `);
}

function escolherServicoQuarto(fracao) {
  if (!window._quartoSel) return;
  window._quartoSel.fracao = fracao;
  Object.keys(FRACOES_QUARTO).forEach(k => document.getElementById(`srv-${k}`)?.classList.toggle('activo', k === fracao));
}

// Passo seguinte depois de escolher o serviço e a acção
function passoQuarto(acao) {
  const sel = window._quartoSel, q = sel && quartoPorId(sel.id), alvo = document.getElementById('passo-quarto');
  if (!q || !alvo) return;
  if (acao === 'ABRIR') {
    alvo.innerHTML = `<div class="quartos-aviso"><b>Abrir o quarto ${esc(q.numero)}?</b> O cliente sai antes da hora: o quarto passa a «a arrumar» e a equipa de arrumação é avisada (30 min para o dar como limpo).
      <div style="display:flex;gap:.5rem;margin-top:.6rem"><button class="btn-perigo" style="flex:1" data-on-click="confirmarAbrirQuarto()">Sim, abrir</button><button class="btn-secundario" style="flex:1" data-on-click="fecharPassoQuarto()">Não, voltar</button></div></div>`;
    return;
  }
  if (!sel.fracao) { toast('Escolha primeiro o serviço: Hora, Noite ou Diária', 'aviso'); return; }
  const [nome, dur, col] = FRACOES_QUARTO[sel.fracao];
  const inicio = acao === 'RESERVAR' ? `<div class="campo"><label>Início da reserva *</label><input type="datetime-local" id="pq-inicio" value="${horaLocalInput(new Date(Date.now() + 3600e3 * 3))}"></div>` : '';
  alvo.innerHTML = `<div class="quartos-passo">
    <div class="mb-2"><b>${acao === 'VENDER' ? 'Vender' : 'Reservar'} · ${nome} (${dur})</b> — <span style="color:var(--c-primary);font-weight:700">${formatarMoeda(q[col])}</span></div>
    ${inicio}
    <div class="campo"><label>Nome do hóspede</label><input type="text" id="pq-nome" maxlength="200" placeholder="Opcional"></div>
    <div class="campo"><label>Observações</label><input type="text" id="pq-obs" maxlength="300"></div>
    <div style="display:flex;gap:.5rem"><button class="btn-primario" style="flex:1" data-on-click="confirmarPassoQuarto('${acao}')">Confirmar ${acao === 'VENDER' ? 'venda' : 'reserva'}</button><button class="btn-secundario" data-on-click="fecharPassoQuarto()">Voltar</button></div></div>`;
}
const horaLocalInput = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function fecharPassoQuarto() { const a = document.getElementById('passo-quarto'); if (a) a.innerHTML = ''; }

async function confirmarPassoQuarto(acao) {
  const sel = window._quartoSel;
  if (!sel) return;
  const corpo = { fracao: sel.fracao, nome_hospede: document.getElementById('pq-nome').value.trim() || undefined, observacoes: document.getElementById('pq-obs').value.trim() || undefined };
  try {
    if (acao === 'RESERVAR') {
      const v = document.getElementById('pq-inicio').value;
      if (!v) { toast('Indique o início da reserva', 'erro'); return; }
      corpo.inicio = new Date(v).toISOString();
    }
    await api('POST', `/quartos/${sel.id}/${acao === 'VENDER' ? 'vender' : 'reservar'}`, corpo);
    toast(acao === 'VENDER' ? 'Venda registada' : 'Reserva registada', 'sucesso');
    fecharModal();
    carregarModulo('quartos');
  } catch (e) { toast(e.message, 'erro'); carregarModulo('quartos'); }
}

async function confirmarAbrirQuarto() {
  const sel = window._quartoSel;
  try {
    await api('POST', `/quartos/${sel.id}/abrir`);
    toast('Quarto aberto — equipa de arrumação avisada', 'sucesso');
    fecharModal();
    carregarModulo('quartos');
  } catch (e) { toast(e.message, 'erro'); }
}

function pedirQuartoLimpo() {
  const q = quartoPorId(window._quartoSel && window._quartoSel.id);
  if (q) modalConfirmar('Dar quarto como limpo', `O quarto <b>${esc(q.numero)}</b> fica <b>limpo e disponível</b> para venda. Confirma?`, 'confirmarQuartoLimpo', q.id);
}
async function confirmarQuartoLimpo(id) {
  fecharModal();
  try {
    const r = await api('POST', `/quartos/${id}/limpo`);
    toast(r && r.atraso_min ? `Quarto disponível (atraso de ${r.atraso_min} min registado)` : 'Quarto limpo e disponível', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
  carregarModulo('quartos');
}

async function entradaReservaQuarto(id) {
  try { await api('POST', `/quartos/reservas/${id}/entrada`); toast('Entrada registada', 'sucesso'); fecharModal(); }
  catch (e) { toast(e.message, 'erro'); }
  carregarModulo('quartos');
}
function pedirCancelarReservaQuarto(id) {
  modalConfirmar('Cancelar reserva', 'Tem a certeza que quer <b>cancelar esta reserva</b>?', 'cancelarReservaQuarto', id);
}
async function cancelarReservaQuarto(id) {
  fecharModal();
  try { await api('POST', `/quartos/reservas/${id}/cancelar`); toast('Reserva cancelada', 'sucesso'); }
  catch (e) { toast(e.message, 'erro'); }
  carregarModulo('quartos');
}

// ── Listas configuráveis (tipos de quarto, categorias, unidades): opções activas + a actual mesmo se desactivada ──
async function opcoesLista(lista, actual) {
  const ops = await api('GET', `/listas/${lista}`) || [];
  const valores = ops.filter(o => o.ativo).map(o => o.valor);
  if (actual && !valores.includes(actual)) valores.unshift(actual);
  return valores;
}
const htmlOpcoes = (valores, sel) => valores.map(v => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(String(v).replace(/_/g, ' '))}</option>`).join('');


async function modalFormQuarto(id) {
  let q = { numero: '', tipo: 'STANDARD', andar: 0, preco_2h: '', preco_pernoite: '', preco_diaria: '', descricao: '' };
  if (id) {
    const lista = await api('GET', '/quartos') || [];
    q = lista.find(x => x.id === id) || q;
  }
  const tipos = await opcoesLista('TIPO_QUARTO', q.tipo);
  abrirModal(id ? `Editar quarto ${esc(q.numero)}` : 'Novo quarto', `
    <div class="campo"><label>Número / nome *</label><input type="text" id="qf-numero" maxlength="10" value="${esc(q.numero)}" placeholder="Ex.: 101"></div>
    <div class="campo"><label>Tipo *</label>
      <select id="qf-tipo">${htmlOpcoes(tipos, q.tipo)}</select>
    </div>
    <div class="campo"><label>Andar</label><input type="number" id="qf-andar" value="${esc(q.andar)}"></div>
    <div class="campo"><label>Preço 2 horas (Kz) *</label><input type="number" min="0" step="any" id="qf-p2h" value="${esc(q.preco_2h)}"></div>
    <div class="campo"><label>Preço pernoite (Kz) *</label><input type="number" min="0" step="any" id="qf-ppern" value="${esc(q.preco_pernoite)}"></div>
    <div class="campo"><label>Preço diária (Kz) *</label><input type="number" min="0" step="any" id="qf-pdia" value="${esc(q.preco_diaria)}"></div>
    <div class="campo"><label>Descrição</label><input type="text" id="qf-desc" maxlength="500" value="${esc(q.descricao)}"></div>
    <div style="display:flex;gap:.5rem;margin-top:.5rem">
      <button class="btn-primario" style="flex:1" data-on-click="guardarQuarto('${id}')">Guardar</button>
      <button class="btn-secundario" data-on-click="fecharModal()">Cancelar</button>
    </div>
    ${id ? `<button class="btn-secundario btn-bloco" style="margin-top:.75rem;color:var(--c-erro,#e55)" data-on-click="pedirApagarQuarto('${id}')">🗑 Apagar quarto</button>` : ''}
  `);
}

async function guardarQuarto(id) {
  const v = i => document.getElementById(i).value;
  const dados = {
    numero: v('qf-numero').trim(), tipo: v('qf-tipo'), andar: v('qf-andar') === '' ? 0 : Number(v('qf-andar')),
    preco_2h: v('qf-p2h'), preco_pernoite: v('qf-ppern'), preco_diaria: v('qf-pdia'), descricao: v('qf-desc'),
  };
  try {
    await api(id ? 'PUT' : 'POST', id ? `/quartos/${id}` : '/quartos', dados);
    toast(id ? 'Quarto actualizado' : 'Quarto criado', 'sucesso');
    fecharModal();
    carregarModulo('configuracoes');
  } catch (e) {
    toast(e.message || 'Erro ao guardar quarto', 'erro');
  }
}

function pedirApagarQuarto(id) {
  modalConfirmar('Apagar quarto', 'Tem a certeza que quer <b>apagar este quarto</b>? Não pode ser desfeito.', 'apagarQuarto', id);
}

async function apagarQuarto(id) {
  fecharModal();
  try {
    await api('DELETE', `/quartos/${id}`);
    toast('Quarto apagado', 'sucesso');
    fecharModal();
    carregarModulo('configuracoes');
  } catch (e) {
    toast(e.message || 'Erro ao apagar quarto', 'erro');
  }
}

async function salvarStatusQuarto(id) {
  const status = document.getElementById('novo-status-quarto').value;
  try {
    await api('PATCH', `/quartos/${id}/status`, { status });
    toast('Estado actualizado', 'sucesso');
  } catch (e) {
    toast(e.message || 'Erro ao actualizar estado', 'erro');
  }
  fecharModal();
  carregarModulo('quartos');
}

// ════════════════════════════════════════════════════════════
// PRODUTOS
// ════════════════════════════════════════════════════════════
// Tabela de produtos agrupada por categoria. `gerir` = botões de configuração (só no painel de Configurações).
function htmlEmentaProdutos(produtos, gerir) {
  const categorias = [...new Set(produtos.map(p => p.categoria))].sort();
  if (!categorias.length) return '<div class="muted" style="padding:1rem">Ainda não há produtos.' + (gerir ? '' : ' O Administrador cria-os em ⚙️ Configurações → Ementa.') + '</div>';
  return categorias.map(cat => {
    const prods = produtos.filter(p => p.categoria === cat);
    return `
      <div class="mb-2">
        <div class="secao-titulo" style="font-size:.8rem;margin-bottom:.5rem">${cat} (${prods.length})</div>
        <div class="card tabela-wrapper">
          <table>
            <thead><tr><th>Nome</th><th>Preço</th><th>Estado</th>${gerir ? '<th>Acções</th>' : ''}</tr></thead>
            <tbody>
              ${prods.map(p => `
                <tr>
                  <td>${p.nome}${p.descricao ? `<div class="muted texto-pequeno">${p.descricao}</div>` : ''}</td>
                  <td class="produto-preco">${formatarMoeda(p.preco)}</td>
                  <td>${p.disponivel ? '<span class="status-badge status-LIVRE">Disponível</span>' : '<span class="status-badge status-FECHADO">Indisponível</span>'}</td>
                  ${gerir ? `<td><div class="row-acoes">
                    <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalEditarProduto('${p.id}','${p.nome.replace(/'/g,"\\'")}',${p.preco},'${p.categoria}',${p.disponivel})">Editar</button>
                    <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalIngredientes('${p.id}')">Stock</button>
                    <button class="btn-${p.disponivel ? 'perigo' : 'sucesso'}" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="toggleDisponibilidade('${p.id}',${p.disponivel})">${p.disponivel ? 'Ocultar' : 'Mostrar'}</button>
                  </div></td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

// Consulta da ementa (todos os perfis): só leitura e pesquisa. A gestão vive em Configurações → Ementa.
async function modulo_produtos(el) {
  try {
    const produtos = await api('GET', '/produtos') || [];
    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">📋 Produtos / Menu</span>
        <input type="text" class="input-pesquisa" placeholder="Pesquisar..." data-on-input="filtrarProdutosTabela(this.value)" id="pesq-produtos">
      </div>
      ${htmlEmentaProdutos(produtos, false)}
    `;
    window._todosProdutos = produtos;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

function filtrarProdutosTabela(q) {
  const termo = q.toLowerCase();
  document.querySelectorAll('tbody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(termo) ? '' : 'none';
  });
}

// ── Receita do produto: o que cada venda abate do stock ──
let _ingrSeq = 0;
function _linhaIngrediente(itens, sel, qtd) {
  const id = 'ing-' + (++_ingrSeq);
  return `<div class="row-acoes campo" id="${id}" style="margin-bottom:.4rem;gap:.4rem;align-items:center">
    <select class="ingr-item" style="flex:1;width:auto">${itens.map(i => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.nome)} (${esc(i.unidade || '')})</option>`).join('')}</select>
    <input type="number" class="ingr-qtd" min="0" step="0.001" value="${esc(qtd)}" placeholder="Qtd por unidade" style="width:8rem">
    <button class="btn-perigo" style="padding:.3rem .6rem" data-on-click="removerLinhaIngrediente('${id}')">✕</button>
  </div>`;
}
async function modalIngredientes(produtoId) {
  try {
    const [stockResp, receita] = await Promise.all([api('GET', '/stock'), api('GET', `/produtos/${produtoId}/ingredientes`)]);
    const itens = Array.isArray(stockResp) ? stockResp : (stockResp.data || []);
    if (!itens.length) { toast('Crie primeiro os itens no módulo Stock.', 'aviso'); return; }
    window._ingrItens = itens;
    abrirModal('Stock consumido por venda', `
      <p class="muted texto-pequeno" style="margin-bottom:.6rem">O que sai do stock cada vez que se vende 1 unidade deste produto. Sem linhas, a venda não mexe no stock.</p>
      <div id="ingr-linhas">${(receita || []).map(r => _linhaIngrediente(itens, r.stock_item_id, r.quantidade)).join('')}</div>
      <button class="btn-secundario" data-on-click="adicionarLinhaIngrediente()">+ Ingrediente</button>
      <div class="modal-acoes" style="margin-top:1rem">
        <button class="btn-secundario" data-on-click="fecharModal()">Cancelar</button>
        <button class="btn-primario" data-on-click="guardarIngredientes('${esc(produtoId)}')">Guardar</button>
      </div>`);
  } catch (e) { toast(e.message, 'erro'); }
}
function adicionarLinhaIngrediente() {
  const itens = window._ingrItens || [];
  document.getElementById('ingr-linhas').insertAdjacentHTML('beforeend', _linhaIngrediente(itens, itens[0] && itens[0].id, ''));
}
function removerLinhaIngrediente(id) { const el = document.getElementById(id); if (el) el.remove(); }
async function guardarIngredientes(produtoId) {
  const ingredientes = [...document.querySelectorAll('#ingr-linhas > div')].map(d => ({
    stock_item_id: d.querySelector('.ingr-item').value,
    quantidade: parseFloat(d.querySelector('.ingr-qtd').value),
  }));
  if (ingredientes.some(i => !(i.quantidade > 0))) { toast('Indique a quantidade de cada ingrediente (maior que zero).', 'erro'); return; }
  try {
    await api('PUT', `/produtos/${produtoId}/ingredientes`, { ingredientes });
    fecharModal(); toast('Stock do produto guardado', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
}

async function modalNovoProduto() {
  const cats = await opcoesLista('CATEGORIA_PRODUTO');
  abrirModal('Novo Produto', `
    <div class="campo"><label>Nome</label><input type="text" id="np-nome" placeholder="Nome do produto"></div>
    <div class="campo"><label>Categoria</label>
      <select id="np-cat">
        ${htmlOpcoes(cats)}
      </select>
    </div>
    <div class="campo"><label>Preço (Kz)</label><input type="number" id="np-preco" placeholder="0" min="0"></div>
    <div class="campo"><label>Descrição</label><textarea id="np-desc" rows="2" placeholder="Opcional"></textarea></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarNovoProduto()">Guardar</button>
  `);
}

async function guardarNovoProduto() {
  const nome = document.getElementById('np-nome').value;
  const categoria = document.getElementById('np-cat').value;
  const preco = document.getElementById('np-preco').value;
  const descricao = document.getElementById('np-desc').value;
  if (!nome || !preco) { toast('Preencha nome e preço', 'erro'); return; }
  try {
    await api('POST', '/produtos', { nome, categoria, preco: parseFloat(preco), descricao });
    toast('Produto criado!', 'sucesso');
    fecharModal();
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message, 'erro'); }
}

async function modalEditarProduto(id, nome, preco, categoria, disponivel) {
  const cats = await opcoesLista('CATEGORIA_PRODUTO', categoria);
  abrirModal('Editar Produto', `
    <div class="campo"><label>Nome</label><input type="text" id="ep-nome" value="${nome}"></div>
    <div class="campo"><label>Categoria</label>
      <select id="ep-cat">
        ${htmlOpcoes(cats, categoria)}
      </select>
    </div>
    <div class="campo"><label>Preço (Kz)</label><input type="number" id="ep-preco" value="${preco}" min="0"></div>
    <div class="campo"><label>Disponível</label>
      <select id="ep-disp"><option value="true" ${disponivel ? 'selected' : ''}>Sim</option><option value="false" ${!disponivel ? 'selected' : ''}>Não</option></select>
    </div>
    <button class="btn-primario btn-bloco" data-on-click="salvarEdicaoProduto('${id}')">Guardar</button>
  `);
}

async function salvarEdicaoProduto(id) {
  const nome = document.getElementById('ep-nome').value;
  const categoria = document.getElementById('ep-cat').value;
  const preco = parseFloat(document.getElementById('ep-preco').value);
  const disponivel = document.getElementById('ep-disp').value === 'true';
  try {
    await api('PUT', `/produtos/${id}`, { nome, categoria, preco, disponivel });
    toast('Produto actualizado!', 'sucesso');
    fecharModal();
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message, 'erro'); }
}

async function toggleDisponibilidade(id, atual) {
  try {
    await api('PUT', `/produtos/${id}`, { disponivel: !atual });
    toast(`Produto ${!atual ? 'disponível' : 'oculto'}`, 'sucesso');
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// STOCK
// ════════════════════════════════════════════════════════════
async function modulo_stock(el) {
  try {
    const _stockResp = await api('GET', '/stock') || [];
    const items = Array.isArray(_stockResp) ? _stockResp : (_stockResp.data || []);
    const isAdmin = ['ADMIN','GERENTE'].includes(NUK.utilizador.nivel_acesso);
    const alertas = items.filter(i => i.alerta_stock);
    if (alertas.length) {
      document.getElementById('badge-stock').style.display = 'inline-block';
    } else {
      document.getElementById('badge-stock').style.display = 'none';
    }

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">📦 Stock</span>
        ${isAdmin ? '<button class="btn-primario" data-on-click="modalNovoStockItem()">+ Novo Item</button>' : ''}
        ${alertas.length > 0 ? `<span class="status-badge status-LIMPEZA">⚠️ ${alertas.length} alertas de stock baixo</span>` : ''}
      </div>
      <div class="card tabela-wrapper">
        <table>
          <thead><tr><th>Item</th><th>Categoria</th><th>Stock Actual</th><th>Mínimo</th><th>Unidade</th><th>Estado</th><th>Acções</th></tr></thead>
          <tbody>
            ${items.map(i => `
              <tr style="${i.alerta_stock ? 'background:rgba(245,158,11,.05)' : ''}">
                <td><b>${i.nome}</b>${i.fornecedor ? `<div class="muted texto-pequeno">${i.fornecedor}</div>` : ''}</td>
                <td>${i.categoria}</td>
                <td class="${i.alerta_stock ? 'texto-aviso negrito' : ''}">${i.stock_atual} ${i.unidade}</td>
                <td class="muted">${i.stock_minimo} ${i.unidade}</td>
                <td>${i.unidade}</td>
                <td>${i.alerta_stock ? '<span class="status-badge status-LIMPEZA">⚠️ Baixo</span>' : '<span class="status-badge status-LIVRE">OK</span>'}</td>
                <td><div class="row-acoes">
                  <button class="btn-sucesso" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalMovimentoStock('${i.id}','${i.nome.replace(/'/g,"\\'")}','${i.unidade}','COMPRA')">+ Entrada</button>
                  <button class="btn-perigo" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalMovimentoStock('${i.id}','${i.nome.replace(/'/g,"\\'")}','${i.unidade}','AJUSTE')">Ajuste</button>
                </div></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

async function modalNovoStockItem() {
  const cats = await opcoesLista('CATEGORIA_STOCK');
  const uns = await opcoesLista('UNIDADE_STOCK');
  abrirModal('Novo Item de Stock', `
    <div class="campo"><label>Nome</label><input type="text" id="si-nome"></div>
    <div class="campo"><label>Categoria</label>
      <select id="si-cat">
        ${htmlOpcoes(cats)}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="campo"><label>Stock Actual</label><input type="number" id="si-atual" value="0" min="0" step="0.001"></div>
      <div class="campo"><label>Stock Mínimo</label><input type="number" id="si-min" value="0" min="0" step="0.001"></div>
    </div>
    <div class="campo"><label>Unidade</label>
      <select id="si-un">${htmlOpcoes(uns)}</select>
    </div>
    <div class="campo"><label>Fornecedor</label><input type="text" id="si-forn" placeholder="Opcional"></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarNovoStockItem()">Guardar</button>
  `);
}

async function guardarNovoStockItem() {
  const nome = document.getElementById('si-nome').value;
  const categoria = document.getElementById('si-cat').value;
  const stock_atual = parseFloat(document.getElementById('si-atual').value) || 0;
  const stock_minimo = parseFloat(document.getElementById('si-min').value) || 0;
  const unidade = document.getElementById('si-un').value;
  const fornecedor = document.getElementById('si-forn').value;
  if (!nome) { toast('Nome é obrigatório', 'erro'); return; }
  try {
    await api('POST', '/stock', { nome, categoria, stock_atual, stock_minimo, unidade, fornecedor: fornecedor || null });
    toast('Item criado!', 'sucesso');
    fecharModal();
    carregarModulo('stock');
  } catch (e) { toast(e.message, 'erro'); }
}

function modalMovimentoStock(id, nome, unidade, tipo) {
  abrirModal(`${tipo === 'COMPRA' ? '📦 Entrada' : '🔧 Ajuste'} — ${nome}`, `
    <div class="campo"><label>Tipo</label>
      <select id="mv-tipo">
        <option value="COMPRA" ${tipo==='COMPRA'?'selected':''}>Entrada / Compra</option>
        <option value="AJUSTE" ${tipo==='AJUSTE'?'selected':''}>Ajuste</option>
        <option value="DESPERDICIO">Desperdício</option>
        <option value="INVENTARIO">Inventário</option>
      </select>
    </div>
    <div class="campo"><label>Quantidade (${unidade})</label><input type="number" id="mv-qty" value="1" min="0.001" step="0.001"></div>
    <div class="campo"><label>Motivo / Notas</label><textarea id="mv-motivo" rows="2"></textarea></div>
    <button class="btn-primario btn-bloco" data-on-click="confirmarMovimento('${id}')">Registar Movimento</button>
  `);
}

async function confirmarMovimento(id) {
  const tipo = document.getElementById('mv-tipo').value;
  const quantidade = parseFloat(document.getElementById('mv-qty').value);
  const motivo = document.getElementById('mv-motivo').value;
  if (!quantidade || quantidade <= 0) { toast('Quantidade inválida', 'erro'); return; }
  try {
    await api('POST', `/stock/${id}/movimento`, { tipo, quantidade, motivo });
    toast('Movimento registado!', 'sucesso');
    fecharModal();
    carregarModulo('stock');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// FINANCEIRO
// ════════════════════════════════════════════════════════════
async function modulo_financeiro(el) {
  const hoje = new Date().toISOString().split('T')[0];
  try {
    const [resumo, faturas] = await Promise.all([
      api('GET', `/financeiro/resumo?data=${hoje}`),
      api('GET', '/financeiro/faturas'),
    ]);

    el.innerHTML = `
      <div class="secao-titulo">💰 Financeiro</div>
      <div class="kpi-grid mb-3">
        <div class="kpi-card">
          <div class="kpi-label">Receita Total Hoje</div>
          <div class="kpi-valor texto-primario">${formatarMoeda(resumo.pedidos.receita_total)}</div>
          <div class="kpi-sub">${resumo.pedidos.total_pedidos} pedidos · ${resumo.pedidos.pedidos_fechados} fechados</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Receita Quartos Hoje</div>
          <div class="kpi-valor texto-primario">${formatarMoeda(resumo.quartos.receita_quartos)}</div>
          <div class="kpi-sub">${resumo.quartos.total_reservas} reservas</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Geral Hoje</div>
          <div class="kpi-valor">${formatarMoeda(parseFloat(resumo.pedidos.receita_total||0) + parseFloat(resumo.quartos.receita_quartos||0))}</div>
          <div class="kpi-sub">IVA incl. (14%)</div>
        </div>
      </div>

      ${resumo.por_categoria.length ? `
      <div class="card mb-3">
        <div class="card-header"><span class="card-titulo">Vendas por Categoria</span></div>
        <div class="tabela-wrapper">
          <table>
            <thead><tr><th>Categoria</th><th>Itens Vendidos</th><th>Total</th></tr></thead>
            <tbody>
              ${resumo.por_categoria.map(c => `
                <tr>
                  <td>${c.categoria}</td>
                  <td>${c.itens_vendidos}</td>
                  <td class="texto-primario negrito">${formatarMoeda(c.total)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-header">
          <span class="card-titulo">Últimas Facturas</span>
          <button class="btn-primario" style="padding:.3rem .75rem;font-size:.78rem" data-on-click="modalNovaFatura()">+ Emitir Factura</button>
        </div>
        <div class="tabela-wrapper">
          <table>
            <thead><tr><th>Nº Factura</th><th>Cliente</th><th>IVA</th><th>Total</th><th>Data</th><th></th></tr></thead>
            <tbody>
              ${(faturas||[]).slice(0,20).map(f => `
                <tr>
                  <td class="negrito">${f.numero_fatura}</td>
                  <td>${f.nome_cliente || f.cliente_nome || '—'}</td>
                  <td class="muted">${formatarMoeda(f.iva)}</td>
                  <td class="texto-primario negrito">${formatarMoeda(f.total)}</td>
                  <td class="muted">${formatarData(f.emitida_em)}</td>
                  <td><button class="btn-secundario" style="padding:.25rem .6rem;font-size:.75rem" data-on-click="descarregarPdf('/financeiro/faturas/${f.id}/pdf','factura-${String(f.numero_fatura).replace(/[^0-9]/g, '')}.pdf')">PDF</button></td>
                </tr>`).join('')}
              ${!faturas?.length ? '<tr><td colspan="6" class="muted" style="text-align:center;padding:1rem">Sem facturas</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

function modalNovaFatura() {
  abrirModal('Emitir Factura', `
    <div class="campo"><label>Nome do Cliente</label><input type="text" id="fat-nome" placeholder="Nome completo"></div>
    <div class="campo"><label>NIF do Cliente</label><input type="text" id="fat-nif" placeholder="Opcional"></div>
    <div class="campo"><label>Valor Total (Kz)</label><input type="number" id="fat-total" placeholder="0" min="0"></div>
    <p class="muted texto-pequeno mb-2">IVA de 14% calculado automaticamente</p>
    <button class="btn-primario btn-bloco" data-on-click="emitirFatura()">Emitir</button>
  `);
}

async function emitirFatura() {
  const nome_cliente = document.getElementById('fat-nome').value;
  const nif_cliente = document.getElementById('fat-nif').value;
  const total = parseFloat(document.getElementById('fat-total').value) || 0;
  if (!total) { toast('Valor inválido', 'erro'); return; }
  // Criar reserva temporária ou pedido avulso
  try {
    await api('POST', '/financeiro/faturas', { nome_cliente, nif_cliente, total_manual: total });
    toast('Factura emitida!', 'sucesso');
    fecharModal();
    carregarModulo('financeiro');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// CLIENTES
// ════════════════════════════════════════════════════════════
const NUKCOIN_VALORES = [5000, 10000, 15000, 20000, 25000, 50000];

function linhaCliente(c) {
  return `
    <tr>
      <td class="negrito">${esc(c.nome)}</td>
      <td>${esc(c.telefone) || '—'}</td>
      <td><span class="fidelizacao-${esc(c.nivel_fidelizacao)}">★ ${esc(c.nivel_fidelizacao)}</span></td>
      <td>⭐ ${Number(c.estrelas) || 0}</td>
      <td class="texto-primario">💜 ${formatarMoeda(c.nukcoin_saldo || 0)}</td>
      <td class="muted">${formatarData(c.criado_em).split(',')[0]}</td>
      <td>
        <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalCarregarNukcoin('${esc(c.id)}')">Carregar Nuk-Coin</button>
        <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="reporPinCliente('${esc(c.id)}')">Repor PIN</button>
      </td>
    </tr>`;
}

async function modulo_clientes(el) {
  try {
    const _clientesResp = await api('GET', '/clientes') || [];
    const clientes = Array.isArray(_clientesResp) ? _clientesResp : (_clientesResp.data || []);
    window._clientesCache = clientes;

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">👥 Clientes</span>
        <button class="btn-primario" data-on-click="modalNovoCliente()">+ Novo Cliente</button>
        <input type="text" class="input-pesquisa" placeholder="Pesquisar..." data-on-input="pesquisarClientes(this.value)">
      </div>
      <div class="card tabela-wrapper">
        <table id="tab-clientes">
          <thead><tr><th>Nome</th><th>Telefone</th><th>Nível</th><th>Estrelas</th><th>Nuk-Coin</th><th>Registado em</th><th>Acções</th></tr></thead>
          <tbody>
            ${clientes.map(linhaCliente).join('')}
            ${!clientes.length ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:1rem">Sem clientes</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`;
  }
}

function modalCarregarNukcoin(id) {
  const c = (window._clientesCache || []).find(x => x.id === id);
  if (!c) return;
  abrirModal('Carregar Nuk-Coin', `
    <p style="margin-bottom:.8rem"><strong>${esc(c.nome)}</strong> — saldo actual: 💜 ${formatarMoeda(c.nukcoin_saldo || 0)}</p>
    <p class="muted" style="margin-bottom:.6rem">Receba o dinheiro no balcão e escolha o valor a creditar:</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
      ${NUKCOIN_VALORES.map(v => `<button class="btn-primario" data-on-click="carregarNukcoin('${esc(id)}',${v})">${formatarMoeda(v)}</button>`).join('')}
    </div>
  `);
}

async function carregarNukcoin(id, valor) {
  try {
    const r = await api('POST', '/cliente/nukcoin/carregar', { cliente_id: id, valor });
    toast(r.mensagem || 'Carregado!', 'sucesso');
    fecharModal();
    carregarModulo('clientes');
  } catch (e) { toast(e.message, 'erro'); }
}

async function reporPinCliente(id) {
  if (!confirm('Repor o PIN deste cliente? Ele define um novo PIN no próximo acesso.')) return;
  try {
    const r = await api('POST', '/cliente/reset-pin', { cliente_id: id });
    toast(r.mensagem || 'PIN reposto', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
}

async function pesquisarClientes(q) {
  if (q.length < 2) return;
  try {
    const _cResp = await api('GET', `/clientes?q=${encodeURIComponent(q)}`) || [];
    const clientes = Array.isArray(_cResp) ? _cResp : (_cResp.data || []);
    const tbody = document.querySelector('#tab-clientes tbody');
    window._clientesCache = clientes;
    if (tbody) tbody.innerHTML = clientes.map(linhaCliente).join('') || '<tr><td colspan="7" class="muted" style="text-align:center">Sem resultados</td></tr>';
  } catch {}
}

function modalNovoCliente() {
  abrirModal('Novo Cliente', `
    <div class="campo"><label>Nome</label><input type="text" id="nc-nome" placeholder="Nome completo"></div>
    <div class="campo"><label>Telefone</label><input type="tel" id="nc-tel" placeholder="+244 9xx xxx xxx"></div>
    <div class="campo"><label>Email</label><input type="email" id="nc-email" placeholder="email@exemplo.com"></div>
    <div class="campo"><label>NIF</label><input type="text" id="nc-nif" placeholder="Opcional"></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarNovoCliente()">Guardar</button>
  `);
}

async function guardarNovoCliente() {
  const nome = document.getElementById('nc-nome').value;
  const telefone = document.getElementById('nc-tel').value;
  const email = document.getElementById('nc-email').value;
  const nif = document.getElementById('nc-nif').value;
  if (!nome) { toast('Nome é obrigatório', 'erro'); return; }
  try {
    await api('POST', '/clientes', { nome, telefone: telefone||null, email: email||null, nif: nif||null });
    toast('Cliente registado!', 'sucesso');
    fecharModal();
    carregarModulo('clientes');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// SOLICITAÇÕES DO PORTAL (hospedagem, serviços e eventos pedidos pelo cliente)
// ════════════════════════════════════════════════════════════
const ROTULO_SOLICITACAO = { HOSPEDAGEM: '🛏️ Hospedagem', SERVICO: '🛎️ Serviço', EVENTO: '🎉 Evento' };
NUK.filtroSolicitacoes = 'PENDENTE';

async function modulo_solicitacoes(el) {
  try {
    const estado = NUK.filtroSolicitacoes;
    const r = await api('GET', `/solicitacoes-portal?limit=100${estado ? '&status=' + encodeURIComponent(estado) : ''}`);
    const lista = r.data || [];
    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">🔔 Solicitações do portal</span>
        <select class="input-pesquisa" data-on-change="filtrarSolicitacoes(this.value)">
          ${[['PENDENTE', 'Por tratar'], ['CONFIRMADA', 'Confirmadas'], ['CANCELADA', 'Canceladas'], ['', 'Todas']]
            .map(([v, t]) => `<option value="${v}" ${v === estado ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="card tabela-wrapper">
        <table>
          <thead><tr><th>Há</th><th>Tipo</th><th>Pedido</th><th>Cliente</th><th>Telefone</th><th>Estado</th><th>Acções</th></tr></thead>
          <tbody>
            ${lista.map(linhaSolicitacao).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:1rem">Sem solicitações</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    actualizarBadgeSolicitacoes();
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`;
  }
}

function linhaSolicitacao(s) {
  const porTratar = s.status === 'PENDENTE';
  return `<tr>
    <td>${tempoDesde(s.criado_em)}</td>
    <td>${ROTULO_SOLICITACAO[s.tipo] || esc(s.tipo)}</td>
    <td><strong>${esc(s.nome_servico)}</strong></td>
    <td>${esc(s.nome_contacto)}</td>
    <td>${esc(s.telefone_contacto)}</td>
    <td>${badgeStatus(s.status)}</td>
    <td>${porTratar
      ? `<button class="btn-primario" data-on-click="actualizarSolicitacao('${esc(s.id)}','CONFIRMADA')">Confirmar</button> <button class="btn-secundario" data-on-click="pedirCancelarSolicitacao('${esc(s.id)}')">Cancelar</button>`
      : ''}</td>
  </tr>`;
}

function filtrarSolicitacoes(estado) {
  NUK.filtroSolicitacoes = estado;
  carregarModulo('solicitacoes');
}

function pedirCancelarSolicitacao(id) {
  modalConfirmar('Cancelar solicitação', 'Tem a certeza que quer <b>cancelar esta solicitação</b>?', 'cancelarSolicitacaoConfirmada', id);
}
function cancelarSolicitacaoConfirmada(id) { fecharModal(); actualizarSolicitacao(id, 'CANCELADA'); }

async function actualizarSolicitacao(id, status) {
  try {
    await api('PATCH', `/solicitacoes-portal/${id}/status`, { status });
    toast(status === 'CONFIRMADA' ? 'Solicitação confirmada' : 'Solicitação cancelada', 'sucesso');
    carregarModulo('solicitacoes');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// FUNCIONÁRIOS
// ════════════════════════════════════════════════════════════
async function modulo_funcionarios(el) {
  if (!['ADMIN','GERENTE'].includes(NUK.utilizador.nivel_acesso)) {
    el.innerHTML = '<div class="erro-msg">Acesso restrito</div>';
    return;
  }
  try {
    const lista = await api('GET', '/funcionarios') || [];
    window._funcionarios = lista;
    window._acessosMeta = await api('GET', '/funcionarios/acessos').catch(() => null);

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">👨‍💼 Funcionários</span>
        <button class="btn-primario" data-on-click="modalNovoFuncionario()">+ Novo Funcionário</button>
      </div>
      <div class="card tabela-wrapper">
        <table>
          <thead><tr><th>Nome</th><th>Cargo</th><th>Nível</th><th>Avaliação</th><th>Estado</th><th>Último Acesso</th><th>Acções</th></tr></thead>
          <tbody>
            ${lista.map(f => `
              <tr>
                <td><b>${f.nome}</b>${f.titular ? ' <span class="status-badge status-CONFIRMADA" title="Conta titular do estabelecimento">Titular</span>' : ''}<div class="muted texto-pequeno">${f.email}</div>${f.pode_vender_quartos ? '<span class="muted texto-pequeno">🛏 vende quartos </span>' : ''}${f.arruma_quartos ? '<span class="muted texto-pequeno">🧹 arruma quartos</span>' : ''}</td>
                <td>${f.cargo || '—'}</td>
                <td><span class="status-badge ${f.nivel_acesso === 'ADMIN' ? 'status-CONFIRMADA' : f.nivel_acesso === 'GERENTE' ? 'status-EM_PREPARO' : 'status-LIVRE'}">${f.nivel_acesso}</span></td>
                <td>★ ${parseFloat(f.media_avaliacao||0).toFixed(1)} <span class="muted">(${f.total_avaliacoes})</span></td>
                <td>${f.ativo ? '<span class="status-badge status-LIVRE">Activo</span>' : '<span class="status-badge status-FECHADO">Inactivo</span>'}</td>
                <td class="muted">${f.ultimo_acesso ? formatarData(f.ultimo_acesso) : 'Nunca'}</td>
                <td><div class="row-acoes">
                  ${(f.nivel_acesso === 'ADMIN' && !NUK.utilizador.titular) ? '' : `<button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalEditarFuncionario('${f.id}')">Editar</button>`}
                  ${(f.nivel_acesso === 'ADMIN' && !NUK.utilizador.titular) ? '' : f.titular ? (NUK.utilizador.titular ? '<button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalTransferirTitularidade()">Transferir titularidade</button>' : '') : `<button class="btn-${f.ativo ? 'perigo' : 'sucesso'}" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="${f.ativo ? `pedirDesactivarFunc('${f.id}')` : `toggleActivarFunc('${f.id}',false)`}">${f.ativo ? 'Desactivar' : 'Activar'}</button>`}
                </div></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}


// ── Acessos delegados: o titular fixa o limite dos administradores; estes atribuem dentro desse limite ──
function htmlAcessos(prefixo, seleccionados, nivel, bloqueado) {
  const m = window._acessosMeta;
  if (!m) return '';
  const caixa = k => `<label><input type="checkbox" id="${prefixo}-ac-${k}" ${seleccionados.includes(k) ? 'checked' : ''} ${bloqueado || !m.meu_limite.includes(k) ? 'disabled' : ''}> ${esc(m.rotulos[k] || k)}</label>`;
  return `<div class="campo" id="${prefixo}-wrap"><label>${nivel === 'ADMIN' ? 'Acessos (limite do administrador)' : 'Acessos'}</label>
    <div class="acessos-grid" id="${prefixo}-acessos">${m.modulos.map(caixa).join('')}${nivel === 'ADMIN' ? m.capacidades.map(caixa).join('') : ''}</div>
    <div class="muted texto-pequeno" style="margin-top:.3rem">${bloqueado ? 'Este funcionário tem acessos acima do seu limite: só o titular os pode alterar.' : m.sou_titular ? 'Como titular, define o que cada administrador pode dar aos restantes funcionários.' : 'Só pode atribuir os acessos que o titular lhe delegou (os restantes estão desactivados).'}</div></div>`;
}
function lerAcessos(prefixo) {
  const m = window._acessosMeta;
  if (!m || !document.getElementById(`${prefixo}-acessos`)) return undefined;
  return [...m.modulos, ...m.capacidades].filter(k => { const c = document.getElementById(`${prefixo}-ac-${k}`); return c && c.checked && !c.disabled; });
}
// Ao mudar o nível, propõe os acessos predefinidos desse nível dentro do limite de quem atribui
function actualizarAcessosForm(prefixo) {
  const m = window._acessosMeta, nivel = document.getElementById(`${prefixo}-nivel`).value;
  if (!m) return;
  const alvo = document.getElementById(`${prefixo}-wrap`);
  if (alvo) alvo.outerHTML = htmlAcessos(prefixo, (m.padrao[nivel] || []).filter(k => m.meu_limite.includes(k)), nivel, false);
}

function modalNovoFuncionario() {
  abrirModal('Novo Funcionário', `
    <div class="campo"><label>Nome</label><input type="text" id="nf-nome"></div>
    <div class="campo"><label>Email</label><input type="email" id="nf-email"></div>
    <div class="campo"><label>Senha</label><input type="password" id="nf-senha" placeholder="Mínimo 8 caracteres"></div>
    <div class="campo"><label>Cargo</label><input type="text" id="nf-cargo" placeholder="Ex: Empregado de Mesa"></div>
    <div class="campo"><label>Nível de Acesso</label>
      <select id="nf-nivel" data-on-change="actualizarAcessosForm('nf')">
        <option value="OPERADOR">Operador</option>
        <option value="GERENTE">Gerente</option>
        ${window._acessosMeta && !window._acessosMeta.sou_titular ? '' : '<option value="ADMIN">Admin</option>'}
      </select>
    </div>
    ${htmlAcessos('nf', window._acessosMeta ? window._acessosMeta.padrao.OPERADOR.filter(k => window._acessosMeta.meu_limite.includes(k)) : [], 'OPERADOR', false)}
    <div class="campo"><label>Salário (Kz)</label><input type="number" id="nf-sal" value="200000" min="0"></div>
    <div class="campo"><label><input type="checkbox" id="nf-vq"> Pode vender/reservar/abrir quartos</label></div>
    <div class="campo"><label><input type="checkbox" id="nf-aq"> Arruma quartos (recebe os avisos de limpeza)</label></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarNovoFuncionario()">Guardar</button>
  `);
}

async function guardarNovoFuncionario() {
  const nome = document.getElementById('nf-nome').value;
  const email = document.getElementById('nf-email').value;
  const password = document.getElementById('nf-senha').value;
  const cargo = document.getElementById('nf-cargo').value;
  const nivel_acesso = document.getElementById('nf-nivel').value;
  const salario = parseFloat(document.getElementById('nf-sal').value) || 0;
  if (!nome || !email || !password || password.length < 8) { toast('Preencha todos os campos (senha ≥ 8 chars)', 'erro'); return; }
  try {
    await api('POST', '/funcionarios', { nome, email, password, cargo, nivel_acesso, salario,
      pode_vender_quartos: document.getElementById('nf-vq').checked, arruma_quartos: document.getElementById('nf-aq').checked, permissoes: lerAcessos('nf') });
    toast('Funcionário criado!', 'sucesso');
    fecharModal();
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

function modalEditarFuncionario(id) {
  const f = (window._funcionarios || []).find(x => x.id === id);
  if (!f) return;
  const campoNivel = f.titular
    ? '<div class="campo"><label>Nível</label><input type="text" value="ADMIN (titular)" disabled><div class="muted texto-pequeno">O titular mantém-se Administrador. Para mudar, transfira a titularidade.</div></div><input type="hidden" id="ef-nivel" value="ADMIN">'
    : `<div class="campo"><label>Nível</label><select id="ef-nivel" ${window._acessosMeta && !window._acessosMeta.sou_titular ? 'disabled' : ''} data-on-change="actualizarAcessosForm('ef')">${['OPERADOR','GERENTE','ADMIN'].map(n => `<option value="${n}" ${n===f.nivel_acesso?'selected':''}>${n}</option>`).join('')}</select></div>`;
  abrirModal('Editar Funcionário', `
    <div class="campo"><label>Nome</label><input type="text" id="ef-nome" value="${esc(f.nome)}"></div>
    <div class="campo"><label>Cargo</label><input type="text" id="ef-cargo" value="${esc(f.cargo || '')}"></div>
    ${campoNivel}
    <div class="campo"><label>Salário (Kz)</label><input type="number" id="ef-sal" value="${esc(f.salario || 0)}" min="0"></div>
    <div class="campo"><label><input type="checkbox" id="ef-vq" ${f.pode_vender_quartos ? 'checked' : ''}> Pode vender/reservar/abrir quartos</label></div>
    <div class="campo"><label><input type="checkbox" id="ef-aq" ${f.arruma_quartos ? 'checked' : ''}> Arruma quartos (recebe os avisos de limpeza)</label></div>
    ${f.titular ? '' : htmlAcessos('ef', f.acessos || [], f.nivel_acesso, !!window._acessosMeta && !window._acessosMeta.sou_titular && (f.acessos || []).some(k => !window._acessosMeta.meu_limite.includes(k)))}
    <div class="campo"><label>Nova Senha (deixar vazio para não alterar)</label><input type="password" id="ef-senha" placeholder="Mínimo 8 caracteres"></div>
    <button class="btn-primario btn-bloco" data-on-click="salvarEdicaoFuncionario('${id}')">Guardar</button>
  `);
}

function modalTransferirTitularidade() {
  const alvos = (window._funcionarios || []).filter(f => f.ativo && !f.titular);
  abrirModal('Transferir titularidade', `
    <p class="muted" style="margin-bottom:.75rem">A conta titular é a primeira conta do estabelecimento e não pode ser apagada: só passa para outra pessoa. O novo titular fica Administrador e você mantém a sua conta.</p>
    <div class="campo"><label>Novo titular</label>
      <select id="tt-novo">${alvos.length ? alvos.map(f => `<option value="${esc(f.id)}">${esc(f.nome)} — ${esc(f.email)}</option>`).join('') : '<option value="">Sem outros funcionários activos</option>'}</select>
    </div>
    <div class="campo"><label>A sua palavra-passe (confirmação)</label><input type="password" id="tt-senha" autocomplete="current-password"></div>
    <button class="btn-perigo btn-bloco" data-on-click="confirmarTransferirTitularidade()">Transferir titularidade</button>
  `);
}

async function confirmarTransferirTitularidade() {
  const novo = document.getElementById('tt-novo').value;
  const password = document.getElementById('tt-senha').value;
  if (!novo || !password) { toast('Escolha o novo titular e escreva a sua palavra-passe', 'erro'); return; }
  try {
    const r = await api('POST', '/funcionarios/transferir-titularidade', { novo_titular_id: novo, password });
    NUK.utilizador.titular = false;
    toast(`${r.nome} é agora o titular`, 'sucesso');
    fecharModal();
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

async function salvarEdicaoFuncionario(id) {
  const nome = document.getElementById('ef-nome').value;
  const cargo = document.getElementById('ef-cargo').value;
  const nivel_acesso = document.getElementById('ef-nivel').value;
  const salario = parseFloat(document.getElementById('ef-sal').value) || 0;
  const password = document.getElementById('ef-senha').value;
  const dados = { nome, cargo, nivel_acesso, salario,
    pode_vender_quartos: document.getElementById('ef-vq').checked, arruma_quartos: document.getElementById('ef-aq').checked };
  if (password) dados.password = password;
  const acessos = lerAcessos('ef');
  if (acessos) dados.permissoes = acessos;
  try {
    await api('PUT', `/funcionarios/${id}`, dados);
    toast('Funcionário actualizado!', 'sucesso');
    fecharModal();
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

function pedirDesactivarFunc(id) {
  modalConfirmar('Desactivar funcionário', 'Tem a certeza que quer <b>desactivar este funcionário</b>? Deixa de poder entrar no sistema.', 'desactivarFuncConfirmado', id);
}
function desactivarFuncConfirmado(id) { fecharModal(); toggleActivarFunc(id, true); }

async function toggleActivarFunc(id, ativo) {
  try {
    await api('PUT', `/funcionarios/${id}`, { ativo: !ativo });
    toast(`Funcionário ${!ativo ? 'activado' : 'desactivado'}`, 'sucesso');
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ════════════════════════════════════════════════════════════
async function modulo_configuracoes(el) {
  if (!['ADMIN'].includes(NUK.utilizador.nivel_acesso)) {
    el.innerHTML = '<div class="erro-msg">Acesso restrito ao Administrador</div>';
    return;
  }
  try {
    const cfg = await api('GET', '/configuracoes');
    const quartos = await api('GET', '/quartos') || [];
    const produtos = await api('GET', '/produtos') || [];
    const listas = await api('GET', '/listas') || {};
    const dsh = await api('GET', '/dashboard/itens') || { itens: [], servicos: {} };
    window._cfgDash = { produtos, categorias: (listas.CATEGORIA_PRODUTO?.opcoes || []).filter(o => o.ativo).map(o => o.valor), servicos: dsh.servicos };

    el.innerHTML = `
      <div class="secao-titulo">⚙️ Configurações</div>
      <div class="card" style="max-width:500px">
        <div class="campo"><label>Nome do Estabelecimento</label>
          <input type="text" id="cfg-nome" value="${cfg.nome_estabelecimento || ''}">
        </div>
        <div class="campo"><label>Taxa de IVA (%)</label>
          <input type="number" id="cfg-iva" value="${cfg.iva_padrao || 14}" min="0" max="100" step="0.1">
        </div>
        <div class="campo"><label>Moeda</label>
          <input type="text" id="cfg-moeda" value="${cfg.moeda || 'Kz'}">
        </div>
        <div class="campo"><label>Fuso Horário</label>
          <input type="text" id="cfg-tz" value="${cfg.timezone || 'Africa/Luanda'}" readonly>
        </div>
        <button class="btn-primario" data-on-click="guardarConfiguracoes()">Guardar Configurações</button>
      </div>

      <div class="card mt-2" style="max-width:700px">
        <div class="card-titulo mb-2">DASHBOARD — ITENS A CONTROLAR</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.75rem">Cada item aparece no Dashboard com a comparação de hoje, ontem e do mesmo dia da semana passada. Pode controlar um produto, uma categoria, vendas de quartos ou criar contadores manuais (ex.: pessoas na piscina) e pendências (ex.: reclamações).</div>
        ${dsh.itens.length ? dsh.itens.map(i => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--c-border)">
            <div style="min-width:0"><b>${esc(i.nome)}</b> <span class="muted" style="font-size:.78rem">${esc(descreverItemDashboard(i, dsh.servicos, produtos))}</span></div>
            <div class="row-acoes">
              <button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="alternarItemDashboard('${esc(i.id)}',${i.ativo})">${i.ativo ? 'Ocultar' : 'Mostrar'}</button>
              <button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="pedirRemoverItemDashboard('${esc(i.id)}')">✕</button>
            </div>
          </div>`).join('') : '<div class="muted" style="margin-bottom:.5rem">Ainda não há itens. Acrescente o primeiro abaixo.</div>'}
        <div style="margin-top:.9rem">
          <div class="campo"><label>Nome do item</label><input type="text" id="dsh-nome" maxlength="80" placeholder="Ex.: Venda de Shishas"></div>
          <div class="campo"><label>O que controlar</label><select id="dsh-fonte" data-on-change="actualizarRefDashboard()">
            <option value="PRODUTO">Um produto</option>
            <option value="CATEGORIA">Uma categoria de produtos</option>
            <option value="SERVICO">Vendas de quartos / pedidos do portal</option>
            <option value="CONTADOR">Contador manual (ex.: pessoas na piscina)</option>
            <option value="PENDENCIA">Pendências (ex.: reclamações abertas e tratadas)</option>
          </select></div>
          <div class="campo"><select id="dsh-ref">${htmlOpcoesDashboard('PRODUTO')}</select></div>
          <button class="btn-secundario" data-on-click="adicionarItemDashboard()">+ Adicionar ao Dashboard</button>
        </div>
      </div>

      <div class="card mt-2" style="max-width:700px">
        <div class="card-titulo mb-2">LISTAS (ADAPTE AO SEU ESTABELECIMENTO)</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.75rem">Estas opções aparecem nos formulários de quartos, produtos e stock. Uma opção em uso não se apaga — oculte-a.</div>
        ${Object.entries(listas).map(([lista, l]) => `
          <div style="margin-bottom:1rem">
            <div style="font-weight:600;margin-bottom:.4rem">${l.nome}</div>
            <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.5rem">
              ${l.opcoes.map(o => `
                <span class="status-badge ${o.ativo ? 'status-LIVRE' : 'status-FECHADO'}" style="display:inline-flex;align-items:center;gap:.35rem">
                  ${esc(String(o.valor).replace(/_/g, ' '))}
                  <button class="btn-secundario" style="padding:0 .35rem;font-size:.7rem" title="${o.ativo ? 'Ocultar' : 'Mostrar'}" data-on-click="alternarOpcaoLista('${lista}','${o.id}',${o.ativo})">${o.ativo ? '👁' : '🚫'}</button>
                  <button class="btn-secundario" style="padding:0 .35rem;font-size:.7rem" title="Apagar" data-on-click="pedirApagarOpcaoLista('${lista}','${o.id}')">✕</button>
                </span>`).join('')}
            </div>
            <div style="display:flex;gap:.5rem">
              <input type="text" id="lst-${lista}" maxlength="30" placeholder="Nova opção" style="flex:1">
              <button class="btn-secundario" data-on-click="adicionarOpcaoLista('${lista}')">+ Adicionar</button>
            </div>
          </div>`).join('')}
      </div>

      <div class="card mt-2" style="max-width:500px">
        <div class="toolbar" style="margin-bottom:.5rem">
          <div class="card-titulo">QUARTOS E PREÇOS</div>
          <button class="btn-secundario" data-on-click="modalFormQuarto('')">+ Novo Quarto</button>
        </div>
        ${quartos.length ? quartos.map(q => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.4rem 0">
            <div style="min-width:0"><b>${q.numero}</b> <span class="muted">${q.tipo.replace(/_/g,' ')}</span>
              <div class="muted" style="font-size:.8rem">${formatarMoeda(q.preco_2h)}/2h · ${formatarMoeda(q.preco_pernoite)} pernoite · ${formatarMoeda(q.preco_diaria)} diária</div></div>
            <button class="btn-secundario" data-on-click="modalFormQuarto('${q.id}')">Editar</button>
          </div>`).join('') : '<div class="muted">Ainda não há quartos. Crie o primeiro.</div>'}
      </div>

      <div class="card mt-2">
        <div class="toolbar" style="margin-bottom:.5rem">
          <div class="card-titulo">EMENTA (PRODUTOS, PREÇOS E RECEITAS)</div>
          <button class="btn-primario" data-on-click="modalNovoProduto()">+ Novo Produto</button>
          <input type="text" class="input-pesquisa" placeholder="Pesquisar produto..." data-on-input="filtrarProdutosTabela(this.value)">
        </div>
        ${htmlEmentaProdutos(produtos, true)}
      </div>

      <div class="card mt-2" style="max-width:500px">
        <div class="card-titulo mb-2">INFORMAÇÕES DO SISTEMA</div>
        <div class="muted" style="font-size:.88rem">
          <div>Versão: <b>${cfg.versao || '1.0.0'}</b></div>
          <div>Stack: Node.js + Express + PostgreSQL</div>
          <div>Deploy: Render</div>
          <div>Admin: admin@nukpos.ao</div>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

function descreverItemDashboard(i, servicos, produtos) {
  if (i.fonte === 'PRODUTO') return 'produto: ' + ((produtos.find(p => p.id === i.ref) || {}).nome || '?');
  if (i.fonte === 'CATEGORIA') return 'categoria: ' + String(i.ref).replace(/_/g, ' ');
  if (i.fonte === 'SERVICO') return servicos[i.ref] || i.ref;
  return i.fonte === 'CONTADOR' ? 'contador manual' : 'pendências (abertas/tratadas)';
}
function htmlOpcoesDashboard(fonte) {
  const c = window._cfgDash || { produtos: [], categorias: [], servicos: {} };
  if (fonte === 'PRODUTO') return c.produtos.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('') || '<option value="">Sem produtos</option>';
  if (fonte === 'CATEGORIA') return c.categorias.map(v => `<option value="${esc(v)}">${esc(String(v).replace(/_/g, ' '))}</option>`).join('');
  if (fonte === 'SERVICO') return Object.entries(c.servicos).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  return '<option value="">—</option>';
}
function actualizarRefDashboard() {
  const f = document.getElementById('dsh-fonte').value;
  const ref = document.getElementById('dsh-ref');
  ref.innerHTML = htmlOpcoesDashboard(f);
  ref.style.display = (f === 'CONTADOR' || f === 'PENDENCIA') ? 'none' : '';
}
async function adicionarItemDashboard() {
  const nome = document.getElementById('dsh-nome').value;
  const fonte = document.getElementById('dsh-fonte').value;
  const ref = document.getElementById('dsh-ref').value || null;
  try {
    await api('POST', '/dashboard/itens', { nome, fonte, ref });
    toast('Item adicionado ao Dashboard', 'sucesso');
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message || 'Erro ao adicionar', 'erro'); }
}
async function alternarItemDashboard(id, ativo) {
  try { await api('PUT', `/dashboard/itens/${id}`, { ativo: !ativo }); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message || 'Erro ao actualizar', 'erro'); }
}
function pedirRemoverItemDashboard(id) {
  modalConfirmar('Remover item do Dashboard', 'Tem a certeza que quer <b>remover este item</b> e o seu histórico de registos manuais? Não pode ser desfeito. (Para o esconder sem perder dados, use «Ocultar».)', 'removerItemDashboard', id);
}
async function removerItemDashboard(id) {
  fecharModal();
  try { await api('DELETE', `/dashboard/itens/${id}`); toast('Item removido', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message || 'Erro ao remover', 'erro'); }
}

async function adicionarOpcaoLista(lista) {
  const campo = document.getElementById('lst-' + lista);
  try {
    await api('POST', `/listas/${lista}`, { nome: campo.value });
    toast('Opção adicionada', 'sucesso');
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message || 'Erro ao adicionar', 'erro'); }
}
async function alternarOpcaoLista(lista, id, ativo) {
  try {
    await api('PUT', `/listas/${lista}/${id}`, { ativo: !ativo });
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message || 'Erro ao actualizar', 'erro'); }
}
function pedirApagarOpcaoLista(lista, id) {
  modalConfirmar('Apagar opção', 'Tem a certeza que quer <b>apagar esta opção</b> da lista? Não pode ser desfeito.', 'apagarOpcaoLista', lista, id);
}
async function apagarOpcaoLista(lista, id) {
  fecharModal();
  try {
    await api('DELETE', `/listas/${lista}/${id}`);
    toast('Opção apagada', 'sucesso');
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message || 'Erro ao apagar', 'erro'); }
}

async function guardarConfiguracoes() {
  const dados = {
    nome_estabelecimento: document.getElementById('cfg-nome').value,
    iva_padrao: document.getElementById('cfg-iva').value,
    moeda: document.getElementById('cfg-moeda').value,
  };
  try {
    await api('PUT', '/configuracoes', dados);
    toast('Configurações guardadas!', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
}


// ── Acções do carrinho / atalhos (chamadas via data-on-click; a CSP não permite JS inline) ──
function carrinhoMenos(i) { const it = window._carrinhoItens[i]; if (it) { it.quantidade = Math.max(1, it.quantidade - 1); renderCarrinho(); } }
function carrinhoMais(i) { const it = window._carrinhoItens[i]; if (it) { it.quantidade++; renderCarrinho(); } }
function carrinhoRemover(i) { window._carrinhoItens.splice(i, 1); renderCarrinho(); }
function novoPedidoNaMesa(id) { fecharModal(); window._mesaPreSelecionada = id; modalNovoPedido(); }
