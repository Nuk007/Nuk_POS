'use strict';
// Nuk_POS — Financeiro: resumo e documentos fiscais (FT/FR/NC).
// Scripts clássicos: as funções são globais e chamam-se umas às outras entre ficheiros (data-on-click).

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
    faturasCache = Array.isArray(faturas) ? faturas : [];

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

      ${['ADMIN', 'GERENTE'].includes(NUK.utilizador && NUK.utilizador.nivel_acesso) ? '<div id="fin-resultado" class="mb-3"></div>' : ''}
      <div class="card">
        <div class="card-header">
          <span class="card-titulo">Últimos documentos</span>
          <button class="btn-primario" style="padding:.3rem .75rem;font-size:.78rem" data-on-click="modalNovaFatura()">+ Emitir documento</button>
        </div>
        <div class="tabela-wrapper">
          <table>
            <thead><tr><th>Documento</th><th>Tipo</th><th>Cliente</th><th>IVA</th><th>Total</th><th>Data</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              ${faturasCache.slice(0, 20).map(linhaFatura).join('')}
              ${!faturasCache.length ? '<tr><td colspan="8" class="muted" style="text-align:center;padding:1rem">Sem documentos</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
    if (document.getElementById('fin-resultado') && typeof carregarResultadoFinanceiro === 'function') carregarResultadoFinanceiro();
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

// ─── Documentos fiscais: FT (factura), FR (factura-recibo), NC (nota de crédito) ───
const TIPOS_DOCUMENTO = { FT: 'Factura', FR: 'Factura-recibo', NC: 'Nota de crédito' };
let faturasCache = [];

function podeAnularDocumentos() {
  return ['ADMIN', 'GERENTE'].includes(NUK.utilizador && NUK.utilizador.nivel_acesso);
}

function linhaFatura(f) {
  const tipo = f.tipo_documento || 'FT';
  const situacao = tipo === 'NC'
    ? `<span class="muted">Anula ${esc(f.documento_origem_numero || '')}</span>`
    : f.anulada_por_numero
      ? `<span class="status-badge status-CANCELADO">Anulada (${esc(f.anulada_por_numero)})</span>`
      : '<span class="status-badge status-LIVRE">Válida</span>';
  const ficheiro = `${String(f.numero_fatura).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
  const anular = tipo !== 'NC' && !f.anulada_por_numero && podeAnularDocumentos()
    ? ` <button class="btn-perigo" style="padding:.25rem .6rem;font-size:.75rem" data-on-click="pedirNotaCredito('${f.id}')">Anular</button>` : '';
  return `
    <tr>
      <td class="negrito">${esc(f.numero_fatura)}</td>
      <td>${TIPOS_DOCUMENTO[tipo] || tipo}</td>
      <td>${esc(f.nome_cliente || f.cliente_nome || '—')}</td>
      <td class="muted">${formatarMoeda(f.iva)}</td>
      <td class="texto-primario negrito">${tipo === 'NC' ? '−' : ''}${formatarMoeda(f.total)}</td>
      <td class="muted">${formatarData(f.emitida_em)}</td>
      <td>${situacao}</td>
      <td style="white-space:nowrap"><button class="btn-secundario" style="padding:.25rem .6rem;font-size:.75rem" data-on-click="descarregarPdf('/financeiro/faturas/${f.id}/pdf','${ficheiro}')">PDF</button>${anular}</td>
    </tr>`;
}

function modalNovaFatura() {
  abrirModal('Emitir documento', `
    <div class="campo"><label>Tipo de documento</label>
      <select id="fat-tipo">
        <option value="FT">Factura (pagamento posterior)</option>
        <option value="FR">Factura-recibo (já pago)</option>
      </select>
    </div>
    <div class="campo"><label>Descrição</label><input type="text" id="fat-desc" maxlength="250" placeholder="Ex.: Aluguer do salão para evento"></div>
    <div class="campo"><label>Nome do cliente</label><input type="text" id="fat-nome" maxlength="200" placeholder="Opcional (consumidor final)"></div>
    <div class="campo"><label>NIF do cliente</label><input type="text" id="fat-nif" maxlength="20" placeholder="Opcional"></div>
    <div class="campo"><label>Valor total com IVA (Kz)</label><input type="number" id="fat-total" placeholder="0" min="0"></div>
    <p class="muted texto-pequeno mb-2">O IVA é calculado com a taxa definida nas Configurações. Um documento emitido não se altera: corrige-se com nota de crédito.</p>
    <button class="btn-primario btn-bloco" data-on-click="emitirFatura()">Emitir</button>
  `);
}

async function emitirFatura() {
  const tipo = document.getElementById('fat-tipo').value || 'FT';
  const descricao = document.getElementById('fat-desc').value.trim();
  const nome_cliente = document.getElementById('fat-nome').value.trim();
  const nif_cliente = document.getElementById('fat-nif').value.trim();
  const total = parseFloat(document.getElementById('fat-total').value) || 0;
  if (!descricao) { toast('Indique a descrição do que está a facturar', 'erro'); return; }
  if (!(total > 0)) { toast('Valor inválido', 'erro'); return; }
  try {
    const f = await api('POST', '/financeiro/faturas', { tipo, descricao, nome_cliente, nif_cliente, total_manual: total });
    toast(`${TIPOS_DOCUMENTO[tipo]} ${f.numero_fatura} emitida`, 'sucesso');
    fecharModal();
    carregarModulo('financeiro');
  } catch (e) { toast(e.message, 'erro'); }
}

/** Anular = emitir nota de crédito pelo total. Pede motivo e confirmação (regra do dono). */
function pedirNotaCredito(id) {
  const f = faturasCache.find(x => x.id === id);
  if (!f) return;
  // O campo do motivo vai dentro do texto do modalConfirmar (elementos em linha, válidos dentro de <p>)
  modalConfirmar('Anular documento',
    `Vai emitir uma <b>nota de crédito</b> que anula <b>${esc(f.numero_fatura)}</b> (${formatarMoeda(f.total)}). O documento original fica guardado e marcado como anulado. <b>Não pode ser desfeito.</b><br><br>
     <label for="nc-motivo" class="negrito">Motivo (obrigatório)</label><br>
     <input type="text" id="nc-motivo" maxlength="250" placeholder="Ex.: NIF do cliente errado" class="campo-motivo">`,
    'emitirNotaCreditoConfirmada', f.id);
}

async function emitirNotaCreditoConfirmada(id) {
  const motivo = document.getElementById('nc-motivo').value.trim();
  if (motivo.length < 5) { toast('Indique o motivo (pelo menos 5 caracteres)', 'erro'); return; }
  try {
    const nc = await api('POST', `/financeiro/faturas/${id}/nota-credito`, { motivo });
    toast(`Nota de crédito ${nc.numero_fatura} emitida`, 'sucesso');
    fecharModal();
    carregarModulo('financeiro');
  } catch (e) { toast(e.message, 'erro'); }
}
