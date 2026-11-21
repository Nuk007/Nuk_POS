'use strict';
// Nuk_POS — Configurações → «📑 Configuração de relatórios» (21/11/2026, pedido do dono): o modelo da Folha de Caixa
// em branco (dados do estabelecimento + itens que cada estabelecimento acrescenta ou retira) e a classificação usada
// pela Folha de Caixa do dia (grupo de cada categoria de produto, área de cada categoria de stock e de despesa).
// Sem handlers inline (CSP): data-on-click / data-on-change com argumentos literais.

const FM_GRUPOS = { BEBIDAS: 'Bebidas (F)', COMIDAS: 'Comidas (G)', PISCINA: 'Piscina (H)', QUARTOS: 'Quartos (I)', OUTROS: 'Shishas, cigarros e diversas (E)' };
let _fm = null;      // modelo em edição
let _fmCls = null;   // classificação { grupos, areas_stock, areas_despesa, padrao } + listas

async function carregarConfigRelatorios() {
  const box = document.getElementById('cfg-relatorios');
  if (!box) return;
  try {
    const [m, cls, listas] = await Promise.all([api('GET', '/caixa/folha/modelo'), api('GET', '/caixa/folha/config'), api('GET', '/listas')]);
    _fm = m;
    const act = l => ((listas[l] && listas[l].opcoes) || []).filter(o => o.ativo).map(o => o.valor);
    _fmCls = { ...cls, catProduto: act('CATEGORIA_PRODUTO'), catStock: act('CATEGORIA_STOCK'), areas: act('AREA_SAIDA') };
    desenharConfigRelatorios();
  } catch (e) { box.innerHTML = `<div class="erro-msg">Configuração de relatórios: ${esc(e.message)}</div>`; }
}

function desenharConfigRelatorios() {
  const box = document.getElementById('cfg-relatorios');
  if (!box || !_fm) return;
  const m = _fm;
  box.innerHTML = `
    <div class="card-titulo mb-2">📑 CONFIGURAÇÃO DE RELATÓRIOS</div>
    <div class="muted" style="font-size:.82rem;margin-bottom:.6rem">Folha de Caixa em branco para imprimir e preencher à mão. O cabeçalho usa o nome, a morada, o NIF e o telefone do cartão principal das Configurações. Acrescente, mude ou retire os itens de cada grupo e guarde.</div>
    <div class="campo"><label>Título</label><input id="fm-titulo" maxlength="60" value="${esc(m.titulo)}"></div>
    ${m.grupos.map((g, gi) => `
      <div style="padding:.6rem 0;border-top:1px solid var(--c-border)">
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.4rem">
          <b style="min-width:2rem">(${esc(g.letra)})</b>
          <input class="fm-gnome" data-g="${gi}" maxlength="40" value="${esc(g.nome)}" style="flex:1;min-width:10rem">
          <label class="texto-pequeno" style="display:flex;gap:.3rem;align-items:center"><input type="checkbox" class="fm-goculto" data-g="${gi}" style="width:auto;margin:0"${g.oculto ? ' checked' : ''}> Não mostrar</label>
        </div>
        <div class="tabela-wrapper"><table class="texto-pequeno"><tbody>
          ${g.itens.map((it, ii) => `<tr${it.tirado ? ' style="opacity:.45;text-decoration:line-through"' : ''}>
            <td><input class="fm-inome" data-g="${gi}" data-i="${ii}" maxlength="40" value="${esc(it.nome)}"></td>
            <td style="width:8rem"><input class="fm-ipreco" data-g="${gi}" data-i="${ii}" type="number" min="0" step="1" placeholder="sem preço" value="${it.preco === null || it.preco === undefined ? '' : it.preco}"></td>
            <td style="width:5.5rem"><button class="btn-secundario" style="padding:.2rem .5rem;font-size:.75rem" data-on-click="folhaModeloTirar('${gi}','${ii}')">${it.tirado ? 'Repor' : '✕ Tirar'}</button></td>
          </tr>`).join('') || '<tr><td class="muted">Sem itens: a folha leva só linhas em branco.</td></tr>'}
        </tbody></table></div>
        <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:.35rem">
          <button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="folhaModeloAcrescentar('${gi}')">+ Item</button>
          <label class="texto-pequeno">Linhas em branco <input class="fm-gbrancos" data-g="${gi}" type="number" min="0" max="10" value="${g.brancos}" style="width:4rem;display:inline-block"></label>
        </div>
      </div>`).join('')}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.5rem 1rem;padding:.6rem 0;border-top:1px solid var(--c-border)">
      <div class="campo" style="margin:0"><label>Linhas por área nas saídas</label><input id="fm-areas" type="number" min="1" max="5" value="${m.areas_brancos}"></div>
      <div class="campo" style="margin:0"><label>Assinaturas (separadas por vírgulas)</label><input id="fm-assin" maxlength="90" value="${esc(m.assinaturas.join(', '))}"></div>
      <label class="texto-pequeno" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="fm-controlo" style="width:auto;margin:0"${m.controlo ? ' checked' : ''}> Quadro «Controlo do dia» (quebras, crédito, TPA, dinheiro contado)</label>
    </div>
    <div class="muted texto-pequeno" style="margin-bottom:.5rem">As áreas das saídas são as da lista «Áreas das saídas (Folha de Caixa)» em Listas. ${m.configurado ? 'Modelo do estabelecimento.' : 'Ainda não guardado: proposta feita a partir da ementa.'}</div>
    <div class="row-acoes" style="flex-wrap:wrap">
      <button class="btn-primario" data-on-click="guardarFolhaModelo()">Guardar o modelo</button>
      <button class="btn-secundario" data-on-click="descarregarPdf('/caixa/folha/modelo.pdf', 'folha-caixa-em-branco.pdf')">Descarregar a folha em branco (PDF)</button>
      <button class="btn-secundario" data-on-click="pedirFolhaDaEmenta()">Preencher com a ementa</button>
      ${m.configurado ? '<button class="btn-secundario" data-on-click="pedirReporFolhaModelo()">Repor o padrão</button>' : ''}
    </div>
    ${htmlClassificacaoFolha()}`;
}

