// Nuk_POS — Módulos da Interface
// Dashboard, Pedidos, Mesas, Quartos, Produtos, Stock, Financeiro, Clientes, Funcionários, Configs

'use strict';

// ════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════
async function modulo_dashboard(el) {
  try {
    const d = await api('GET', '/dashboard');
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
          <div class="kpi-sub"><button class="btn-primario" style="padding:.3rem .75rem;font-size:.78rem" onclick="carregarModulo('stock')">Ver stock</button></div>
        </div>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div class="card">
          <div class="card-header"><span class="card-titulo">Pedidos em Aberto</span>
            <button class="btn-primario" style="padding:.3rem .75rem;font-size:.78rem" onclick="carregarModulo('pedidos')">Ver todos</button></div>
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
        <button class="btn-primario" onclick="modalNovoPedido()">+ Novo Pedido</button>
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
    <button class="btn-secundario" style="padding:.35rem .7rem;font-size:.8rem" onclick="mudarStatusPedido('${p.id}','EM_PREPARO')">Em Preparo</button>
    <button class="btn-perigo" style="padding:.35rem .7rem;font-size:.8rem" onclick="mudarStatusPedido('${p.id}','CANCELADO')">Cancelar</button>` :
  p.status === 'EM_PREPARO' ? `
    <button class="btn-sucesso" style="padding:.35rem .7rem;font-size:.8rem" onclick="mudarStatusPedido('${p.id}','PRONTO')">Pronto</button>` :
  p.status === 'PRONTO' ? `
    <button class="btn-primario" style="padding:.35rem .7rem;font-size:.8rem" onclick="mudarStatusPedido('${p.id}','FECHADO')">Fechar</button>` : '';

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
      ${acoes ? `<div class="pedido-acoes">${acoes}</div>` : ''}
    </div>`;
}

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
      <select id="np-categoria" onchange="filtrarProdutosModal(this.value)">
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
    <button class="btn-primario btn-bloco" onclick="confirmarNovoPedido()">Confirmar Pedido</button>
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
           onclick="adicionarAoCarrinho('${p.id}','${p.nome.replace(/'/g,"\\'")}',${p.preco})">
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
      <button onclick="window._carrinhoItens.splice(${i},1);renderCarrinho()" style="background:none;border:none;color:var(--c-danger);cursor:pointer;font-size:.9rem">✕</button>
      <span style="flex:1">${item.nome}</span>
      <button onclick="window._carrinhoItens[${i}].quantidade=Math.max(1,window._carrinhoItens[${i}].quantidade-1);renderCarrinho()" style="background:var(--c-surface2);border:none;color:var(--c-text);cursor:pointer;border-radius:4px;padding:0 6px">−</button>
      <span style="min-width:20px;text-align:center">${item.quantidade}</span>
      <button onclick="window._carrinhoItens[${i}].quantidade++;renderCarrinho()" style="background:var(--c-surface2);border:none;color:var(--c-text);cursor:pointer;border-radius:4px;padding:0 6px">+</button>
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
                <div class="mesa-card ${m.status}" onclick="modalMesa('${m.id}','${m.numero}','${m.status}')">
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
      <button class="btn-primario" style="flex:1" onclick="salvarStatusMesa('${id}')">Actualizar</button>
      <button class="btn-secundario" onclick="fecharModal()">Cancelar</button>
    </div>
    <hr style="border-color:var(--c-border);margin:1rem 0">
    <button class="btn-primario btn-bloco" onclick="fecharModal();window._mesaPreSelecionada='${id}';modalNovoPedido()">
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
    const tipos = [...new Set(quartos.map(q => q.tipo))].sort();

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">🛏️ Quartos</span>
        <button class="btn-primario" onclick="modalNovaReserva()">+ Nova Reserva</button>
      </div>
      ${tipos.map(tipo => {
        const qs = quartos.filter(q => q.tipo === tipo);
        return `
          <div class="mb-2">
            <div class="secao-titulo" style="font-size:.8rem;color:var(--c-muted);margin-bottom:.5rem">${tipo.replace(/_/g,' ')} (${qs.length})</div>
            <div class="grid-cards">
              ${qs.map(q => `
                <div class="quarto-card ${q.status}" onclick="modalQuarto('${q.id}','${q.numero}','${q.tipo}','${q.status}')">
                  <div class="card-numero">${q.numero}</div>
                  <div class="card-tipo">${q.tipo.replace(/_/g,' ')}</div>
                  <div class="status-badge status-${q.status}" style="font-size:.7rem;margin-top:.3rem">${q.status}</div>
                  <div style="font-size:.7rem;color:var(--c-primary);margin-top:.2rem">${formatarMoeda(q.preco_2h)}/2h</div>
                </div>`).join('')}
            </div>
          </div>`;
      }).join('')}
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

