'use strict';
// Nuk_POS — Configurações: mesas, licença por módulo, ecrã principal das Configurações, dashboard e listas.
// Scripts clássicos: as funções são globais e chamam-se umas às outras entre ficheiros (data-on-click).

// ════════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ════════════════════════════════════════════════════════════
// Número de mesas (Configurações). Reduzir pede confirmação; o servidor recusa se as últimas estiverem em uso.
function guardarMesas() {
  const n = parseInt(document.getElementById('cfg-mesas').value, 10);
  if (!Number.isInteger(n) || n < 0 || n > 200) { toast('Indique um número entre 0 e 200', 'erro'); return; }
  if (n < (window._nMesas || 0)) {
    modalConfirmar('Reduzir mesas', `Vai passar de <b>${window._nMesas}</b> para <b>${n}</b> mesas: as de número mais alto são retiradas (só se estiverem livres e sem pedidos registados).`, 'reduzirMesasConfirmado', n);
    return;
  }
  definirMesas(n);
}
function reduzirMesasConfirmado(n) { fecharModal(); definirMesas(parseInt(n, 10)); }
async function definirMesas(n) {
  try {
    const r = await api('PUT', '/mesas/quantidade', { quantidade: n });
    toast(`Mesas: ${r.quantidade}` + (r.criadas ? ` (+${r.criadas})` : '') + (r.removidas ? ` (−${r.removidas})` : ''), 'sucesso');
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message, 'erro'); }
}

// Licença do estabelecimento (NUK.utilizador.modulos = chaves contratadas; ausente = tudo, contas antigas)
function licenciadoModulo(k) {
  const m = NUK.utilizador && NUK.utilizador.modulos;
  return !Array.isArray(m) || m.includes(k);
}
function listaContratada(lista) {
  if (lista === 'TIPO_QUARTO') return licenciadoModulo('hospedagem');
  if (lista === 'CATEGORIA_PRODUTO') return licenciadoModulo('restauracao') || licenciadoModulo('lazer') || licenciadoModulo('loja');
  if (lista === 'CATEGORIA_STOCK' || lista === 'UNIDADE_STOCK') return licenciadoModulo('compras');
  if (lista === 'CATEGORIA_PATRIMONIO') return licenciadoModulo('patrimonio');
  if (lista === 'AREA_SAIDA') return licenciadoModulo('caixa');
  return true;
}


