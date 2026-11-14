'use strict';
/**
 * Finanças (ADMIN/GERENTE): resultado do período (receita cobrada, custo das vendas, despesas, lucro), margem por
 * produto e registo de despesas. Mostrado dentro do módulo Financeiro (#fin-resultado).
 * Sem handlers inline (CSP): data-on-click com argumentos literais.
 */
const CAT_DESPESA = { SALARIOS: 'Salários', RENDA: 'Renda', ENERGIA: 'Energia', AGUA: 'Água', COMBUSTIVEL: 'Combustível', MANUTENCAO: 'Manutenção', MARKETING: 'Publicidade', IMPOSTOS: 'Impostos e taxas', OUTRA: 'Outra' };
const diaFin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });

async function carregarResultadoFinanceiro() {
  const box = document.getElementById('fin-resultado'); if (!box) return;
  const hoje = diaFin();
  const f = window._finFiltro || { de: hoje.slice(0, 8) + '01', ate: hoje };
  try {
    const [r, despesas] = await Promise.all([api('GET', `/financeiro/resultado?de=${f.de}&ate=${f.ate}`), api('GET', `/financeiro/despesas?de=${f.de}&ate=${f.ate}`)]);
    window._finDespesas = despesas || [];
    const cor = v => (v < 0 ? 'color:var(--c-danger)' : '');
    box.innerHTML = `
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:.5rem"><span class="card-titulo">Resultado do período</span>
          <span style="display:flex;gap:.4rem;align-items:center"><input type="date" id="fin-de" value="${esc(f.de)}"> a <input type="date" id="fin-ate" value="${esc(f.ate)}">
          <button class="btn-primario" style="padding:.3rem .7rem" data-on-click="filtrarResultadoFin()">Ver</button></span></div>
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Receita cobrada</div><div class="kpi-valor texto-primario">${formatarMoeda(r.receita.total)}</div><div class="kpi-sub">${r.receita.pedidos} pedidos${r.receita.alojamento ? ` · alojamento ${formatarMoeda(r.receita.alojamento)}` : ''}</div></div>
          <div class="kpi-card"><div class="kpi-label">Custo das vendas</div><div class="kpi-valor">${formatarMoeda(r.custo_vendas)}</div><div class="kpi-sub">Margem bruta ${r.margem_bruta_pct}%</div></div>
          <div class="kpi-card"><div class="kpi-label">Despesas</div><div class="kpi-valor">${formatarMoeda(r.total_despesas)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Resultado (lucro)</div><div class="kpi-valor" style="${cor(r.resultado)}">${formatarMoeda(r.resultado)}</div><div class="kpi-sub">Por receber: ${formatarMoeda(r.por_receber.valor)}</div></div>
        </div>
        ${r.receita_sem_custo > 0 ? `<p class="texto-pequeno" style="color:#f59e0b;margin:.3rem 0">⚠️ ${formatarMoeda(r.receita_sem_custo)} de vendas são de produtos sem receita de stock ou sem custo: o lucro real é menor. Complete as receitas em Configurações → Ementa → Stock.</p>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1rem;margin-top:1rem">
        <div class="card"><div class="card-header"><span class="card-titulo">Margem por produto</span></div>
          ${r.por_produto.length ? `<div class="tabela-wrapper" style="max-height:360px;overflow:auto"><table><thead><tr><th>Produto</th><th>Qtd</th><th>Receita</th><th>Custo</th><th>Margem</th></tr></thead><tbody>
            ${r.por_produto.map(x => `<tr><td>${esc(x.nome)}${x.sem_receita ? '<div class="texto-pequeno" style="color:#f59e0b">sem receita de stock</div>' : x.sem_custo ? '<div class="texto-pequeno" style="color:#f59e0b">ingrediente sem custo</div>' : ''}</td>
              <td>${x.quantidade}</td><td>${formatarMoeda(x.receita)}</td><td class="muted">${formatarMoeda(x.custo)}</td>
              <td class="negrito" style="${cor(x.margem)}">${formatarMoeda(x.margem)} <span class="muted texto-pequeno">${x.margem_pct}%</span></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="muted">Sem vendas cobradas no período</div>'}</div>
        <div class="card"><div class="card-header"><span class="card-titulo">Despesas</span><button class="btn-primario" style="padding:.3rem .7rem;font-size:.78rem" data-on-click="modalNovaDespesa()">+ Registar despesa</button></div>
          ${r.despesas.length ? r.despesas.map(d => `<div class="toolbar" style="margin:.15rem 0"><span>${esc(d.rotulo)}</span><b>${formatarMoeda(d.valor)}</b></div>`).join('') + '<hr style="border:0;border-top:1px solid var(--c-border);margin:.5rem 0">' : ''}
          ${window._finDespesas.length ? `<div class="tabela-wrapper" style="max-height:260px;overflow:auto"><table><tbody>${window._finDespesas.map(d => `<tr style="${d.anulada_em ? 'opacity:.5' : ''}">
            <td class="muted texto-pequeno">${esc(String(d.data).slice(0, 10))}</td><td>${esc(d.descricao)}<div class="muted texto-pequeno">${esc(d.rotulo)}${d.pela_gaveta ? ' · paga pela gaveta' : ''}${d.anulada_em ? ` · anulada: ${esc(d.motivo_anulacao || '')}` : ''}</div></td>
            <td class="negrito">${formatarMoeda(d.valor)}</td>
            <td>${d.anulada_em ? '' : `<button class="btn-perigo" style="padding:.2rem .5rem;font-size:.72rem" data-on-click="pedirAnularDespesa('${esc(d.id)}')">Anular</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">Sem despesas no período</div>'}
        </div>
      </div>`;
  } catch (e) { box.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function filtrarResultadoFin() {
  const de = document.getElementById('fin-de').value, ate = document.getElementById('fin-ate').value;
  if (!de || !ate || de > ate) { toast('Período inválido', 'erro'); return; }
  window._finFiltro = { de, ate };
  carregarResultadoFinanceiro();
}
function modalNovaDespesa() {
  abrirModal('Registar despesa', `
    <div class="campo"><label>Categoria</label><select id="dp-cat">${Object.entries(CAT_DESPESA).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="campo"><label>Descrição</label><input id="dp-desc" maxlength="200" placeholder="Ex.: Renda de Novembro"></div>
    <div class="campo"><label>Valor (Kz)</label><input id="dp-valor" type="number" min="0"></div>
    <div class="campo"><label>Data</label><input id="dp-data" type="date" value="${diaFin()}"></div>
    <div class="campo"><label style="font-weight:normal"><input type="checkbox" id="dp-gaveta"> Paga agora com dinheiro da gaveta (sai do caixa do dia)</label></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarDespesa()">Registar</button>`);
}
async function guardarDespesa() {
  const corpo = {
    categoria: document.getElementById('dp-cat').value, descricao: document.getElementById('dp-desc').value.trim(),
    valor: parseFloat(document.getElementById('dp-valor').value), data: document.getElementById('dp-data').value, pela_gaveta: document.getElementById('dp-gaveta').checked,
  };
  if (corpo.descricao.length < 3) { toast('Indique a descrição', 'erro'); return; }
  if (!(corpo.valor > 0)) { toast('Valor inválido', 'erro'); return; }
  try { await api('POST', '/financeiro/despesas', corpo); toast('Despesa registada', 'sucesso'); fecharModal(); carregarResultadoFinanceiro(); }
  catch (e) { toast(e.message, 'erro'); }
}
function pedirAnularDespesa(id) {
  const d = (window._finDespesas || []).find(x => x.id === id); if (!d) return;
  modalConfirmar('Anular despesa', `Anular <b>${esc(d.descricao)}</b> (${formatarMoeda(d.valor)})?${d.pela_gaveta ? ' O dinheiro volta à gaveta.' : ''} Fica registada como anulada.<br><br>
    <label for="dp-motivo" class="negrito">Motivo (obrigatório)</label><br><input type="text" id="dp-motivo" maxlength="200" style="width:100%;margin-top:.35rem">`, 'anularDespesaConfirmado', id);
}
async function anularDespesaConfirmado(id) {
  const motivo = (document.getElementById('dp-motivo') || {}).value || '';
  if (motivo.trim().length < 3) { toast('Indique o motivo', 'erro'); return; }
  fecharModal();
  try { await api('POST', `/financeiro/despesas/${id}/anular`, { motivo: motivo.trim() }); toast('Despesa anulada', 'sucesso'); carregarResultadoFinanceiro(); }
  catch (e) { toast(e.message, 'erro'); }
}
