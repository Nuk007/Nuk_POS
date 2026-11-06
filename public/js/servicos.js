'use strict';
/**
 * Serviços: Avarias e danos | Prazos de manutenção (operação) e cartão «Itens e manutenções» em Configurações.
 * Sem handlers inline (CSP): data-on-click / data-on-change com argumentos literais.
 */
const PRIORIDADE_ROT = { URGENTE: 'Urgente', ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa' };
const ESTADO_ROT = { ABERTA: 'Aberta', EM_CURSO: 'Em curso', RESOLVIDA: 'Resolvida', CANCELADA: 'Cancelada' };
const TIPO_ATIVO_ROT = { FISICA: 'Infraestrutura física', MOVEL: 'Infraestrutura móvel' };
const dataPt = d => (d ? d.split('-').reverse().join('/') : '—');
const optAtivos = (l, vazio) => (vazio ? `<option value="">${vazio}</option>` : '') + l.filter(a => a.ativo).map(a => `<option value="${esc(a.id)}">${esc(a.nome)} (${a.tipo === 'MOVEL' ? 'móvel' : 'física'})</option>`).join('');

// ── Avarias e danos ─────────────────────────────────────────
async function modulo_servicos(el) {
  try {
    const filtro = window._servFiltro || 'ABERTAS';
    const [lista, ativos] = await Promise.all([api('GET', `/servicos/ocorrencias?estado=${filtro}`), api('GET', '/servicos/ativos')]);
    window._servOc = Array.isArray(lista) ? lista : [];
    window._servAtivos = Array.isArray(ativos) ? ativos : [];
    el.innerHTML = `
      <div class="toolbar"><span class="secao-titulo">🛠️ Avarias e danos</span>
        <select class="input-pesquisa" data-on-change="servicosFiltrar(this.value)">
          <option value="ABERTAS" ${filtro === 'ABERTAS' ? 'selected' : ''}>Por resolver</option>
          <option value="RESOLVIDA" ${filtro === 'RESOLVIDA' ? 'selected' : ''}>Resolvidas</option>
          <option value="CANCELADA" ${filtro === 'CANCELADA' ? 'selected' : ''}>Canceladas</option>
        </select>
        <button class="btn-primario" data-on-click="modalNovaOcorrencia()">+ Reportar</button></div>
      ${window._servOc.length ? window._servOc.map((o, i) => `
        <div class="card mb-2" style="max-width:720px">
          <div class="toolbar" style="margin-bottom:.3rem"><b>${o.tipo === 'AVARIA' ? '🔧' : '💥'} ${esc(o.titulo)}</b>
            <span class="badge ${o.prioridade === 'URGENTE' || o.prioridade === 'ALTA' ? 'badge-erro' : 'badge-aviso'}">${PRIORIDADE_ROT[o.prioridade]}</span></div>
          <div class="muted texto-pequeno">${esc(o.ativo_nome || 'Sem item associado')} · ${ESTADO_ROT[o.estado]} · ${new Date(o.criado_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}${o.reportado_por_nome ? ' · ' + esc(o.reportado_por_nome) : ''}</div>
          ${o.descricao ? `<p style="margin:.4rem 0">${esc(o.descricao)}</p>` : ''}
          ${o.resolucao ? `<p class="texto-pequeno"><b>${o.estado === 'CANCELADA' ? 'Motivo' : 'Resolução'}:</b> ${esc(o.resolucao)}</p>` : ''}
          ${o.estado === 'ABERTA' || o.estado === 'EM_CURSO' ? `<div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap">
            ${o.estado === 'ABERTA' ? `<button class="btn-secundario" data-on-click="ocorrenciaEmCurso(${i})">Em curso</button>` : ''}
            <button class="btn-primario" data-on-click="modalFecharOcorrencia(${i}, 'RESOLVIDA')">Resolvida</button>
            <button class="btn-secundario" data-on-click="pedirCancelarOcorrencia(${i})">Cancelar</button></div>` : ''}
        </div>`).join('') : '<div class="card muted">Nada por aqui.</div>'}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function servicosFiltrar(v) { window._servFiltro = v; carregarModulo('servicos'); }
function modalNovaOcorrencia() {
  abrirModal('Reportar avaria ou dano', `
    <div class="campo"><label>O que aconteceu</label><select id="oc-tipo"><option value="AVARIA">Avaria (deixou de funcionar)</option><option value="DANO">Dano (partido, estragado)</option></select></div>
    <div class="campo"><label>Item afectado</label><select id="oc-ativo">${optAtivos(window._servAtivos || [], 'Sem item específico')}</select></div>
    <div class="campo"><label>Título</label><input id="oc-titulo" maxlength="160" placeholder="Ex.: Ar condicionado da sala parado"></div>
    <div class="campo"><label>Descrição</label><textarea id="oc-desc" rows="3" maxlength="2000" placeholder="Opcional"></textarea></div>
    <div class="campo"><label>Prioridade</label><select id="oc-prio"><option value="MEDIA">Média</option><option value="BAIXA">Baixa</option><option value="ALTA">Alta</option><option value="URGENTE">Urgente</option></select></div>
    <button class="btn-primario btn-bloco" data-on-click="criarOcorrencia()">Reportar</button>`);
}
async function criarOcorrencia() {
  const corpo = { tipo: document.getElementById('oc-tipo').value, titulo: document.getElementById('oc-titulo').value.trim(), descricao: document.getElementById('oc-desc').value.trim() || undefined,
    prioridade: document.getElementById('oc-prio').value, ativo_id: document.getElementById('oc-ativo').value || undefined };
  if (!corpo.titulo) { toast('Escreva um título', 'erro'); return; }
  try { await api('POST', '/servicos/ocorrencias', corpo); fecharModal(); toast('Reportado', 'sucesso'); carregarModulo('servicos'); }
  catch (e) { toast(e.message, 'erro'); }
}
async function ocorrenciaEmCurso(i) {
  const o = (window._servOc || [])[i]; if (!o) return;
  try { await api('PATCH', `/servicos/ocorrencias/${o.id}`, { estado: 'EM_CURSO' }); carregarModulo('servicos'); } catch (e) { toast(e.message, 'erro'); }
}
function modalFecharOcorrencia(i, estado) {
  window._servFecho = { i, estado };
  abrirModal(estado === 'RESOLVIDA' ? 'Dar como resolvida' : 'Cancelar ocorrência', `
    <div class="campo"><label>${estado === 'RESOLVIDA' ? 'O que foi feito para resolver' : 'Motivo do cancelamento'}</label><textarea id="oc-res" rows="3" maxlength="2000"></textarea></div>
    <button class="btn-primario btn-bloco" data-on-click="fecharOcorrencia()">Confirmar</button>`);
}
function pedirCancelarOcorrencia(i) {
  modalConfirmar('Cancelar ocorrência', 'Tem a certeza que quer <b>cancelar esta ocorrência</b>? Depois de cancelada já não se altera.', 'modalFecharOcorrencia', i, 'CANCELADA');
}
async function fecharOcorrencia() {
  const { i, estado } = window._servFecho || {};
  const o = (window._servOc || [])[i]; if (!o) return;
  const resolucao = document.getElementById('oc-res').value.trim();
  if (!resolucao) { toast('Escreva o texto pedido', 'erro'); return; }
  try { await api('PATCH', `/servicos/ocorrencias/${o.id}`, { estado, resolucao }); fecharModal(); toast('Actualizado', 'sucesso'); carregarModulo('servicos'); }
  catch (e) { toast(e.message, 'erro'); }
}

// ── Prazos de manutenção ────────────────────────────────────
async function modulo_manutencao(el) {
  try {
    const lista = await api('GET', '/servicos/manutencoes');
    window._manut = Array.isArray(lista) ? lista : [];
    const estado = d => d < 0 ? ['badge-erro', `Atrasada ${-d} dia${d === -1 ? '' : 's'}`] : d === 0 ? ['badge-aviso', 'Hoje'] : d <= 7 ? ['badge-aviso', `Em ${d} dia${d === 1 ? '' : 's'}`] : ['badge-sucesso', `Em ${d} dias`];
    el.innerHTML = `<div class="toolbar"><span class="secao-titulo">🗓️ Prazos de manutenção</span><span class="muted">Os planos criam-se em Configurações</span></div>
      ${window._manut.length ? window._manut.map((m, i) => { const [cls, txt] = estado(m.dias_restantes); return `
        <div class="card mb-2" style="max-width:720px">
          <div class="toolbar" style="margin-bottom:.3rem"><b>${esc(m.descricao)}</b><span class="badge ${cls}">${txt}</span></div>
          <div class="muted texto-pequeno">${esc(m.ativo_nome)} (${m.ativo_tipo === 'MOVEL' ? 'móvel' : 'física'}) · a cada ${m.periodicidade_dias} dias · próxima ${dataPt(m.proxima_em)} · última ${dataPt(m.ultima_em)}</div>
          <div style="display:flex;gap:.5rem;margin-top:.5rem"><button class="btn-primario" data-on-click="modalManutencaoFeita(${i})">Registar como feita</button>
            <button class="btn-secundario" data-on-click="historicoManutencao(${i})">Histórico</button></div>
        </div>`; }).join('') : '<div class="card muted">Ainda não há planos de manutenção. Crie-os em Configurações.</div>'}`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function modalManutencaoFeita(i) {
  window._manutSel = i;
  abrirModal('Registar manutenção feita', `
    <p style="margin-bottom:.6rem">${esc(((window._manut || [])[i] || {}).descricao || '')}</p>
    <div class="campo"><label>Data (deixe em branco para hoje)</label><input id="mf-data" type="date"></div>
    <div class="campo"><label>Observações</label><textarea id="mf-obs" rows="2" maxlength="1000" placeholder="Opcional"></textarea></div>
    <button class="btn-primario btn-bloco" data-on-click="manutencaoFeita()">Registar</button>`);
}
async function manutencaoFeita() {
  const m = (window._manut || [])[window._manutSel]; if (!m) return;
  const corpo = { data: document.getElementById('mf-data').value || undefined, observacoes: document.getElementById('mf-obs').value.trim() || undefined };
  try { const r = await api('POST', `/servicos/manutencoes/${m.id}/realizada`, corpo); fecharModal(); toast(`Registado. Próxima: ${dataPt(r.proxima_em)}`, 'sucesso', 6000); carregarModulo('manutencao'); }
  catch (e) { toast(e.message, 'erro'); }
}
async function historicoManutencao(i) {
  const m = (window._manut || [])[i]; if (!m) return;
  try {
    const h = await api('GET', `/servicos/manutencoes/${m.id}/historico`);
    abrirModal('Histórico · ' + m.descricao, (Array.isArray(h) && h.length ? h.map(x => `<div style="padding:.35rem 0"><b>${dataPt(x.realizada_em)}</b> <span class="muted">${esc(x.realizada_por || '')}</span>${x.observacoes ? `<div class="texto-pequeno">${esc(x.observacoes)}</div>` : ''}</div>`).join('') : '<span class="muted">Ainda não foi registada nenhuma manutenção.</span>'));
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Configurações: itens e planos ───────────────────────────
function htmlConfigServicos(ativos, planos) {
  window._cfgServAtivos = ativos; window._cfgServPlanos = planos;
  return `<div class="card mt-2" style="max-width:640px">
    <div class="toolbar" style="margin-bottom:.4rem"><div class="card-titulo">SERVIÇOS · ITENS E MANUTENÇÕES</div>
      <button class="btn-primario" data-on-click="modalNovoAtivo()">+ Item</button>
      <button class="btn-secundario" data-on-click="modalNovoPlano()">+ Plano de manutenção</button></div>
    <p class="muted texto-pequeno" style="margin-bottom:.6rem">Os itens são a infraestrutura física (salas, instalações) e móvel (viaturas, equipamentos) que pode avariar ou precisar de manutenção.</p>
    ${ativos.length ? ativos.map((a, i) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.3rem 0;${a.ativo ? '' : 'opacity:.5'}">
      <div><b>${esc(a.nome)}</b> <span class="muted texto-pequeno">${TIPO_ATIVO_ROT[a.tipo]}${a.localizacao ? ' · ' + esc(a.localizacao) : ''}${a.ativo ? '' : ' · desactivado'}</span></div>
      ${a.ativo ? `<button class="btn-secundario" data-on-click="pedirDesativarAtivo(${i})">Desactivar</button>` : `<button class="btn-secundario" data-on-click="reativarAtivo(${i})">Reactivar</button>`}</div>`).join('') : '<div class="muted">Ainda não há itens.</div>'}
    ${planos.length ? `<div class="card-titulo" style="margin:.8rem 0 .3rem">PLANOS ACTIVOS</div>` + planos.map((p, i) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.3rem 0">
      <div><b>${esc(p.descricao)}</b> <span class="muted texto-pequeno">${esc(p.ativo_nome)} · a cada ${p.periodicidade_dias} dias</span></div>
      <button class="btn-secundario" data-on-click="pedirDesativarPlano(${i})">Desactivar</button></div>`).join('') : ''}
  </div>`;
}
function modalNovoAtivo() {
  abrirModal('Novo item', `
    <div class="campo"><label>Nome</label><input id="at-nome" maxlength="120" placeholder="Ex.: Sala principal, Carrinha de entregas"></div>
    <div class="campo"><label>Tipo</label><select id="at-tipo"><option value="FISICA">Infraestrutura física</option><option value="MOVEL">Infraestrutura móvel</option></select></div>
    <div class="campo"><label>Localização</label><input id="at-loc" maxlength="120" placeholder="Opcional"></div>
    <button class="btn-primario btn-bloco" data-on-click="criarAtivo()">Guardar</button>`);
}
async function criarAtivo() {
  const nome = document.getElementById('at-nome').value.trim();
  if (!nome) { toast('Escreva o nome do item', 'erro'); return; }
  try { await api('POST', '/servicos/ativos', { nome, tipo: document.getElementById('at-tipo').value, localizacao: document.getElementById('at-loc').value.trim() || undefined }); fecharModal(); toast('Item guardado', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
function pedirDesativarAtivo(i) {
  const a = (window._cfgServAtivos || [])[i]; if (!a) return;
  modalConfirmar('Desactivar item', `Tem a certeza que quer <b>desactivar «${esc(a.nome)}»</b>? Deixa de poder ser escolhido, mas o histórico fica guardado.`, 'desativarAtivo', i);
}
async function desativarAtivo(i) {
  const a = (window._cfgServAtivos || [])[i]; if (!a) return;
  try { await api('PATCH', `/servicos/ativos/${a.id}`, { ativo: false }); fecharModal(); carregarModulo('configuracoes'); } catch (e) { fecharModal(); toast(e.message, 'erro'); }
}
async function reativarAtivo(i) {
  const a = (window._cfgServAtivos || [])[i]; if (!a) return;
  try { await api('PATCH', `/servicos/ativos/${a.id}`, { ativo: true }); carregarModulo('configuracoes'); } catch (e) { toast(e.message, 'erro'); }
}
function modalNovoPlano() {
  abrirModal('Novo plano de manutenção', `
    <div class="campo"><label>Item</label><select id="pl-ativo">${optAtivos(window._cfgServAtivos || [])}</select></div>
    <div class="campo"><label>O que fazer</label><input id="pl-desc" maxlength="200" placeholder="Ex.: Revisão do ar condicionado"></div>
    <div class="campo"><label>Repetir a cada (dias)</label><input id="pl-dias" type="number" min="1" max="3650" value="30"></div>
    <div class="campo"><label>Primeira data (deixe em branco para daqui a um período)</label><input id="pl-data" type="date"></div>
    <button class="btn-primario btn-bloco" data-on-click="criarPlano()">Guardar</button>`);
}
async function criarPlano() {
  const corpo = { ativo_id: document.getElementById('pl-ativo').value, descricao: document.getElementById('pl-desc').value.trim(), periodicidade_dias: parseInt(document.getElementById('pl-dias').value, 10), primeira_em: document.getElementById('pl-data').value || undefined };
  if (!corpo.ativo_id) { toast('Crie primeiro um item', 'erro'); return; }
  if (!corpo.descricao) { toast('Escreva o que fazer', 'erro'); return; }
  try { await api('POST', '/servicos/manutencoes', corpo); fecharModal(); toast('Plano guardado', 'sucesso'); carregarModulo('configuracoes'); }
  catch (e) { toast(e.message, 'erro'); }
}
function pedirDesativarPlano(i) {
  const p = (window._cfgServPlanos || [])[i]; if (!p) return;
  modalConfirmar('Desactivar plano', `Tem a certeza que quer <b>desactivar «${esc(p.descricao)}»</b>? Deixa de aparecer nos prazos.`, 'desativarPlano', i);
}
async function desativarPlano(i) {
  const p = (window._cfgServPlanos || [])[i]; if (!p) return;
  try { await api('PATCH', `/servicos/manutencoes/${p.id}`, { ativo: false }); fecharModal(); carregarModulo('configuracoes'); } catch (e) { fecharModal(); toast(e.message, 'erro'); }
}
