'use strict';
// Nuk_POS — Módulos base: Dashboard, Pedidos, confirmação obrigatória e carrinho do novo pedido.
// Scripts clássicos: as funções são globais e chamam-se umas às outras entre ficheiros (data-on-click).

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
  const itensTexto = (p.itens || []).slice(0, 3).map(i => `${fmtQtd(i.quantidade)} ${i.produto_nome}`).join(', ');
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
  modalConfirmar('Cancelar pedido', `Tem a certeza que quer <b>cancelar este pedido</b>? O stock é devolvido e, se foi pago com Nuk-Coin, o valor é estornado. Não pode ser desfeito. Fica registado quem cancelou.<br><br>
    <label for="canc-motivo" class="negrito">Motivo</label><br><input type="text" id="canc-motivo" maxlength="200" placeholder="Ex.: cliente desistiu, pedido em duplicado" class="campo-motivo">`, 'cancelarPedidoConfirmado', id);
}
function cancelarPedidoConfirmado(id) {
  const m = document.getElementById('canc-motivo');
  const motivo = m && m.value ? m.value.trim() : '';
  fecharModal(); mudarStatusPedido(id, 'CANCELADO', motivo);
}

async function mudarStatusPedido(id, status, motivo) {
  try {
    await api('PATCH', `/pedidos/${id}/status`, motivo ? { status, motivo } : { status });
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



// ── Acções do carrinho / atalhos (chamadas via data-on-click; a CSP não permite JS inline) ──
function carrinhoMenos(i) { const it = window._carrinhoItens[i]; if (it) { it.quantidade = Math.max(1, it.quantidade - 1); renderCarrinho(); } }
function carrinhoMais(i) { const it = window._carrinhoItens[i]; if (it) { it.quantidade++; renderCarrinho(); } }
function carrinhoRemover(i) { window._carrinhoItens.splice(i, 1); renderCarrinho(); }
function novoPedidoNaMesa(id) { fecharModal(); window._mesaPreSelecionada = id; modalNovoPedido(); }