async function modulo_configuracoes(el) {
  if (!['ADMIN'].includes(NUK.utilizador.nivel_acesso)) {
    el.innerHTML = '<div class="erro-msg">Acesso restrito ao Administrador</div>';
    return;
  }
  try {
    const cfg = await api('GET', '/configuracoes');
    // só os módulos contratados (licença do estabelecimento) aparecem e são consultados
    const lic = k => licenciadoModulo(k);
    const quartos = lic('hospedagem') ? (await api('GET', '/quartos') || []) : [];
    const produtos = lic('restauracao') ? (await api('GET', '/produtos') || []) : [];
    const nMesas = lic('restauracao') ? ((await api('GET', '/mesas/quantidade')) || {}).quantidade || 0 : 0;
    window._nMesas = nMesas;
    const servAtivos = lic('servicos') ? await api('GET', '/servicos/ativos') : [];
    const servPlanos = lic('servicos') ? await api('GET', '/servicos/manutencoes') : [];
    const listas = await api('GET', '/listas') || {};
    const rTP = (lic('restauracao') || lic('lazer') || lic('loja')) ? await api('GET', '/precos/tabelas') : null;
    window._tabelasPreco = Array.isArray(rTP) ? rTP : [];
    window._produtosCfg = produtos;
    const rCC = lic('caixa') ? await api('GET', '/caixa/conta-corrente') : [];
    const rTC = lic('caixa') ? await api('GET', '/caixa/cartoes/tipos?todos=1') : [];
    const tiposCartao = Array.isArray(rTC) ? rTC : [];
    const rLotes = lic('caixa') && euAdmin() ? await api('GET', '/caixa/cartoes/lotes') : [];
    const lotesCartao = Array.isArray(rLotes) ? rLotes : [];
    const contasCC = Array.isArray(rCC) ? rCC : [];
    const resCli = lic('caixa') ? await api('GET', '/clientes?limit=500') : [];
    const clientesCC = (Array.isArray(resCli) ? resCli : (resCli && resCli.data) || []).filter(c => !contasCC.some(x => x.id === c.id && x.conta_corrente_ativa));
    const fluxosVenda = (lic('restauracao') || lic('lazer') || lic('loja')) ? await api('GET', '/pedidos/fluxos/categorias') : null;
    const temposQuartos = lic('hospedagem') ? await api('GET', '/quartos/tempos') : null;
    const dsh = await api('GET', '/dashboard/itens') || { itens: [], servicos: {} };
    window._cfgDash = { produtos, categorias: (listas.CATEGORIA_PRODUTO?.opcoes || []).filter(o => o.ativo).map(o => o.valor), servicos: dsh.servicos };

    el.innerHTML = `
      <div class="secao-titulo">⚙️ Configurações</div>
      <div class="card" style="max-width:500px">
        <div class="campo"><label>Nome do Estabelecimento</label>
          <input type="text" id="cfg-nome" value="${cfg.nome_estabelecimento || ''}">
        </div>
        <div class="campo"><label>Morada</label>
          <input type="text" id="cfg-morada" maxlength="200" value="${esc(cfg.morada || '')}" placeholder="Rua, bairro, município, província">
        </div>
        <div class="campo"><label>NIF</label>
          <input type="text" id="cfg-nif" maxlength="20" value="${esc(cfg.nif_empresa || '')}" placeholder="Número de Identificação Fiscal">
        </div>
        <div class="campo"><label>Telefone</label>
          <input type="tel" id="cfg-telefone" maxlength="20" value="${esc(cfg.telefone || '')}" placeholder="+244 9XX XXX XXX">
        </div>
        <div class="muted texto-pequeno" style="margin-bottom:.75rem">Aparecem no cabeçalho dos talões e documentos.</div>
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

      <div class="card mt-2" style="max-width:500px">
        <h3 style="margin-top:0">📄 Contrato de Adesão</h3>
        <div class="muted texto-pequeno" style="margin-bottom:.75rem">Contrato entre o estabelecimento e a GESTNUK AI, titular da Plataforma Nuk_POS, assinado pelo administrador titular.</div>
        <button class="btn-secundario" data-on-click="descarregarPdf('/adesao/documento.pdf', 'contrato-adesao-nukpos.pdf')">Descarregar o contrato (PDF)</button>
      </div>

      ${(lic('restauracao') || lic('lazer') || lic('loja')) ? cartaoTabelasPreco(window._tabelasPreco) : ''}
      ${lic('restauracao') ? `<div class="card mt-2" style="max-width:700px"><div class="card-titulo mb-2">👨‍🍳 COZINHA E BAR</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.6rem">Escolha em que ecrã aparece cada categoria (Cozinha, Bar ou nenhum).</div>
        <button class="btn-secundario" data-on-click="modalPostosPreparacao()">Definir postos por categoria</button></div>` : ''}
      ${cartaoFluxosVenda(fluxosVenda, (listas.CATEGORIA_PRODUTO?.opcoes || []).filter(o => o.ativo).map(o => o.valor), lic)}
      ${lic('hospedagem') ? cartaoTemposQuartos(temposQuartos) : ''}
      ${lic('caixa') ? cartaoTiposCartao(tiposCartao, lotesCartao) : ''}
      ${lic('caixa') ? cartaoContasCorrentes(contasCC, clientesCC) : ''}
      ${lic('caixa') ? '<div class="card mt-2" style="max-width:760px" id="cfg-relatorios"><div class="muted">A carregar a configuração de relatórios…</div></div>' : ''}
      ${lic('financas') ? cartaoResumoDiario(cfg) : ''}
      ${(lic('restauracao') || lic('lazer') || lic('loja')) ? '<div class="card mt-2" style="max-width:700px" id="cfg-agentes"></div>' : ''}

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
        ${Object.entries(listas).filter(([lista]) => listaContratada(lista)).map(([lista, l]) => `
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

      ${lic('hospedagem') ? `<div class="card mt-2" style="max-width:500px">
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
      </div>` : ''}

      ${lic('restauracao') ? `<div class="card mt-2" style="max-width:500px">
        <div class="card-titulo">MESAS</div>
        <p class="muted texto-pequeno" style="margin:.4rem 0 .6rem">Quantas mesas tem o estabelecimento. As novas chamam-se M01, M02… e aparecem como botões em Vendas → Mesa.</p>
        <div style="display:flex;gap:.5rem;align-items:center">
          <input id="cfg-mesas" type="number" min="0" max="200" value="${nMesas}" style="width:100px">
          <button class="btn-primario" data-on-click="guardarMesas()">Guardar</button>
        </div>
      </div>` : ''}

      ${lic('restauracao') ? `<div class="card mt-2">
        <div class="toolbar" style="margin-bottom:.5rem">
          <div class="card-titulo">EMENTA (PRODUTOS, PREÇOS E RECEITAS)</div>
          <button class="btn-primario" data-on-click="modalNovoProduto()">+ Novo Produto</button>
          <button class="btn-secundario" data-on-click="modalEtiquetas()" title="Etiquetas com preço e código de barras">🏷️ Etiquetas</button>
          <input type="text" class="input-pesquisa" placeholder="Pesquisar produto..." data-on-input="filtrarProdutosTabela(this.value)">
        </div>
        ${htmlEmentaProdutos(produtos, true)}
      </div>` : ''}

      ${lic('servicos') && typeof htmlConfigServicos === 'function' ? htmlConfigServicos(Array.isArray(servAtivos) ? servAtivos : [], Array.isArray(servPlanos) ? servPlanos : []) : ''}

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
    carregarAgentesImpressao();
    carregarConfigRelatorios();
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
    morada: document.getElementById('cfg-morada').value,
    nif_empresa: document.getElementById('cfg-nif').value,
    telefone: document.getElementById('cfg-telefone').value,
  };
  try {
    await api('PUT', '/configuracoes', dados);
    toast('Configurações guardadas!', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
}
