'use strict';
/**
 * Assiduidade: botão de entrada/saída na barra de topo (cada funcionário para si) e o ecrã
 * Administração → RH → Assiduidade (ADMIN/GERENTE) com horas por funcionário e correcção de saídas esquecidas.
 */
const horaPonto = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function pontoDisponivel() {
  const u = NUK.utilizador || {};
  return !Array.isArray(u.modulos) || u.modulos.includes('rh'); // sem estabelecimento, o GET responde 400 e o botão fica escondido
}
async function actualizarPonto() {
  const b = document.getElementById('btn-ponto');
  if (!b || !pontoDisponivel()) return;
  try {
    const e = await api('GET', '/ponto');
    window._ponto = e;
    b.style.display = '';
    b.textContent = e.em_servico ? `🟢 Em serviço desde ${horaPonto(e.registo.entrada_em).slice(-5)} · Saída` : '🕒 Registar entrada';
  } catch { b.style.display = 'none'; }
}
async function clicarPonto() {
  if (window._ponto && window._ponto.em_servico) {
    modalConfirmar('Registar saída', 'Vai registar a <b>saída</b> do seu turno agora.', 'registarSaidaPonto');
    return;
  }
  try {
    await api('POST', '/ponto/entrada');
    toast('Entrada registada. Bom trabalho!', 'sucesso');
    actualizarPonto();
  } catch (e) { toast(e.message, 'erro'); }
}
async function registarSaidaPonto() {
  fecharModal();
  try {
    const r = await api('POST', '/ponto/saida');
    toast(`Saída registada · ${String(r.horas).replace('.', ',')} h de turno`, 'sucesso', 6000);
    actualizarPonto();
  } catch (e) { toast(e.message, 'erro'); }
}

async function modulo_assiduidade(el) {
  if (!['ADMIN', 'GERENTE'].includes(NUK.utilizador && NUK.utilizador.nivel_acesso)) {
    el.innerHTML = '<div class="erro-msg">Só para administradores e gerentes</div>';
    return;
  }
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
  const f = window._assFiltro || { de: hoje.slice(0, 8) + '01', ate: hoje };
  try {
    const r = await api('GET', `/ponto/relatorio?de=${f.de}&ate=${f.ate}`);
    window._assRegistos = r.registos;
    el.innerHTML = `
      <div class="toolbar" style="flex-wrap:wrap;gap:.5rem"><span class="secao-titulo">🕒 Assiduidade</span>
        <span style="display:flex;gap:.4rem;align-items:center"><input type="date" id="ass-de" value="${esc(f.de)}"> a <input type="date" id="ass-ate" value="${esc(f.ate)}">
        <button class="btn-primario" style="padding:.3rem .75rem" data-on-click="filtrarAssiduidade()">Ver</button></span></div>
      <div class="muted texto-pequeno" style="margin-bottom:.6rem">Cada funcionário regista a entrada e a saída no botão 🕒 da barra de topo.</div>
      <div class="card mb-2"><div class="card-header"><span class="card-titulo">Horas por funcionário</span></div>
        ${r.por_funcionario.length ? `<div class="tabela-wrapper"><table><thead><tr><th>Funcionário</th><th>Dias</th><th>Horas</th><th>Em aberto</th></tr></thead>
          <tbody>${r.por_funcionario.map(x => `<tr><td><b>${esc(x.nome)}</b><div class="muted texto-pequeno">${esc(x.cargo || '')}</div></td><td>${x.dias}</td><td class="negrito">${String(x.horas).replace('.', ',')} h</td><td>${x.em_aberto || ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">Sem registos no período</div>'}</div>
      <div class="card"><div class="card-header"><span class="card-titulo">Registos</span></div>
        ${r.registos.length ? `<div class="tabela-wrapper"><table><thead><tr><th>Funcionário</th><th>Entrada</th><th>Saída</th><th>Horas</th><th></th></tr></thead>
          <tbody>${r.registos.map(x => `<tr><td>${esc(x.nome)}</td><td>${horaPonto(x.entrada_em)}</td>
            <td>${x.saida_em ? horaPonto(x.saida_em) + (x.corrigido_por ? `<div class="muted texto-pequeno">corrigida por ${esc(x.corrigido_por)}: ${esc(x.observacoes || '')}</div>` : '') : `<span class="${x.esquecido ? '' : 'muted'}" style="${x.esquecido ? 'color:var(--c-danger)' : ''}">${x.esquecido ? 'Saída esquecida' : 'Em serviço'}</span>`}</td>
            <td>${x.horas !== null ? String(x.horas).replace('.', ',') + ' h' : '—'}</td>
            <td>${x.saida_em ? '' : `<button class="btn-secundario" style="padding:.25rem .6rem;font-size:.75rem" data-on-click="modalCorrigirSaida('${esc(x.id)}')">Corrigir saída</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">Sem registos</div>'}</div>`;
  } catch (e) { el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`; }
}
function filtrarAssiduidade() {
  const de = document.getElementById('ass-de').value, ate = document.getElementById('ass-ate').value;
  if (!de || !ate || de > ate) { toast('Período inválido', 'erro'); return; }
  window._assFiltro = { de, ate };
  carregarModulo('assiduidade');
}
function modalCorrigirSaida(id) {
  const x = (window._assRegistos || []).find(r => r.id === id); if (!x) return;
  abrirModal(`Corrigir saída · ${x.nome}`, `
    <p style="margin-bottom:.6rem">Entrada: <b>${horaPonto(x.entrada_em)}</b></p>
    <div class="campo"><label>Hora real de saída</label><input type="datetime-local" id="cs-saida"></div>
    <div class="campo"><label>Observação (obrigatória)</label><input id="cs-obs" maxlength="200" placeholder="Ex.: esqueceu-se de registar a saída"></div>
    <button class="btn-primario btn-bloco" data-on-click="corrigirSaidaPonto('${esc(x.id)}')">Guardar</button>`);
}
async function corrigirSaidaPonto(id) {
  const v = document.getElementById('cs-saida').value, obs = document.getElementById('cs-obs').value.trim();
  if (!v) { toast('Indique a hora de saída', 'erro'); return; }
  if (obs.length < 3) { toast('Indique a observação', 'erro'); return; }
  // datetime-local é hora de Luanda (UTC+1, sem horário de verão)
  const iso = new Date(v + ':00+01:00').toISOString();
  try { await api('PATCH', `/ponto/${id}/saida`, { saida_em: iso, observacoes: obs }); fecharModal(); toast('Saída corrigida', 'sucesso'); carregarModulo('assiduidade'); }
  catch (e) { toast(e.message, 'erro'); }
}
