'use strict';
/**
 * Compras pontuais: pagas só com o dinheiro do caixa do dia e só de produtos cadastrados no stock.
 * Sem handlers inline (CSP): data-on-click com argumentos literais.
 */
async function modulo_compras(el) {
  try {
    const cx = await api('GET', '/caixa');
    window._caixaEstado = cx;
    if (!cx.aberta) {
      el.innerHTML = `<div class="toolbar"><span class="secao-titulo">🛒 Compras pontuais</span></div>
        <div class="card" style="max-width:520px"><p style="margin-bottom:.8rem">O caixa do dia está <b>fechado</b>. As compras pontuais saem do dinheiro do caixa, por isso abra-o primeiro.</p>
        <button class="btn-primario" data-on-click="carregarModulo('caixa')">Ir para o Caixa do dia</button></div>`;
      return;
    }
    const [stock, compras] = await Promise.all([api('GET', '/stock?limit=500'), api('GET', '/compras')]);
    window._comprasItens = (Array.isArray(stock) ? stock : (stock.data || []));
    const gaveta = cx.resumo.dinheiro_esperado;
    el.innerHTML = `
      <div class="toolbar"><span class="secao-titulo">🛒 Compras pontuais</span><span class="muted">Dinheiro disponível no caixa: <b>${formatarMoeda(gaveta)}</b></span></div>
      <div class="card" style="max-width:560px">
        <div class="card-titulo">NOVA COMPRA</div>
        ${window._comprasItens.length ? `
        <div class="campo"><label>Produto (só os cadastrados no stock)</label>
          <select id="cp-item" data-on-change="compraUnidade(this.value)">${window._comprasItens.map(i => `<option value="${esc(i.id)}">${esc(i.nome)} (${esc(i.unidade)})</option>`).join('')}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
          <div class="campo"><label>Quantidade <span id="cp-un" class="muted">${esc(window._comprasItens[0].unidade)}</span></label><input id="cp-qtd" type="number" min="0" step="any"></div>
          <div class="campo"><label>Valor pago (Kz)</label><input id="cp-valor" type="number" min="0" step="any"></div>
        </div>
        <div class="campo"><label>Fornecedor</label><input id="cp-forn" placeholder="Opcional" maxlength="120"></div>
        <div class="campo"><label>Observações</label><input id="cp-obs" placeholder="Opcional" maxlength="500"></div>
        <button class="btn-primario btn-bloco" data-on-click="registarCompra()">Registar compra e tirar do caixa</button>`
        : `<p class="muted">Ainda não há produtos no stock. Cadastre-os primeiro em Stock; só se compra o que está cadastrado.</p>
           <button class="btn-secundario" data-on-click="carregarModulo('stock')">Ir para Stock</button>`}
      </div>
      <div class="card tabela-wrapper mt-2"><table>
        <thead><tr><th>Quando</th><th>Produto</th><th style="text-align:right">Qtd.</th><th style="text-align:right">Valor</th><th>Fornecedor</th><th></th></tr></thead>
        <tbody>${compras.map(c => `<tr style="${c.anulada_em ? 'opacity:.55;text-decoration:line-through' : ''}">
          <td>${new Date(c.criado_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}</td><td>${esc(c.item_nome)}</td>
          <td style="text-align:right">${esc(c.quantidade)} ${esc(c.unidade)}</td><td style="text-align:right">${formatarMoeda(c.valor_total)}</td><td>${esc(c.fornecedor || '')}</td>
          <td>${!c.anulada_em && c.sessao_aberta ? `<button class="btn-secundario" data-on-click="pedirAnularCompra('${esc(c.id)}')">Anular</button>` : (c.anulada_em ? 'Anulada' : '')}</td></tr>`).join('')
          || '<tr><td colspan="6" class="muted" style="text-align:center;padding:1rem">Ainda sem compras</td></tr>'}</tbody></table></div>`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function compraUnidade(id) {
  const i = (window._comprasItens || []).find(x => x.id === id);
  const u = document.getElementById('cp-un'); if (i && u) u.textContent = i.unidade;
}
async function registarCompra() {
  const corpo = {
    stock_item_id: document.getElementById('cp-item').value,
    quantidade: parseFloat(document.getElementById('cp-qtd').value),
    valor_total: parseFloat(document.getElementById('cp-valor').value),
    fornecedor: document.getElementById('cp-forn').value.trim() || undefined,
    observacoes: document.getElementById('cp-obs').value.trim() || undefined,
  };
  if (!(corpo.quantidade > 0) || !(corpo.valor_total > 0)) { toast('Indique a quantidade e o valor pago', 'erro'); return; }
  try {
    const r = await api('POST', '/compras', corpo);
    toast(`Compra registada: ${r.item}. Restam ${formatarMoeda(r.dinheiro_na_gaveta)} no caixa`, 'sucesso', 6000);
    carregarModulo('compras');
  } catch (e) { toast(e.message, 'erro'); }
}
function pedirAnularCompra(id) {
  modalConfirmar('Anular compra', 'Tem a certeza que quer <b>anular esta compra</b>? O dinheiro volta ao caixa e a quantidade sai do stock.', 'anularCompra', id);
}
async function anularCompra(id) {
  try { await api('POST', `/compras/${id}/anular`); fecharModal(); toast('Compra anulada', 'sucesso'); carregarModulo('compras'); }
  catch (e) { fecharModal(); toast(e.message, 'erro'); }
}
