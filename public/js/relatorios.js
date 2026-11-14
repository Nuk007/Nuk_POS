'use strict';
/**
 * Relatórios de gestão (ADMIN/GERENTE): vendas do período, formas de pagamento, funcionários, produtos,
 * horas, cancelamentos (quem/porquê) e talões de fecho de caixa (Z).
 * Sem handlers inline (CSP): data-on-click com argumentos literais.
 */
const FORMAS_REL = { CASH: 'Dinheiro', TPA: 'TPA', TRANSFERENCIA: 'Transferência', EXPRESS: 'Express', NUKCOIN: 'Nuk-Coin', CARTAO: 'Cartão de consumo', CONTA: 'Conta corrente' };
const ORIGENS_REL = { MESA: 'Mesa', BALCAO: 'Balcão', REMOTA: 'Remota', TAKEAWAY: 'Take Away', LAZER: 'Lazer', LOJA: 'Loja', QUARTO: 'Quarto' };
const diaLuanda = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
const dataHoraRel = d => d ? new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

async function modulo_relatorios(el) {
  if (!['ADMIN', 'GERENTE'].includes(NUK.utilizador && NUK.utilizador.nivel_acesso)) {
    el.innerHTML = '<div class="erro-msg">Relatórios só para administradores e gerentes</div>';
    return;
  }
  const f = window._relFiltro || { de: diaLuanda(), ate: diaLuanda() };
  try {
    const [r, sessoes] = await Promise.all([
      api('GET', `/relatorios/vendas?de=${f.de}&ate=${f.ate}`),
      (typeof licenciadoModulo !== 'function' || licenciadoModulo('caixa')) ? api('GET', '/caixa/sessoes').catch(() => []) : Promise.resolve([]),
    ]);
    const t = r.totais;
    const maxHora = Math.max(1, ...r.por_hora.map(h => h.valor));
    el.innerHTML = `
      <div class="toolbar" style="flex-wrap:wrap;gap:.5rem">
        <span class="secao-titulo">📈 Relatórios</span>
        <span style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
          <input type="date" id="rel-de" value="${esc(f.de)}"> a <input type="date" id="rel-ate" value="${esc(f.ate)}">
          <button class="btn-primario" style="padding:.3rem .75rem" data-on-click="aplicarFiltroRelatorio()">Ver</button>
          <button class="btn-secundario" style="padding:.3rem .6rem" data-on-click="periodoRelatorio('hoje')">Hoje</button>
          <button class="btn-secundario" style="padding:.3rem .6rem" data-on-click="periodoRelatorio('7')">7 dias</button>
          <button class="btn-secundario" style="padding:.3rem .6rem" data-on-click="periodoRelatorio('mes')">Este mês</button>
        </span>
      </div>
      <div class="kpi-grid mb-3">
        <div class="kpi-card"><div class="kpi-label">Vendas</div><div class="kpi-valor texto-primario">${formatarMoeda(t.valor)}</div><div class="kpi-sub">${t.pedidos} pedidos · ticket médio ${formatarMoeda(t.ticket_medio)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Por receber</div><div class="kpi-valor">${formatarMoeda(t.por_receber)}</div><div class="kpi-sub">Contas fechadas ainda não pagas</div></div>
        <div class="kpi-card"><div class="kpi-label">Descontos</div><div class="kpi-valor">${formatarMoeda(t.descontos)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Cancelamentos</div><div class="kpi-valor">${t.cancelados}</div><div class="kpi-sub">${formatarMoeda(t.valor_cancelado)}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem">
        <div class="card"><div class="card-header"><span class="card-titulo">Recebido por forma de pagamento</span></div>
          ${tabelaRel(['Forma', 'Valor'], Object.entries(r.recebido_por_forma).map(([k, v]) => [FORMAS_REL[k] || k, formatarMoeda(v)]), 'Sem recebimentos')}</div>
        <div class="card"><div class="card-header"><span class="card-titulo">Por funcionário</span></div>
          ${tabelaRel(['Funcionário', 'Pedidos', 'Vendas', 'Comissão', 'Cancel.'], r.por_funcionario.map(x => [esc(x.nome), x.pedidos, formatarMoeda(x.valor), x.comissao_pct ? `${formatarMoeda(x.comissao)} <span class="muted texto-pequeno">(${x.comissao_pct}%)</span>` : '—', x.cancelamentos]), 'Sem vendas')}</div>
        <div class="card"><div class="card-header"><span class="card-titulo">Produtos mais vendidos</span></div>
          ${tabelaRel(['Produto', 'Qtd', 'Valor'], r.por_produto.map(x => [esc(x.nome), x.quantidade, formatarMoeda(x.valor)]), 'Sem vendas')}</div>
        <div class="card"><div class="card-header"><span class="card-titulo">Vendas por hora</span></div>
          ${r.por_hora.length ? r.por_hora.map(h => `<div style="display:flex;align-items:center;gap:.5rem;margin:.2rem 0">
            <span class="muted texto-pequeno" style="width:2.6rem">${String(h.hora).padStart(2, '0')}h</span>
            <span style="flex:1;background:var(--c-border);border-radius:4px;height:.8rem"><span style="display:block;height:100%;width:${Math.round(h.valor / maxHora * 100)}%;background:var(--c-primary,#E8650A);border-radius:4px"></span></span>
            <span class="texto-pequeno" style="width:7rem;text-align:right">${formatarMoeda(h.valor)}</span></div>`).join('') : '<div class="muted">Sem vendas</div>'}</div>
      </div>
      <div class="card mt-2"><div class="card-header"><span class="card-titulo">Cancelamentos — quem e porquê</span></div>
        ${tabelaRel(['Quando', 'Origem', 'Valor', 'Cancelado por', 'Motivo'], r.cancelamentos.map(c => [dataHoraRel(c.cancelado_em || c.criado_em), (ORIGENS_REL[c.origem] || c.origem || '') + (c.mesa ? ` ${esc(c.mesa)}` : ''), formatarMoeda(c.total), esc(c.cancelado_por_nome || '—'), esc(c.motivo_cancelamento || '—')]), 'Sem cancelamentos no período')}</div>
      ${Array.isArray(sessoes) && sessoes.length ? `<div class="card mt-2"><div class="card-header"><span class="card-titulo">Fechos de caixa (talão Z)</span></div>
        ${tabelaRel(['Aberto', 'Fechado', 'Esperado', 'Diferença', ''], sessoes.slice(0, 15).map(s => [
          `${dataHoraRel(s.aberta_em)}<div class="muted texto-pequeno">${esc(s.aberta_por_nome || '')}</div>`,
          s.fechada_em ? `${dataHoraRel(s.fechada_em)}<div class="muted texto-pequeno">${esc(s.fechada_por_nome || '')}</div>` : '<span class="muted">aberto</span>',
          s.esperado !== null && s.esperado !== undefined ? formatarMoeda(s.esperado) : '—',
          s.diferenca !== null && s.diferenca !== undefined ? `<span style="color:${Number(s.diferenca) < 0 ? 'var(--c-danger)' : 'inherit'}">${formatarMoeda(s.diferenca)}</span>` : '—',
          `<button class="btn-secundario" style="padding:.25rem .6rem;font-size:.75rem" data-on-click="descarregarPdf('/relatorios/caixa/${esc(s.id)}/talao.pdf','fecho-caixa-${esc(String(s.id).slice(0, 8))}.pdf')">Talão Z</button>`]), '')}</div>` : ''}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}

function tabelaRel(cabecalho, linhas, vazio) {
  if (!linhas.length) return `<div class="muted">${vazio}</div>`;
  return `<div class="tabela-wrapper"><table><thead><tr>${cabecalho.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function aplicarFiltroRelatorio() {
  const de = document.getElementById('rel-de').value, ate = document.getElementById('rel-ate').value;
  if (!de || !ate) { toast('Escolha as duas datas', 'erro'); return; }
  if (de > ate) { toast('A data inicial é posterior à final', 'erro'); return; }
  window._relFiltro = { de, ate };
  carregarModulo('relatorios');
}
function periodoRelatorio(tipo) {
  const hoje = diaLuanda();
  let de = hoje;
  if (tipo === '7') { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 6); de = d.toISOString().slice(0, 10); }
  if (tipo === 'mes') de = hoje.slice(0, 8) + '01';
  window._relFiltro = { de, ate: hoje };
  carregarModulo('relatorios');
}
