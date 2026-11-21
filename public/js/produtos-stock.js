'use strict';
// Nuk_POS — Ementa (produtos e receitas de stock) e Stock.
// Scripts clássicos: as funções são globais e chamam-se umas às outras entre ficheiros (data-on-click).

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
                  <td>${p.prato_do_dia ? '⭐ ' : ''}${esc(p.nome)}${p.vendido_ao_peso ? ' <span class="status-badge status-EM_PREPARO" title="Vendido ao peso">⚖️ kg</span>' : ''}${p.descricao ? `<div class="muted texto-pequeno">${esc(p.descricao)}</div>` : ''}${gerir && p.codigo_barras ? `<div class="muted texto-pequeno">▮▯▮ ${esc(p.codigo_barras)}</div>` : ''}${p.prato_do_dia ? '<div class="texto-pequeno" style="color:var(--c-primary,#E8650A)">Prato do dia</div>' : ''}</td>
                  <td class="produto-preco">${formatarMoeda(p.preco)}${p.vendido_ao_peso ? '<span class="muted texto-pequeno"> / kg</span>' : ''}</td>
                  <td>${p.disponivel ? '<span class="status-badge status-LIVRE">Disponível</span>' : '<span class="status-badge status-FECHADO">Indisponível</span>'}</td>
                  ${gerir ? `<td><div class="row-acoes">
                    <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalEditarProduto('${esc(p.id)}')">Editar</button>
                    <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalIngredientes('${p.id}')">Stock</button>
                    <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="alternarPratoDoDia('${p.id}',${!!p.prato_do_dia})">${p.prato_do_dia ? 'Tirar do dia' : '⭐ Prato do dia'}</button>
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

// Venda ao peso e código de barras (21/11/2026): o preço passa a ser por kg; o código serve o leitor e as etiquetas
function htmlCamposPesoCodigo(px, p) {
  return `
    <div class="campo"><label style="display:flex;gap:.5rem;align-items:center;cursor:pointer"><input type="checkbox" id="${px}-peso" style="width:auto;margin:0"${p.vendido_ao_peso ? ' checked' : ''}> ⚖️ Vendido ao peso (o preço é por kg; pesa-se ao vender)</label></div>
    <div class="campo"><label>Código de barras</label>
      <div style="display:flex;gap:.4rem"><input type="text" id="${px}-codigo" maxlength="32" value="${esc(p.codigo_barras || '')}" placeholder="Leia com o leitor ou escreva (opcional)">
      ${p.id && !p.codigo_barras ? `<button type="button" class="btn-secundario" data-on-click="gerarCodigoProduto('${esc(p.id)}')" title="Gera um código interno para imprimir em etiqueta">Gerar</button>` : ''}</div>
    </div>`;
}
function lerCamposPesoCodigo(px) {
  const peso = document.getElementById(`${px}-peso`), cod = document.getElementById(`${px}-codigo`);
  const out = {};
  if (peso) out.vendido_ao_peso = !!peso.checked;
  if (cod) out.codigo_barras = String(cod.value || '').trim() || null;
  return out;
}
async function gerarCodigoProduto(id) {
  try {
    const p = await api('POST', `/produtos/${id}/codigo-barras/gerar`);
    const cod = document.getElementById('ep-codigo'); if (cod) cod.value = p.codigo_barras;
    const lista = window._produtosCfg || []; const i = lista.findIndex(x => x.id === id); if (i >= 0) lista[i] = p;
    toast(`Código ${p.codigo_barras} criado`, 'sucesso');
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
    ${htmlCamposPesoCodigo('np', {})}
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
    await api('POST', '/produtos', { nome, categoria, preco: parseFloat(preco), descricao, ...lerCamposPesoCodigo('np') });
    toast('Produto criado!', 'sucesso');
    fecharModal();
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message, 'erro'); }
}

async function modalEditarProduto(id) {
  const p = (window._produtosCfg || []).find(x => x.id === id);
  if (!p) { toast('Produto não encontrado: actualize o ecrã', 'erro'); return; }
  const { nome, preco, categoria, disponivel } = p;
  const cats = await opcoesLista('CATEGORIA_PRODUTO', categoria);
  abrirModal('Editar Produto', `
    <div class="campo"><label>Nome</label><input type="text" id="ep-nome" value="${esc(nome)}"></div>
    <div class="campo"><label>Categoria</label>
      <select id="ep-cat">
        ${htmlOpcoes(cats, categoria)}
      </select>
    </div>
    <div class="campo"><label>Preço (Kz)</label><input type="number" id="ep-preco" value="${esc(preco)}" min="0"></div>
    ${htmlCamposPesoCodigo('ep', p)}
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
    await api('PUT', `/produtos/${id}`, { nome, categoria, preco, disponivel, ...lerCamposPesoCodigo('ep') });
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
