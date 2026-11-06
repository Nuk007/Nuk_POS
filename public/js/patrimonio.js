'use strict';
/**
 * Património: registo dos bens com depreciação linear. Os bens nunca se apagam; abatem-se (com motivo).
 * As categorias gerem-se em Configurações → Categorias de património.
 * Sem handlers inline (CSP): data-on-click / data-on-change / data-on-input com argumentos literais.
 */
const PAT_ESTADO = { BOM: 'Bom', REGULAR: 'Regular', MAU: 'Mau', ABATIDO: 'Abatido' };
const patData = d => (d ? d.split('-').reverse().join('/') : '—');

async function modulo_patrimonio(el) {
  try {
    const filtro = window._patFiltro || 'ACTIVOS';
    const [bens, resumo, listas] = await Promise.all([api('GET', `/patrimonio?estado=${filtro}`), api('GET', '/patrimonio/resumo'), api('GET', '/listas')]);
    window._patBens = Array.isArray(bens) ? bens : [];
    window._patCategorias = (((listas || {}).CATEGORIA_PATRIMONIO || {}).opcoes || []).filter(o => o.ativo).map(o => o.valor);
    const r = resumo || {};
    const kpi = (t, v) => `<div class="kpi-card"><div class="kpi-label">${t}</div><div class="kpi-valor">${v}</div></div>`;
    el.innerHTML = `
      <div class="toolbar"><span class="secao-titulo">🏛️ Património</span>
        <select class="input-pesquisa" data-on-change="patrimonioFiltrar(this.value)">
          <option value="ACTIVOS" ${filtro === 'ACTIVOS' ? 'selected' : ''}>Bens activos</option>
          <option value="ABATIDO" ${filtro === 'ABATIDO' ? 'selected' : ''}>Abatidos</option>
        </select>
        <input type="text" class="input-pesquisa" placeholder="Pesquisar..." data-on-input="patrimonioPesquisar(this.value)">
        <button class="btn-primario" data-on-click="modalBem(-1)">+ Novo bem</button></div>
      <div class="kpi-grid">
        ${kpi('Bens activos', r.bens || 0)}${kpi('Valor de aquisição', formatarMoeda(r.valor_aquisicao || 0))}${kpi('Valor actual', formatarMoeda(r.valor_actual || 0))}${kpi('Em mau estado', r.em_mau_estado || 0)}
      </div>
      <div class="card tabela-wrapper"><table>
        <thead><tr><th>Código</th><th>Bem</th><th>Categoria</th><th>Local</th><th>Adquirido</th><th style="text-align:right">Aquisição</th><th style="text-align:right">Valor actual</th><th>Estado</th><th></th></tr></thead>
        <tbody id="pat-corpo">${patLinhas(window._patBens)}</tbody></table></div>`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function patLinhas(bens, termo = '') {
  const t = termo.trim().toLowerCase();
  const vis = (window._patBens || []).map((b, i) => ({ b, i })).filter(x => bens.includes(x.b) && (!t || `${x.b.codigo} ${x.b.nome} ${x.b.localizacao || ''}`.toLowerCase().includes(t)));
  return vis.length ? vis.map(({ b, i }) => `<tr><td><b>${esc(b.codigo)}</b></td><td>${esc(b.nome)}</td><td>${esc(String(b.categoria).replace(/_/g, ' '))}</td><td>${esc(b.localizacao || '')}</td>
    <td>${patData(b.data_aquisicao)}<div class="muted texto-pequeno">${b.vida_util_anos} anos de vida útil</div></td>
    <td style="text-align:right">${formatarMoeda(b.valor_aquisicao)}</td><td style="text-align:right"><b>${formatarMoeda(b.valor_actual)}</b></td>
    <td>${PAT_ESTADO[b.estado]}${b.motivo_abate ? `<div class="muted texto-pequeno">${esc(b.motivo_abate)}</div>` : ''}</td>
    <td>${b.estado === 'ABATIDO' ? '' : `<button class="btn-secundario" data-on-click="modalBem(${i})">Editar</button> <button class="btn-secundario" data-on-click="pedirAbaterBem(${i})">Abater</button>`}</td></tr>`).join('')
    : '<tr><td colspan="9" class="muted" style="text-align:center;padding:1rem">Nenhum bem</td></tr>';
}
function patrimonioPesquisar(t) { const c = document.getElementById('pat-corpo'); if (c) c.innerHTML = patLinhas(window._patBens || [], t); }
function patrimonioFiltrar(v) { window._patFiltro = v; carregarModulo('patrimonio'); }

function modalBem(i) {
  const b = i >= 0 ? (window._patBens || [])[i] : null;
  window._patEdit = b;
  const cats = window._patCategorias || [];
  abrirModal(b ? `Editar ${esc(b.codigo)}` : 'Novo bem', `
    <div class="campo"><label>Nome</label><input id="pt-nome" maxlength="160" value="${esc(b ? b.nome : '')}"></div>
    <div class="campo"><label>Categoria</label><select id="pt-cat">${cats.map(c => `<option value="${esc(c)}" ${b && b.categoria === c ? 'selected' : ''}>${esc(c.replace(/_/g, ' '))}</option>`).join('')}</select></div>
    <div class="campo"><label>Localização</label><input id="pt-loc" maxlength="120" value="${esc(b ? b.localizacao || '' : '')}" placeholder="Opcional"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
      <div class="campo"><label>Data de aquisição</label><input id="pt-data" type="date" value="${esc(b ? b.data_aquisicao : '')}"></div>
      <div class="campo"><label>Vida útil (anos)</label><input id="pt-vida" type="number" min="1" max="100" value="${b ? b.vida_util_anos : 5}"></div>
    </div>
    <div class="campo"><label>Valor de aquisição (Kz)</label><input id="pt-valor" type="number" min="0" step="any" value="${b ? b.valor_aquisicao : ''}"></div>
    <div class="campo"><label>Estado</label><select id="pt-estado">${['BOM', 'REGULAR', 'MAU'].map(e => `<option value="${e}" ${b && b.estado === e ? 'selected' : ''}>${PAT_ESTADO[e]}</option>`).join('')}</select></div>
    <div class="campo"><label>Observações</label><textarea id="pt-obs" rows="2" maxlength="1000">${esc(b ? b.observacoes || '' : '')}</textarea></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarBem()">Guardar</button>`);
}
async function guardarBem() {
  const b = window._patEdit;
  const v = id => document.getElementById(id).value;
  const corpo = { nome: v('pt-nome').trim(), categoria: v('pt-cat'), localizacao: v('pt-loc').trim(), data_aquisicao: v('pt-data'),
    vida_util_anos: parseInt(v('pt-vida'), 10), valor_aquisicao: v('pt-valor') === '' ? '' : parseFloat(v('pt-valor')), estado: v('pt-estado'), observacoes: v('pt-obs').trim() };
  if (!corpo.nome || !corpo.categoria || !corpo.data_aquisicao || corpo.valor_aquisicao === '') { toast('Preencha o nome, a categoria, a data e o valor', 'erro'); return; }
  try {
    if (b) await api('PATCH', `/patrimonio/${b.id}`, corpo); else await api('POST', '/patrimonio', corpo);
    fecharModal(); toast(b ? 'Bem actualizado' : 'Bem registado', 'sucesso'); carregarModulo('patrimonio');
  } catch (e) { toast(e.message, 'erro'); }
}
function pedirAbaterBem(i) {
  const b = (window._patBens || [])[i]; if (!b) return;
  modalConfirmar('Abater bem', `Tem a certeza que quer <b>abater «${esc(b.nome)}»</b> (${esc(b.codigo)})? Fica no registo com valor 0 e já não se pode alterar.`, 'modalAbaterBem', i);
}
function modalAbaterBem(i) {
  window._patAbater = i;
  abrirModal('Motivo do abate', `<div class="campo"><label>Porque é que o bem sai do património?</label><textarea id="pt-motivo" rows="3" maxlength="1000" placeholder="Ex.: avariado sem reparação, vendido, roubado"></textarea></div>
    <button class="btn-perigo btn-bloco" data-on-click="abaterBem()">Abater</button>`);
}
async function abaterBem() {
  const b = (window._patBens || [])[window._patAbater]; if (!b) return;
  const motivo = document.getElementById('pt-motivo').value.trim();
  if (!motivo) { toast('Escreva o motivo do abate', 'erro'); return; }
  try { await api('POST', `/patrimonio/${b.id}/abater`, { motivo }); fecharModal(); toast('Bem abatido', 'sucesso'); carregarModulo('patrimonio'); }
  catch (e) { toast(e.message, 'erro'); }
}
