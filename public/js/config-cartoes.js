'use strict';
// Nuk_POS — Cartões das Configurações: tabelas de preço, impressão em rede, resumo diário, fluxos de venda, cartões de consumo e contas correntes.
// Scripts clássicos: as funções são globais e chamam-se umas às outras entre ficheiros (data-on-click).

// ─── Configurações → Tabelas de preço (níveis) e prato do dia ───
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const FLUXOS_PRECO = { MESA: 'Mesa', BALCAO: 'Balcão', REMOTA: 'Remota (QR)', TAKEAWAY: 'Take Away', LAZER: 'Lazer', LOJA: 'Loja', QUARTO: 'Quarto' };
function descreverTabela(t) {
  const dias = Array.isArray(t.dias) && t.dias.length ? t.dias.map(d => DIAS_SEMANA[d]).join(', ') : 'todos os dias';
  const hora = t.hora_inicio ? `${String(t.hora_inicio).slice(0, 5)}–${String(t.hora_fim).slice(0, 5)}` : 'todo o dia';
  const fluxos = Array.isArray(t.origens) && t.origens.length ? t.origens.map(o => FLUXOS_PRECO[o] || o).join(', ') : 'todos os fluxos';
  const datas = t.data_inicio || t.data_fim ? ` · campanha ${t.data_inicio ? String(t.data_inicio).slice(0, 10) : '…'} a ${t.data_fim ? String(t.data_fim).slice(0, 10) : '…'}` : '';
  const desc = t.desconto_pct ? ` · −${Number(t.desconto_pct)}% no resto` : '';
  return `${dias} · ${hora} · ${fluxos} · prioridade ${t.prioridade}${datas}${desc}`;
}
function cartaoTabelasPreco(tabelas) {
  return `
      <div class="card mt-2" style="max-width:700px">
        <div class="card-titulo mb-2">💲 TABELAS DE PREÇO (ATÉ 5)</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.75rem">Preços diferentes por horário, por fluxo de venda e por datas (ex.: Happy hour das 17h às 19h, Esplanada, campanha de Natal com −10%). Fora de uma tabela, ou para produtos sem preço nela, vale o preço normal da ementa. Se várias servirem ao mesmo tempo, ganha a de maior prioridade.</div>
        ${tabelas.length ? tabelas.map(t => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--c-border);flex-wrap:wrap">
            <div style="min-width:0"><b>${esc(t.nome)}</b> ${t.ativa ? '' : '<span class="muted">(desligada)</span>'}<div class="muted" style="font-size:.78rem">${esc(descreverTabela(t))} · ${Object.keys(t.precos || {}).length} preços</div></div>
            <div class="row-acoes">
              <button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="modalPrecosTabela('${esc(t.id)}')">Preços</button>
              <button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="modalTabelaPreco('${esc(t.id)}')">Editar</button>
              <button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="alternarTabelaPreco('${esc(t.id)}',${t.ativa})">${t.ativa ? 'Desligar' : 'Ligar'}</button>
              <button class="btn-perigo" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="pedirApagarTabelaPreco('${esc(t.id)}')">✕</button>
            </div>
          </div>`).join('') : '<div class="muted" style="margin-bottom:.5rem">Ainda não há tabelas: vale sempre o preço da ementa.</div>'}
        ${tabelas.length < 5 ? '<button class="btn-primario" style="margin-top:.75rem" data-on-click="modalTabelaPreco(\'\')">+ Nova tabela de preço</button>' : ''}
      </div>`;
}
function modalTabelaPreco(id) {
  const t = (window._tabelasPreco || []).find(x => x.id === id) || { nome: '', prioridade: 1, dias: null, origens: null, hora_inicio: null, hora_fim: null };
  const marcado = (lista, v) => (Array.isArray(lista) && lista.includes(v) ? 'checked' : '');
  abrirModal(id ? 'Editar tabela de preço' : 'Nova tabela de preço', `
    <div class="campo"><label>Nome</label><input id="tp-nome" maxlength="60" value="${esc(t.nome)}" placeholder="Ex.: Happy hour"></div>
    <div class="campo"><label>Dias (nenhum marcado = todos)</label><div style="display:flex;gap:.5rem;flex-wrap:wrap">${DIAS_SEMANA.map((d, i) => `<label style="font-weight:normal"><input type="checkbox" class="tp-dia" value="${i}" ${marcado(t.dias, i)}> ${d}</label>`).join('')}</div></div>
    <div style="display:flex;gap:.5rem"><div class="campo" style="flex:1"><label>Das (opcional)</label><input type="time" id="tp-ini" value="${t.hora_inicio ? String(t.hora_inicio).slice(0, 5) : ''}"></div>
      <div class="campo" style="flex:1"><label>Às</label><input type="time" id="tp-fim" value="${t.hora_fim ? String(t.hora_fim).slice(0, 5) : ''}"></div></div>
    <div class="campo"><label>Fluxos de venda (nenhum marcado = todos)</label><div style="display:flex;gap:.5rem;flex-wrap:wrap">${Object.entries(FLUXOS_PRECO).map(([k, v]) => `<label style="font-weight:normal"><input type="checkbox" class="tp-fluxo" value="${k}" ${marcado(t.origens, k)}> ${v}</label>`).join('')}</div></div>
    <div style="display:flex;gap:.5rem"><div class="campo" style="flex:1"><label>Campanha de (opcional)</label><input type="date" id="tp-dini" value="${t.data_inicio ? String(t.data_inicio).slice(0, 10) : ''}"></div>
      <div class="campo" style="flex:1"><label>Até</label><input type="date" id="tp-dfim" value="${t.data_fim ? String(t.data_fim).slice(0, 10) : ''}"></div></div>
    <div class="campo"><label>Desconto geral (%) nos produtos sem preço próprio nesta tabela (opcional)</label><input type="number" id="tp-desc" min="0" max="99" step="0.5" value="${t.desconto_pct ? Number(t.desconto_pct) : ''}" placeholder="Ex.: 10"></div>
    <div class="campo"><label>Prioridade (1–99; maior ganha)</label><input type="number" id="tp-prio" min="1" max="99" value="${Number(t.prioridade) || 1}"></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarTabelaPreco('${esc(id || '')}')">Guardar</button>`);
}
async function guardarTabelaPreco(id) {
  const marcados = cls => [...document.querySelectorAll(cls)].filter(x => x.checked).map(x => x.value);
  const corpo = {
    nome: document.getElementById('tp-nome').value.trim(),
    dias: marcados('.tp-dia').map(Number), origens: marcados('.tp-fluxo'),
    hora_inicio: document.getElementById('tp-ini').value || null, hora_fim: document.getElementById('tp-fim').value || null,
    prioridade: parseInt(document.getElementById('tp-prio').value, 10) || 1,
    data_inicio: document.getElementById('tp-dini').value || null, data_fim: document.getElementById('tp-dfim').value || null,
    desconto_pct: document.getElementById('tp-desc').value === '' ? null : parseFloat(document.getElementById('tp-desc').value),
  };
  if (corpo.data_inicio && corpo.data_fim && corpo.data_fim < corpo.data_inicio) { toast('A data de fim é anterior à de início', 'erro'); return; }
  if (!corpo.nome) { toast('Indique o nome', 'erro'); return; }
  if (!!corpo.hora_inicio !== !!corpo.hora_fim) { toast('Indique as duas horas ou nenhuma', 'erro'); return; }
  try {
    await api(id ? 'PUT' : 'POST', id ? `/precos/tabelas/${id}` : '/precos/tabelas', corpo);
    toast('Tabela guardada', 'sucesso'); fecharModal(); carregarModulo('configuracoes');
  } catch (e) { toast(e.message, 'erro'); }
}
async function alternarTabelaPreco(id, ativa) {
  try { await api('PUT', `/precos/tabelas/${id}`, { ativa: !ativa }); carregarModulo('configuracoes'); } catch (e) { toast(e.message, 'erro'); }
}
function pedirApagarTabelaPreco(id) {
  modalConfirmar('Apagar tabela de preço', 'A tabela e os preços dela são apagados. Os pedidos já feitos não mudam.', 'apagarTabelaPrecoConfirmado', id);
}
async function apagarTabelaPrecoConfirmado(id) {
  fecharModal();
  try { await api('DELETE', `/precos/tabelas/${id}`); toast('Tabela apagada', 'sucesso'); carregarModulo('configuracoes'); } catch (e) { toast(e.message, 'erro'); }
}
function modalPrecosTabela(id) {
  const t = (window._tabelasPreco || []).find(x => x.id === id); if (!t) return;
  const prods = (window._produtosCfg || []).filter(p => p.ativo !== false);
  abrirModal(`Preços · ${t.nome}`, `
    <p class="muted texto-pequeno" style="margin-bottom:.5rem">Deixe vazio para usar o preço normal da ementa.</p>
    <div class="tabela-wrapper" style="max-height:55vh;overflow:auto"><table><thead><tr><th>Produto</th><th>Normal</th><th>Nesta tabela</th></tr></thead><tbody>
      ${prods.map(p => `<tr><td>${esc(p.nome)}<div class="muted texto-pequeno">${esc(p.categoria || '')}</div></td><td class="muted">${formatarMoeda(p.preco)}</td>
        <td><input type="number" min="0" class="tp-preco" data-produto="${esc(p.id)}" value="${t.precos && t.precos[p.id] !== undefined ? t.precos[p.id] : ''}" style="width:7rem"></td></tr>`).join('')}
    </tbody></table></div>
    <button class="btn-primario btn-bloco" style="margin-top:.6rem" data-on-click="guardarPrecosTabela('${esc(id)}')">Guardar preços</button>`);
}
async function guardarPrecosTabela(id) {
  const precos = [...document.querySelectorAll('.tp-preco')].map(i => ({ produto_id: i.getAttribute('data-produto'), preco: i.value === '' ? null : parseFloat(i.value) }));
  if (!precos.length) { fecharModal(); return; }
  try { await api('PUT', `/precos/tabelas/${id}/precos`, { precos }); toast('Preços guardados', 'sucesso'); fecharModal(); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
async function alternarPratoDoDia(id, ativo) {
  try { await api('PUT', `/precos/prato-do-dia/${id}`, { ativo: !ativo }); toast(ativo ? 'Retirado do prato do dia' : 'Marcado como prato do dia', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}

// ─── Configurações → Impressão em rede (agente local) ───
async function carregarAgentesImpressao() {
  const box = document.getElementById('cfg-agentes');
  if (!box) return;
  try {
    const lista = await api('GET', '/impressao/agentes') || [];
    const activos = lista.filter(a => !a.revogado_em);
    box.innerHTML = `
      <div class="card-titulo mb-2">🖨️ IMPRESSÃO EM REDE (AGENTE LOCAL)</div>
      <div class="muted" style="font-size:.82rem;margin-bottom:.75rem">Para impressoras térmicas Wi-Fi/cabo (IP:9100): corra o agente num computador da mesma rede. Depois, em cada dispositivo, 🖨️ → «Usar rede» com o IP da impressora.</div>
      ${activos.length ? activos.map(a => `<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--c-border)">
        <div><b>${esc(a.nome)}</b> <span class="texto-pequeno" style="color:${a.online ? 'var(--c-success)' : 'var(--c-muted)'}">${a.online ? '● ligado' : '○ desligado'}</span>${a.fila ? ` <span class="muted texto-pequeno">${a.fila} na fila</span>` : ''}</div>
        <button class="btn-perigo" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="pedirRevogarAgente('${esc(a.id)}')">Revogar</button></div>`).join('') : '<div class="muted" style="margin-bottom:.5rem">Nenhum agente.</div>'}
      <div style="margin-top:.8rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end">
        <div class="campo" style="flex:1;min-width:12rem;margin:0"><label>Nome do computador</label><input id="ag-nome" maxlength="80" placeholder="Ex.: PC da cozinha"></div>
        <button class="btn-primario" data-on-click="criarAgenteImpressao()">Criar agente</button>
        <a class="btn-secundario" style="text-decoration:none" href="/descargas/agente-impressao.js" download>Descarregar o programa</a>
      </div>`;
  } catch (e) { box.innerHTML = ''; }
}
async function criarAgenteImpressao() {
  const nome = document.getElementById('ag-nome').value.trim();
  try {
    const a = await api('POST', '/impressao/agentes', { nome });
    abrirModal('Agente criado', `
      <p>Copie o token agora: <b>não volta a aparecer</b>.</p>
      <pre style="white-space:pre-wrap;word-break:break-all;background:var(--c-surface-2,#111);padding:.6rem;border-radius:8px">${esc(a.token)}</pre>
      <p class="muted texto-pequeno">No computador da rede (com Node.js 18+): <code>node agente.js --token ${esc(a.token)}</code></p>`);
    carregarAgentesImpressao();
  } catch (e) { toast(e.message, 'erro'); }
}
function pedirRevogarAgente(id) {
  modalConfirmar('Revogar agente', 'O token deste agente <b>deixa de funcionar</b> e as impressoras de rede param até criar outro. Continuar?', 'revogarAgenteConfirmado', id);
}
async function revogarAgenteConfirmado(id) {
  fecharModal();
  try { await api('POST', `/impressao/agentes/${id}/revogar`, {}); toast('Agente revogado', 'sucesso'); carregarAgentesImpressao(); }
  catch (e) { toast(e.message, 'erro'); }
}

// ─── Configurações → Resumo diário para o dono (WhatsApp) ───
function cartaoResumoDiario(cfg) {
  const ativo = cfg.resumo_diario_ativo === 'true';
  return `
      <div class="card mt-2" style="max-width:700px">
        <div class="card-titulo mb-2">📊 RESUMO DIÁRIO NO WHATSAPP</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.75rem">Todas as manhãs, à hora escolhida, o resumo de ontem (receita, pedidos, despesas, resultado e o que pede atenção) segue para este número. Também fica em Finanças → Relatórios.</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end">
          <label style="display:flex;gap:.4rem;align-items:center;margin:0 .5rem .45rem 0"><input type="checkbox" id="rd-ativo" ${ativo ? 'checked' : ''}> Ligado</label>
          <div class="campo" style="flex:2;min-width:11rem;margin:0"><label>WhatsApp (9XXXXXXXX)</label><input id="rd-telefone" inputmode="tel" maxlength="20" value="${esc(cfg.resumo_diario_telefone || '')}"></div>
          <div class="campo" style="flex:1;min-width:7rem;margin:0"><label>Hora</label><input id="rd-hora" type="time" value="${esc(cfg.resumo_diario_hora || '07:30')}"></div>
          <button class="btn-primario" data-on-click="guardarResumoDiario()">Guardar</button>
        </div>
      </div>`;
}
async function guardarResumoDiario() {
  const corpo = { ativo: document.getElementById('rd-ativo').checked, telefone: document.getElementById('rd-telefone').value.trim(), hora: document.getElementById('rd-hora').value };
  try { await api('PUT', '/relatorios/resumo-diario/config', corpo); toast(corpo.ativo ? 'Resumo diário ligado' : 'Resumo diário guardado (desligado)', 'sucesso'); }
  catch (e) { toast(e.message, 'erro'); }
}

// ─── Configurações → Contas correntes (crédito a clientes; só ADMIN) ───
// Cartões de consumo: cada valor é um botão no Caixa → Cartões (como os quartos). Não se apagam: desactivam-se.
const euAdmin = () => typeof NUK !== 'undefined' && NUK.utilizador && NUK.utilizador.nivel_acesso === 'ADMIN';
// O que cada fluxo vende e os tempos dos quartos estão em config-fluxos.js
const rotuloCategoria = c => String(c).charAt(0) + String(c).slice(1).toLowerCase().replace(/_/g, ' ');
function cartaoTiposCartao(tipos, lotes = []) {
  const activos = tipos.filter(t => t.ativo);
  return `
      <div class="card mt-2" style="max-width:700px">
        <div class="card-titulo mb-2">💳 CARTÕES DE CONSUMO</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.75rem">Cada cartão aparece como botão em Caixa → Cartões de consumo. Cobra-se o valor do cartão, sem desconto. O valor não muda depois de criado: crie outro e desactive o antigo.</div>
        ${tipos.length ? tipos.map(t => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--c-border);flex-wrap:wrap${t.ativo ? '' : ';opacity:.55'}">
            <div style="min-width:0"><b>${formatarMoeda(t.valor)}</b>${t.ativo ? '' : ' <span class="muted" style="font-size:.78rem">(desactivado)</span>'} <span class="muted" style="font-size:.78rem">${Number(t.por_vender) || 0} impressos por vender</span></div>
            <div class="row-acoes" style="align-items:center">
              <input id="tc-nome-${esc(t.id)}" value="${esc(t.nome || '')}" placeholder="Nome (opcional)" maxlength="60" style="width:11rem">
              <button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="guardarNomeTipoCartao('${esc(t.id)}')">Guardar</button>
              ${t.ativo ? `<button class="btn-perigo" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="pedirDesactivarTipoCartao('${esc(t.id)}')">Desactivar</button>`
                : `<button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="activarTipoCartao('${esc(t.id)}')">Activar</button>`}
            </div>
          </div>`).join('') : '<div class="muted" style="margin-bottom:.5rem">Ainda não há cartões.</div>'}
        <div style="margin-top:.9rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end">
          <div class="campo" style="flex:1;min-width:8rem;margin:0"><label>Valor (Kz)</label><input type="number" id="tc-valor" min="1000" max="500000" step="500" placeholder="3000"></div>
          <div class="campo" style="flex:2;min-width:10rem;margin:0"><label>Nome (opcional)</label><input id="tc-nome" maxlength="60" placeholder="Ex.: Cartão piscina"></div>
          <button class="btn-primario" data-on-click="criarTipoCartao()">+ Novo cartão</button>
        </div>
        ${euAdmin() ? `<div class="card-titulo mt-2" style="margin-top:1.2rem">GERAR CÓDIGOS (LOTES PARA IMPRIMIR)</div>
        <div class="muted" style="font-size:.82rem;margin:.3rem 0 .6rem">Só o Administrador gera códigos de cartão: aqui, ou no Caixa quando um cartão esgota (com as credenciais dele ou de quem tem o perfil «Imprimir cartões»). Imprime-se sempre em folhas A4 completas, de 10 cartões; imprima em cartolina e recorte. Cada cartão fica sem saldo até o Caixa o vender: perdido antes disso, não vale nada.</div>
        ${activos.length ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end">
          <div class="campo" style="flex:1;min-width:8rem;margin:0"><label>Cartão</label><select id="lote-valor">${activos.map(t => `<option value="${Number(t.valor)}">${formatarMoeda(t.valor)}${t.nome ? ' · ' + esc(t.nome) : ''}</option>`).join('')}</select></div>
          <div class="campo" style="width:11rem;margin:0"><label>Folhas A4 (10 cartões cada)</label><select id="lote-folhas">${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}" ${i === 1 ? 'selected' : ''}>${i + 1} folha${i ? 's' : ''} · ${(i + 1) * 10} cartões</option>`).join('')}</select></div>
          <button class="btn-primario" data-on-click="gerarLoteCartoes()">Gerar lote</button>
        </div>` : '<div class="muted">Active ou crie um cartão primeiro.</div>'}
        <div class="tabela-wrapper mt-2"><table>
          <thead><tr><th>Lote</th><th style="text-align:right">Valor</th><th style="text-align:right">Cartões</th><th style="text-align:right">Vendidos</th><th>Criado</th><th></th></tr></thead>
          <tbody>${lotes.map(l => `<tr><td><b>N.º ${l.numero}</b></td><td style="text-align:right">${formatarMoeda(l.valor)}</td><td style="text-align:right">${l.quantidade}</td><td style="text-align:right">${l.vendidos}</td>
              <td style="font-size:.78rem">${new Date(l.criado_em).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })}${l.criado_por_nome ? ` · ${esc(l.criado_por_nome)}` : ''}${l.pedido_por_nome ? ` <span class="muted">(pedido no Caixa por ${esc(l.pedido_por_nome)})</span>` : ''}</td>
              <td><button class="btn-secundario" style="padding:.2rem .55rem;font-size:.75rem" data-on-click="imprimirLoteCartoes('${esc(l.id)}','${l.numero}')">🖨️ Imprimir</button></td></tr>`).join('')
            || '<tr><td colspan="6" class="muted" style="text-align:center;padding:1rem">Ainda não gerou lotes</td></tr>'}</tbody></table></div>` : ''}
      </div>`;
}
async function gerarLoteCartoes() {
  const valor = parseInt(document.getElementById('lote-valor').value, 10);
  // Sempre folhas A4 completas (decisão do dono de 21/11/2026): escolhe-se o número de folhas, 10 cartões cada
  const folhas = parseInt(document.getElementById('lote-folhas').value, 10);
  if (!(folhas >= 1 && folhas <= 20)) return toast('Escolha de 1 a 20 folhas A4', 'aviso');
  const quantidade = folhas * 10;
  try {
    const l = await api('POST', '/caixa/cartoes/lotes', { valor, quantidade });
    toast(`Lote N.º ${l.numero}: ${l.quantidade} cartões de ${formatarMoeda(l.valor)}. A descarregar a folha para imprimir…`, 'sucesso', 6000);
    imprimirLoteCartoes(l.id, l.numero);
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message, 'erro'); }
}
function imprimirLoteCartoes(id, numero) { descarregarPdf(`/caixa/cartoes/lotes/${id}/pdf`, `cartoes-lote-${numero}.pdf`); }
async function criarTipoCartao() {
  const valor = parseInt(document.getElementById('tc-valor').value, 10);
  if (!(valor >= 1000 && valor <= 500000)) return toast('Valor de 1 000 a 500 000 Kz', 'aviso');
  try {
    await api('POST', '/caixa/cartoes/tipos', { valor, nome: document.getElementById('tc-nome').value });
    toast(`Cartão de ${formatarMoeda(valor)} criado`, 'sucesso');
    carregarModulo('configuracoes');
  } catch (e) { toast(e.message, 'erro'); }
}
async function guardarNomeTipoCartao(id) {
  try {
    await api('PUT', `/caixa/cartoes/tipos/${id}`, { nome: document.getElementById(`tc-nome-${id}`).value });
    toast('Nome guardado', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
}
function pedirDesactivarTipoCartao(id) {
  modalConfirmar('Desactivar cartão', 'O botão deixa de aparecer no Caixa. Os cartões já vendidos continuam a valer e os impressos deste valor ainda podem ser vendidos pelo código noutra altura (active-o de novo).', 'desactivarTipoCartaoConfirmado', id);
}
async function desactivarTipoCartaoConfirmado(id) {
  try { await api('PUT', `/caixa/cartoes/tipos/${id}`, { ativo: false }); fecharModal(); carregarModulo('configuracoes'); } catch (e) { toast(e.message, 'erro'); }
}
async function activarTipoCartao(id) {
  try { await api('PUT', `/caixa/cartoes/tipos/${id}`, { ativo: true }); carregarModulo('configuracoes'); } catch (e) { toast(e.message, 'erro'); }
}

function cartaoContasCorrentes(contas, clientes) {
  const ativas = contas.filter(c => c.conta_corrente_ativa);
  return `
      <div class="card mt-2" style="max-width:700px">
        <div class="card-titulo mb-2">📒 CONTAS CORRENTES (CRÉDITO A CLIENTES)</div>
        <div class="muted" style="font-size:.82rem;margin-bottom:.75rem">Clientes autorizados podem consumir a crédito até ao limite: no Caixa → Receber escolhe-se «Conta corrente». A dívida paga-se em Caixa → Contas correntes.</div>
        ${ativas.length ? ativas.map(c => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--c-border);flex-wrap:wrap">
            <div style="min-width:0"><b>${esc(c.nome)}</b> <span class="muted" style="font-size:.78rem">dívida ${formatarMoeda(c.saldo)}</span></div>
            <div class="row-acoes" style="align-items:center">
              <input type="number" id="cc-lim-${esc(c.id)}" min="0" value="${Number(c.limite_credito)}" style="width:8rem" title="Limite de crédito (Kz)">
              <button class="btn-secundario" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="guardarLimiteConta('${esc(c.id)}')">Guardar limite</button>
              <button class="btn-perigo" style="padding:.25rem .6rem;font-size:.78rem" data-on-click="pedirRetirarConta('${esc(c.id)}')">Retirar</button>
            </div>
          </div>`).join('') : '<div class="muted" style="margin-bottom:.5rem">Nenhum cliente com conta corrente.</div>'}
        <div style="margin-top:.9rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end">
          <div class="campo" style="flex:2;min-width:12rem;margin:0"><label>Autorizar cliente</label><select id="cc-cliente">
            <option value="">— escolher cliente registado —</option>
            ${clientes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.telefone ? ' · ' + esc(c.telefone) : ''}</option>`).join('')}
          </select></div>
          <div class="campo" style="flex:1;min-width:8rem;margin:0"><label>Limite (Kz)</label><input type="number" id="cc-limite" min="0" placeholder="0"></div>
          <button class="btn-primario" data-on-click="autorizarContaCorrente()">Autorizar</button>
        </div>
      </div>`;
}
async function autorizarContaCorrente() {
  const id = document.getElementById('cc-cliente').value;
  const limite = parseFloat(document.getElementById('cc-limite').value);
  if (!id) { toast('Escolha o cliente', 'erro'); return; }
  if (!(limite > 0)) { toast('Indique o limite de crédito', 'erro'); return; }
  try { await api('PUT', `/caixa/conta-corrente/${id}`, { ativa: true, limite }); toast('Conta corrente autorizada', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
async function guardarLimiteConta(id) {
  const limite = parseFloat(document.getElementById(`cc-lim-${id}`).value);
  if (!(limite >= 0)) { toast('Limite inválido', 'erro'); return; }
  try { await api('PUT', `/caixa/conta-corrente/${id}`, { limite }); toast('Limite actualizado', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
function pedirRetirarConta(id) {
  modalConfirmar('Retirar conta corrente', 'O cliente deixa de poder consumir a crédito. A dívida que já tem <b>mantém-se</b> e continua a poder ser paga no Caixa.', 'retirarContaConfirmado', id);
}
async function retirarContaConfirmado(id) {
  fecharModal();
  try { await api('PUT', `/caixa/conta-corrente/${id}`, { ativa: false }); toast('Conta corrente retirada', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