/** Lê o que está escrito no ecrã para o modelo em edição (sem gravar). */
function lerFolhaModeloEcra() {
  const v = sel => [...document.querySelectorAll(sel)];
  _fm.titulo = (document.getElementById('fm-titulo') || {}).value || _fm.titulo;
  v('.fm-gnome').forEach(e => { _fm.grupos[e.dataset.g].nome = e.value; });
  v('.fm-goculto').forEach(e => { _fm.grupos[e.dataset.g].oculto = e.checked; });
  v('.fm-gbrancos').forEach(e => { _fm.grupos[e.dataset.g].brancos = Number(e.value); });
  v('.fm-inome').forEach(e => { _fm.grupos[e.dataset.g].itens[e.dataset.i].nome = e.value; });
  v('.fm-ipreco').forEach(e => { _fm.grupos[e.dataset.g].itens[e.dataset.i].preco = e.value === '' ? null : Number(e.value); });
  const a = document.getElementById('fm-areas'); if (a) _fm.areas_brancos = Number(a.value);
  const s = document.getElementById('fm-assin'); if (s) _fm.assinaturas = s.value.split(',').map(x => x.trim()).filter(Boolean);
  const c = document.getElementById('fm-controlo'); if (c) _fm.controlo = c.checked;
}

function folhaModeloAcrescentar(gi) {
  lerFolhaModeloEcra();
  _fm.grupos[Number(gi)].itens.push({ nome: '', preco: null });
  desenharConfigRelatorios();
  const campos = document.querySelectorAll(`.fm-inome[data-g="${Number(gi)}"]`);
  if (campos.length) campos[campos.length - 1].focus();
}

// «Tirar» só risca o item no ecrã (volta com «Repor»); sai da folha ao guardar o modelo.
function folhaModeloTirar(gi, ii) {
  lerFolhaModeloEcra();
  const it = _fm.grupos[Number(gi)].itens[Number(ii)];
  if (it) it.tirado = !it.tirado;
  desenharConfigRelatorios();
}

async function guardarFolhaModelo() {
  lerFolhaModeloEcra();
  const modelo = { ..._fm, grupos: _fm.grupos.map(g => ({ ...g, itens: g.itens.filter(i => !i.tirado && String(i.nome || '').trim()) })) };
  try {
    _fm = await api('PUT', '/caixa/folha/modelo', { modelo });
    toast('Modelo da Folha de Caixa guardado', 'sucesso');
    desenharConfigRelatorios();
  } catch (e) { toast(e.message, 'erro'); }
}

function pedirFolhaDaEmenta() {
  modalConfirmar('Preencher com a ementa', 'Os itens dos grupos passam a ser os produtos activos da ementa, com os preços de venda. O que escreveu à mão no modelo perde-se (só fica gravado quando carregar em «Guardar o modelo»). Continuar?', 'folhaDaEmentaConfirmado');
}
async function folhaDaEmentaConfirmado() {
  fecharModal();
  try { const p = await api('GET', '/caixa/folha/modelo?ementa=1'); _fm = { ...p, configurado: _fm && _fm.configurado }; desenharConfigRelatorios(); toast('Itens preenchidos com a ementa. Reveja e guarde.', 'info'); }
  catch (e) { toast(e.message, 'erro'); }
}