function modalQuarto(id, numero, tipo, status) {
  const statuses = ['DISPONIVEL','OCUPADO','LIMPEZA','MANUTENCAO','BLOQUEADO'];
  abrirModal(`Quarto ${numero} — ${tipo.replace(/_/g,' ')}`, `
    <p class="muted mb-2">Estado: ${badgeStatus(status)}</p>
    <div class="campo">
      <label>Alterar estado</label>
      <select id="novo-status-quarto">
        ${statuses.map(s => `<option value="${s}" ${s === status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.5rem">
      <button class="btn-primario" style="flex:1" onclick="salvarStatusQuarto('${id}')">Actualizar</button>
      <button class="btn-secundario" onclick="fecharModal()">Cancelar</button>
    </div>
    <hr style="border-color:var(--c-border);margin:1rem 0">
    <button class="btn-primario btn-bloco" onclick="fecharModal();window._quartoPreSelecionado='${id}';modalNovaReserva()">
      + Reservar este quarto
    </button>
  `);
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

async function modalNovaReserva() {
  const quartos = await api('GET', '/quartos') || [];
  const disponiveis = quartos.filter(q => q.status === 'DISPONIVEL');

  abrirModal('Nova Reserva de Quarto', `
    <div class="campo">
      <label>Quarto</label>
      <select id="res-quarto" onchange="actualizarPrecosReserva(this.value)">
        <option value="">— Seleccionar —</option>
        ${disponiveis.map(q => `<option value="${q.id}" data-p2h="${q.preco_2h}" data-pp="${q.preco_pernoite}" data-pd="${q.preco_diaria}">${q.numero} — ${q.tipo.replace(/_/g,' ')}</option>`).join('')}
      </select>
    </div>
    <div id="precos-quarto" class="mb-2"></div>
    <div class="campo">
      <label>Fracção</label>
      <select id="res-fracao" onchange="actualizarPrecosReserva()">
        <option value="DUAS_HORAS">2 Horas</option>
        <option value="PERNOITE">Pernoite</option>
        <option value="DIARIA">Diária</option>
      </select>
    </div>
    <div class="campo">
      <label>Nome do Hóspede</label>
      <input type="text" id="res-hospede" placeholder="Nome completo">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="campo">
        <label>Check-in</label>
        <input type="datetime-local" id="res-checkin">
      </div>
      <div class="campo">
        <label>Check-out</label>
        <input type="datetime-local" id="res-checkout">
      </div>
    </div>
    <div class="campo">
      <label>Observações</label>
      <textarea id="res-obs" rows="2"></textarea>
    </div>
    <div id="valor-reserva" style="text-align:right;font-weight:700;color:var(--c-primary);margin-bottom:1rem"></div>
    <button class="btn-primario btn-bloco" onclick="confirmarReserva()">Confirmar Reserva</button>
  `);

  // Pré-preencher datas
  const agora = new Date();
  const daqui2h = new Date(agora.getTime() + 2 * 3600000);
  document.getElementById('res-checkin').value = agora.toISOString().slice(0,16);
  document.getElementById('res-checkout').value = daqui2h.toISOString().slice(0,16);

  window._quartosDisponiveis = disponiveis;
  if (window._quartoPreSelecionado) {
    document.getElementById('res-quarto').value = window._quartoPreSelecionado;
    actualizarPrecosReserva(window._quartoPreSelecionado);
    window._quartoPreSelecionado = null;
  }
}

function actualizarPrecosReserva(quartoId) {
  const el = document.getElementById('precos-quarto');
  const id = quartoId || document.getElementById('res-quarto')?.value;
  if (!id || !window._quartosDisponiveis) return;
  const q = window._quartosDisponiveis.find(x => x.id === id);
  if (!q) return;
  const fracao = document.getElementById('res-fracao')?.value || 'DUAS_HORAS';
  const precos = { DUAS_HORAS: q.preco_2h, PERNOITE: q.preco_pernoite, DIARIA: q.preco_diaria };
  el.innerHTML = `<div style="background:var(--c-bg);border-radius:6px;padding:.5rem .75rem;font-size:.85rem;display:flex;gap:1rem">
    <span>2h: <b>${formatarMoeda(q.preco_2h)}</b></span>
    <span>Pernoite: <b>${formatarMoeda(q.preco_pernoite)}</b></span>
    <span>Diária: <b>${formatarMoeda(q.preco_diaria)}</b></span>
  </div>`;
  document.getElementById('valor-reserva').textContent = 'Valor: ' + formatarMoeda(precos[fracao] || 0);
}

async function confirmarReserva() {
  const quarto_id = document.getElementById('res-quarto').value;
  const fracao = document.getElementById('res-fracao').value;
  const nome_hospede = document.getElementById('res-hospede').value;
  const checkin = document.getElementById('res-checkin').value;
  const checkout = document.getElementById('res-checkout').value;
  const observacoes = document.getElementById('res-obs').value;

  if (!quarto_id || !checkin || !checkout) { toast('Preencha quarto e datas', 'erro'); return; }
  try {
    await api('POST', '/quartos/reserva', { quarto_id, fracao, nome_hospede, checkin: new Date(checkin).toISOString(), checkout: new Date(checkout).toISOString(), observacoes });
    toast('Reserva confirmada!', 'sucesso');
    fecharModal();
    carregarModulo('quartos');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// PRODUTOS
// ════════════════════════════════════════════════════════════
async function modulo_produtos(el) {
  try {
    const produtos = await api('GET', '/produtos') || [];
    const categorias = [...new Set(produtos.map(p => p.categoria))].sort();
    const isAdmin = ['ADMIN','GERENTE'].includes(NUK.utilizador.nivel_acesso);

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">📋 Produtos / Menu</span>
        ${isAdmin ? '<button class="btn-primario" onclick="modalNovoProduto()">+ Novo Produto</button>' : ''}
        <input type="text" class="input-pesquisa" placeholder="Pesquisar..." oninput="filtrarProdutosTabela(this.value)" id="pesq-produtos">
      </div>
      ${categorias.map(cat => {
        const prods = produtos.filter(p => p.categoria === cat);
        return `
          <div class="mb-2">
            <div class="secao-titulo" style="font-size:.8rem;margin-bottom:.5rem">${cat} (${prods.length})</div>
            <div class="card tabela-wrapper">
              <table id="tab-${cat}">
                <thead><tr><th>Nome</th><th>Preço</th><th>Estado</th>${isAdmin ? '<th>Acções</th>' : ''}</tr></thead>
                <tbody>
                  ${prods.map(p => `
                    <tr>
                      <td>${p.nome}${p.descricao ? `<div class="muted texto-pequeno">${p.descricao}</div>` : ''}</td>
                      <td class="produto-preco">${formatarMoeda(p.preco)}</td>
                      <td>${p.disponivel ? '<span class="status-badge status-LIVRE">Disponível</span>' : '<span class="status-badge status-FECHADO">Indisponível</span>'}</td>
                      ${isAdmin ? `<td><div class="row-acoes">
                        <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" onclick="modalEditarProduto('${p.id}','${p.nome.replace(/'/g,"\\'")}',${p.preco},'${p.categoria}',${p.disponivel})">Editar</button>
                        <button class="btn-${p.disponivel ? 'perigo' : 'sucesso'}" style="padding:.3rem .6rem;font-size:.78rem" onclick="toggleDisponibilidade('${p.id}',${p.disponivel})">${p.disponivel ? 'Ocultar' : 'Mostrar'}</button>
                      </div></td>` : ''}
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      }).join('')}
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

function modalNovoProduto() {
  abrirModal('Novo Produto', `
    <div class="campo"><label>Nome</label><input type="text" id="np-nome" placeholder="Nome do produto"></div>
    <div class="campo"><label>Categoria</label>
      <select id="np-cat">
        ${['CHURRASCO','PEIXE','BEBIDA','SOBREMESA','ACOMPANHAMENTO','COCKTAIL','ENTRADA','SHISHA'].map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label>Preço (Kz)</label><input type="number" id="np-preco" placeholder="0" min="0"></div>
    <div class="campo"><label>Descrição</label><textarea id="np-desc" rows="2" placeholder="Opcional"></textarea></div>
    <button class="btn-primario btn-bloco" onclick="guardarNovoProduto()">Guardar</button>
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
    carregarModulo('produtos');
  } catch (e) { toast(e.message, 'erro'); }
}

function modalEditarProduto(id, nome, preco, categoria, disponivel) {
  abrirModal('Editar Produto', `
    <div class="campo"><label>Nome</label><input type="text" id="ep-nome" value="${nome}"></div>
    <div class="campo"><label>Categoria</label>
      <select id="ep-cat">
        ${['CHURRASCO','PEIXE','BEBIDA','SOBREMESA','ACOMPANHAMENTO','COCKTAIL','ENTRADA','SHISHA'].map(c => `<option value="${c}" ${c === categoria ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label>Preço (Kz)</label><input type="number" id="ep-preco" value="${preco}" min="0"></div>
    <div class="campo"><label>Disponível</label>
      <select id="ep-disp"><option value="true" ${disponivel ? 'selected' : ''}>Sim</option><option value="false" ${!disponivel ? 'selected' : ''}>Não</option></select>
    </div>
    <button class="btn-primario btn-bloco" onclick="salvarEdicaoProduto('${id}')">Guardar</button>
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
    carregarModulo('produtos');
  } catch (e) { toast(e.message, 'erro'); }
}

async function toggleDisponibilidade(id, atual) {
  try {
    await api('PUT', `/produtos/${id}`, { disponivel: !atual });
    toast(`Produto ${!atual ? 'disponível' : 'oculto'}`, 'sucesso');
    carregarModulo('produtos');
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
        ${isAdmin ? '<button class="btn-primario" onclick="modalNovoStockItem()">+ Novo Item</button>' : ''}
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
                  <button class="btn-sucesso" style="padding:.3rem .6rem;font-size:.78rem" onclick="modalMovimentoStock('${i.id}','${i.nome.replace(/'/g,"\\'")}','${i.unidade}','COMPRA')">+ Entrada</button>
                  <button class="btn-perigo" style="padding:.3rem .6rem;font-size:.78rem" onclick="modalMovimentoStock('${i.id}','${i.nome.replace(/'/g,"\\'")}','${i.unidade}','AJUSTE')">Ajuste</button>
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

function modalNovoStockItem() {
  abrirModal('Novo Item de Stock', `
    <div class="campo"><label>Nome</label><input type="text" id="si-nome"></div>
    <div class="campo"><label>Categoria</label>
      <select id="si-cat">
        ${['CARNE','PEIXE','VEGETAL','TEMPERO','BEBIDA','CARVAO','LIMPEZA','OUTRO'].map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="campo"><label>Stock Actual</label><input type="number" id="si-atual" value="0" min="0" step="0.001"></div>
      <div class="campo"><label>Stock Mínimo</label><input type="number" id="si-min" value="0" min="0" step="0.001"></div>
    </div>
    <div class="campo"><label>Unidade</label>
      <select id="si-un"><option>un</option><option>kg</option><option>g</option><option>L</option><option>ml</option></select>
    </div>
    <div class="campo"><label>Fornecedor</label><input type="text" id="si-forn" placeholder="Opcional"></div>
    <button class="btn-primario btn-bloco" onclick="guardarNovoStockItem()">Guardar</button>
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
    <button class="btn-primario btn-bloco" onclick="confirmarMovimento('${id}')">Registar Movimento</button>
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
          <button class="btn-primario" style="padding:.3rem .75rem;font-size:.78rem" onclick="modalNovaFatura()">+ Emitir Factura</button>
        </div>
        <div class="tabela-wrapper">
          <table>
            <thead><tr><th>Nº Factura</th><th>Cliente</th><th>IVA</th><th>Total</th><th>Data</th></tr></thead>
            <tbody>
              ${(faturas||[]).slice(0,20).map(f => `
                <tr>
                  <td class="negrito">${f.numero_fatura}</td>
                  <td>${f.nome_cliente || f.cliente_nome || '—'}</td>
                  <td class="muted">${formatarMoeda(f.iva)}</td>
                  <td class="texto-primario negrito">${formatarMoeda(f.total)}</td>
                  <td class="muted">${formatarData(f.emitida_em)}</td>
                </tr>`).join('')}
              ${!faturas?.length ? '<tr><td colspan="5" class="muted" style="text-align:center;padding:1rem">Sem facturas</td></tr>' : ''}
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
    <button class="btn-primario btn-bloco" onclick="emitirFatura()">Emitir</button>
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
async function modulo_clientes(el) {
  try {
    const _clientesResp = await api('GET', '/clientes') || [];
    const clientes = Array.isArray(_clientesResp) ? _clientesResp : (_clientesResp.data || []);

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">👥 Clientes</span>
        <button class="btn-primario" onclick="modalNovoCliente()">+ Novo Cliente</button>
        <input type="text" class="input-pesquisa" placeholder="Pesquisar..." oninput="pesquisarClientes(this.value)">
      </div>
      <div class="card tabela-wrapper">
        <table id="tab-clientes">
          <thead><tr><th>Nome</th><th>Telefone</th><th>Email</th><th>Nível</th><th>Saldo Carteira</th><th>Registado em</th></tr></thead>
          <tbody>
            ${clientes.map(c => `
              <tr>
                <td class="negrito">${c.nome}</td>
                <td>${c.telefone || '—'}</td>
                <td>${c.email || '—'}</td>
                <td><span class="fidelizacao-${c.nivel_fidelizacao}">★ ${c.nivel_fidelizacao}</span></td>
                <td class="texto-primario">${formatarMoeda(c.saldo_carteira)}</td>
                <td class="muted">${formatarData(c.criado_em).split(',')[0]}</td>
              </tr>`).join('')}
            ${!clientes.length ? '<tr><td colspan="6" class="muted" style="text-align:center;padding:1rem">Sem clientes</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

async function pesquisarClientes(q) {
  if (q.length < 2) return;
  try {
    const _cResp = await api('GET', `/clientes?q=${encodeURIComponent(q)}`) || [];
    const clientes = Array.isArray(_cResp) ? _cResp : (_cResp.data || []);
    const tbody = document.querySelector('#tab-clientes tbody');
    if (tbody) tbody.innerHTML = clientes.map(c => `
      <tr>
        <td class="negrito">${c.nome}</td>
        <td>${c.telefone || '—'}</td>
        <td>${c.email || '—'}</td>
        <td><span class="fidelizacao-${c.nivel_fidelizacao}">★ ${c.nivel_fidelizacao}</span></td>
        <td class="texto-primario">${formatarMoeda(c.saldo_carteira)}</td>
        <td class="muted">${formatarData(c.criado_em).split(',')[0]}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center">Sem resultados</td></tr>';
  } catch {}
}

function modalNovoCliente() {
  abrirModal('Novo Cliente', `
    <div class="campo"><label>Nome</label><input type="text" id="nc-nome" placeholder="Nome completo"></div>
    <div class="campo"><label>Telefone</label><input type="tel" id="nc-tel" placeholder="+244 9xx xxx xxx"></div>
    <div class="campo"><label>Email</label><input type="email" id="nc-email" placeholder="email@exemplo.com"></div>
    <div class="campo"><label>NIF</label><input type="text" id="nc-nif" placeholder="Opcional"></div>
    <button class="btn-primario btn-bloco" onclick="guardarNovoCliente()">Guardar</button>
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
// FUNCIONÁRIOS
// ════════════════════════════════════════════════════════════
async function modulo_funcionarios(el) {
  if (!['ADMIN','GERENTE'].includes(NUK.utilizador.nivel_acesso)) {
    el.innerHTML = '<div class="erro-msg">Acesso restrito</div>';
    return;
  }
  try {
    const lista = await api('GET', '/funcionarios') || [];

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">👨‍💼 Funcionários</span>
        <button class="btn-primario" onclick="modalNovoFuncionario()">+ Novo Funcionário</button>
      </div>
      <div class="card tabela-wrapper">
        <table>
          <thead><tr><th>Nome</th><th>Cargo</th><th>Nível</th><th>Avaliação</th><th>Estado</th><th>Último Acesso</th><th>Acções</th></tr></thead>
          <tbody>
            ${lista.map(f => `
              <tr>
                <td><b>${f.nome}</b><div class="muted texto-pequeno">${f.email}</div></td>
                <td>${f.cargo || '—'}</td>
                <td><span class="status-badge ${f.nivel_acesso === 'ADMIN' ? 'status-CONFIRMADA' : f.nivel_acesso === 'GERENTE' ? 'status-EM_PREPARO' : 'status-LIVRE'}">${f.nivel_acesso}</span></td>
                <td>★ ${parseFloat(f.media_avaliacao||0).toFixed(1)} <span class="muted">(${f.total_avaliacoes})</span></td>
                <td>${f.ativo ? '<span class="status-badge status-LIVRE">Activo</span>' : '<span class="status-badge status-FECHADO">Inactivo</span>'}</td>
                <td class="muted">${f.ultimo_acesso ? formatarData(f.ultimo_acesso) : 'Nunca'}</td>
                <td><div class="row-acoes">
                  <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" onclick="modalEditarFuncionario('${f.id}','${f.nome.replace(/'/g,"\\'")}','${f.cargo||''}','${f.nivel_acesso}',${f.salario||0},${f.ativo})">Editar</button>
                  <button class="btn-${f.ativo ? 'perigo' : 'sucesso'}" style="padding:.3rem .6rem;font-size:.78rem" onclick="toggleActivarFunc('${f.id}',${f.ativo})">${f.ativo ? 'Desactivar' : 'Activar'}</button>
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

function modalNovoFuncionario() {
  abrirModal('Novo Funcionário', `
    <div class="campo"><label>Nome</label><input type="text" id="nf-nome"></div>
    <div class="campo"><label>Email</label><input type="email" id="nf-email"></div>
    <div class="campo"><label>Senha</label><input type="password" id="nf-senha" placeholder="Mínimo 8 caracteres"></div>
    <div class="campo"><label>Cargo</label><input type="text" id="nf-cargo" placeholder="Ex: Empregado de Mesa"></div>
    <div class="campo"><label>Nível de Acesso</label>
      <select id="nf-nivel">
        <option value="OPERADOR">Operador</option>
        <option value="GERENTE">Gerente</option>
        <option value="ADMIN">Admin</option>
      </select>
    </div>
    <div class="campo"><label>Salário (Kz)</label><input type="number" id="nf-sal" value="200000" min="0"></div>
    <button class="btn-primario btn-bloco" onclick="guardarNovoFuncionario()">Guardar</button>
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
    await api('POST', '/funcionarios', { nome, email, password, cargo, nivel_acesso, salario });
    toast('Funcionário criado!', 'sucesso');
    fecharModal();
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

function modalEditarFuncionario(id, nome, cargo, nivel, salario, ativo) {
  abrirModal('Editar Funcionário', `
    <div class="campo"><label>Nome</label><input type="text" id="ef-nome" value="${nome}"></div>
    <div class="campo"><label>Cargo</label><input type="text" id="ef-cargo" value="${cargo}"></div>
    <div class="campo"><label>Nível</label>
      <select id="ef-nivel">
        ${['OPERADOR','GERENTE','ADMIN'].map(n => `<option value="${n}" ${n===nivel?'selected':''}>${n}</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label>Salário (Kz)</label><input type="number" id="ef-sal" value="${salario}" min="0"></div>
    <div class="campo"><label>Nova Senha (deixar vazio para não alterar)</label><input type="password" id="ef-senha" placeholder="Mínimo 8 caracteres"></div>
    <button class="btn-primario btn-bloco" onclick="salvarEdicaoFuncionario('${id}')">Guardar</button>
  `);
}

async function salvarEdicaoFuncionario(id) {
  const nome = document.getElementById('ef-nome').value;
  const cargo = document.getElementById('ef-cargo').value;
  const nivel_acesso = document.getElementById('ef-nivel').value;
  const salario = parseFloat(document.getElementById('ef-sal').value) || 0;
  const password = document.getElementById('ef-senha').value;
  const dados = { nome, cargo, nivel_acesso, salario };
  if (password) dados.password = password;
  try {
    await api('PUT', `/funcionarios/${id}`, dados);
    toast('Funcionário actualizado!', 'sucesso');
    fecharModal();
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

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
        <button class="btn-primario" onclick="guardarConfiguracoes()">Guardar Configurações</button>
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