function pedirReporFolhaModelo() {
  modalConfirmar('Repor o padrão', 'O modelo do estabelecimento é apagado e a folha volta a ser feita a partir da ementa. Continuar?', 'reporFolhaModeloConfirmado');
}
async function reporFolhaModeloConfirmado() {
  fecharModal();
  try { _fm = await api('PUT', '/caixa/folha/modelo', { repor: true }); toast('Modelo reposto', 'sucesso'); desenharConfigRelatorios(); }
  catch (e) { toast(e.message, 'erro'); }
}

// ── Classificação da Folha de Caixa do dia ──
function htmlClassificacaoFolha() {
  if (!_fmCls) return '';
  const c = _fmCls;
  const opt = (lista, actual, rot) => lista.map(v => `<option value="${esc(v)}"${v === actual ? ' selected' : ''}>${esc(rot ? rot(v) : rotuloCategoria(v))}</option>`).join('');
  const linha = (cls, cat, sel) => `<label class="texto-pequeno" style="display:flex;justify-content:space-between;gap:.5rem;align-items:center">${esc(rotuloCategoria(cat))}<select class="${cls}" data-cat="${esc(cat)}" style="max-width:13rem">${sel}</select></label>`;
  const despesas = typeof CAT_DESPESA === 'object' ? Object.keys(CAT_DESPESA) : ['SALARIOS', 'RENDA', 'ENERGIA', 'AGUA', 'COMBUSTIVEL', 'MANUTENCAO', 'MARKETING', 'IMPOSTOS', 'OUTRA'];
  const grade = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));gap:.35rem 1rem;margin-bottom:.6rem';
  return `
    <div style="padding-top:.8rem;margin-top:.8rem;border-top:1px solid var(--c-border)">
      <b>Folha de Caixa do dia — classificação</b>
      <div class="muted texto-pequeno" style="margin:.3rem 0 .6rem">Em que grupo de vendas entra cada categoria de produto, e em que área das saídas entram as compras e as despesas sem área escolhida. ${c.configurado ? 'Escolha do estabelecimento.' : 'Padrão do sistema.'}</div>
      <div class="texto-pequeno" style="font-weight:600;margin-bottom:.3rem">Vendas</div>
      <div style="${grade}">${c.catProduto.map(cat => linha('fc-grupo', cat, opt(Object.keys(FM_GRUPOS), c.grupos[cat] || 'COMIDAS', g => FM_GRUPOS[g]))).join('')}</div>
      <div class="texto-pequeno" style="font-weight:600;margin-bottom:.3rem">Compras (categoria de stock)</div>
      <div style="${grade}">${c.catStock.map(cat => linha('fc-astock', cat, opt(c.areas, c.areas_stock[cat] || 'DIVERSOS'))).join('')}</div>
      <div class="texto-pequeno" style="font-weight:600;margin-bottom:.3rem">Despesas</div>
      <div style="${grade}">${despesas.map(cat => linha('fc-adesp', cat, opt(c.areas, c.areas_despesa[cat] || 'DIVERSOS'))).join('')}</div>
      <div class="row-acoes">
        <button class="btn-primario" data-on-click="guardarClassificacaoFolha()">Guardar a classificação</button>
        ${c.configurado ? '<button class="btn-secundario" data-on-click="pedirReporClassificacaoFolha()">Repor o padrão</button>' : ''}
      </div>
    </div>`;
}

async function guardarClassificacaoFolha() {
  lerFolhaModeloEcra();
  const mapa = cls => Object.fromEntries([...document.querySelectorAll('.' + cls)].map(s => [s.dataset.cat, s.value]));
  try {
    const r = await api('PUT', '/caixa/folha/config', { grupos: mapa('fc-grupo'), areas_stock: mapa('fc-astock'), areas_despesa: mapa('fc-adesp') });
    Object.assign(_fmCls, r);
    toast('Classificação guardada', 'sucesso');
    desenharConfigRelatorios();
  } catch (e) { toast(e.message, 'erro'); }
}

function pedirReporClassificacaoFolha() {
  modalConfirmar('Repor o padrão', 'A classificação do estabelecimento é apagada e a Folha de Caixa volta a usar a do sistema. Continuar?', 'reporClassificacaoConfirmado');
}
async function reporClassificacaoConfirmado() {
  fecharModal();
  lerFolhaModeloEcra();
  try { Object.assign(_fmCls, await api('PUT', '/caixa/folha/config', { repor: true })); toast('Classificação reposta', 'sucesso'); desenharConfigRelatorios(); }
  catch (e) { toast(e.message, 'erro'); }
}
