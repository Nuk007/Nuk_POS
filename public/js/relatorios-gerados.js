'use strict';
/**
 * Relatórios gerados automaticamente (21/11/2026): secção «🗂️ Relatórios gerados» no módulo Relatórios — lista dos
 * relatórios que o sistema gerou sozinho (e os pedidos à mão), «Ver» numa janela, «PDF» e «Gerar agora».
 * Também o cartão «⏱️ Geração automática» da Configuração de relatórios (só ADMIN).
 * Sem handlers inline (CSP): data-on-click / data-on-change com argumentos literais.
 */
const FREQ_REL = { DIA: 'Diário', SEMANA: 'Semanal', MES: 'Mensal', MANUAL: 'Pedido' };
let _relCatalogo = null;
let _relGeradosFiltro = '';

const fmtRel = (v, f) => {
  if (v === null || v === undefined || v === '') return '—';
  if (f === 'kz') return formatarMoeda(v);
  if (f === 'pct') return `${String(v).replace('.', ',')} %`;
  if (f === 'num') return Number(v).toLocaleString('pt-PT');
  return esc(v);
};
const periodoRel = (de, ate) => (de === ate ? de.split('-').reverse().join('/') : `${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`);

async function carregarRelatoriosGerados() {
  const box = document.getElementById('rel-gerados');
  if (!box) return;
  try {
    if (!_relCatalogo) _relCatalogo = await api('GET', '/relatorios/catalogo');
    const tipo = _relGeradosFiltro ? `&tipo=${encodeURIComponent(_relGeradosFiltro)}` : '';
    const r = await api('GET', `/relatorios/gerados?limit=30${tipo}`);
    const hoje = diaLuanda();
    box.innerHTML = `
      <div class="card mb-3">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">
          <div class="card-titulo" style="margin:0">🗂️ RELATÓRIOS GERADOS</div>
          <select id="relg-filtro" data-on-change="filtrarRelatoriosGerados()" style="max-width:15rem">
            <option value="">Todos os relatórios</option>
            ${_relCatalogo.map(c => `<option value="${esc(c.tipo)}"${c.tipo === _relGeradosFiltro ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}
          </select>
        </div>
        <div class="muted texto-pequeno" style="margin-bottom:.5rem">O sistema gera-os sozinho todos os dias (diários de ontem), às segundas (semana anterior) e no dia 1 (mês anterior), à hora escolhida em Configurações → Configuração de relatórios.</div>
        ${r.data.length ? `<div class="tabela-wrapper"><table class="texto-pequeno"><thead><tr><th>Relatório</th><th>Período</th><th>Tipo</th><th>Gerado</th><th></th></tr></thead><tbody>
          ${r.data.map(x => `<tr>
            <td><b>${esc(x.nome)}</b>${x.alertas ? ` <span title="Alertas" style="color:var(--c-warning,#f0a500)">⚠ ${x.alertas}</span>` : ''}</td>
            <td>${periodoRel(x.de, x.ate)}</td>
            <td>${esc(FREQ_REL[x.frequencia] || x.frequencia)}${x.origem === 'MANUAL' && x.gerado_por_nome ? ` · ${esc(x.gerado_por_nome)}` : ''}</td>
            <td>${dataHoraRel(x.gerado_em)}</td>
            <td style="white-space:nowrap"><button class="btn-secundario" style="padding:.2rem .55rem;font-size:.75rem" data-on-click="verRelatorioGerado('${esc(x.id)}')">Ver</button>
              <button class="btn-secundario" style="padding:.2rem .55rem;font-size:.75rem" data-on-click="descarregarPdf('/relatorios/gerados/${esc(x.id)}/pdf', '${esc(x.tipo.toLowerCase())}-${esc(x.de)}.pdf')">PDF</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="muted" style="margin-bottom:.5rem">Ainda não há relatórios gerados. O primeiro sai amanhã à hora configurada, ou gere um agora.</div>'}
        <div style="display:flex;gap:.4rem;align-items:flex-end;flex-wrap:wrap;margin-top:.7rem">
          <div class="campo" style="margin:0"><label>Gerar agora</label><select id="relg-tipo">${_relCatalogo.map(c => `<option value="${esc(c.tipo)}">${esc(c.nome)}</option>`).join('')}</select></div>
          <div class="campo" style="margin:0"><label>De</label><input id="relg-de" type="date" max="${hoje}" value="${hoje}"></div>
          <div class="campo" style="margin:0"><label>Até</label><input id="relg-ate" type="date" max="${hoje}" value="${hoje}"></div>
          <button class="btn-primario" data-on-click="gerarRelatorioAgora()">Gerar</button>
        </div>
      </div>`;
  } catch (e) { box.innerHTML = `<div class="erro-msg">Relatórios gerados: ${esc(e.message)}</div>`; }
}

function filtrarRelatoriosGerados() {
  const s = document.getElementById('relg-filtro');
  _relGeradosFiltro = s ? s.value : '';
  carregarRelatoriosGerados();
}

async function gerarRelatorioAgora() {
  const tipo = document.getElementById('relg-tipo').value;
  const de = document.getElementById('relg-de').value, ate = document.getElementById('relg-ate').value || de;
  try {
    const r = await api('POST', '/relatorios/gerar', { tipo, de, ate: tipo === 'FOLHA_CAIXA' ? de : ate });
    toast('Relatório gerado', 'sucesso');
    await carregarRelatoriosGerados();
    if (r && r.id) verRelatorioGerado(r.id);
  } catch (e) { toast(e.message, 'erro'); }
}

async function verRelatorioGerado(id) {
  try {
    const r = await api('GET', `/relatorios/gerados/${encodeURIComponent(id)}`);
    abrirModal(`${esc(r.dados.titulo)} — ${periodoRel(r.de, r.ate)}`, htmlRelatorioGerado(r));
  } catch (e) { toast(e.message, 'erro'); }
}

function htmlRelatorioGerado(r) {
  const d = r.dados;
  const resumo = (d.resumo || []).map(k => `<div class="kpi-card"><div class="kpi-label">${esc(k.rotulo)}</div><div class="kpi-valor" style="font-size:1.05rem">${fmtRel(k.valor, k.formato)}</div></div>`).join('');
  const alertas = (d.alertas || []).map(a => `<div class="texto-pequeno">⚠ ${esc(a)}</div>`).join('');
  const seccoes = (d.seccoes || []).map(s => `
    <div class="card-titulo mt-2">${esc(s.titulo)}</div>
    ${s.linhas && s.linhas.length ? `<div class="tabela-wrapper"><table class="texto-pequeno"><thead><tr>${s.colunas.map(c => `<th style="text-align:${c.alinhar === 'dir' ? 'right' : 'left'}">${esc(c.rotulo)}</th>`).join('')}</tr></thead><tbody>
      ${s.linhas.map(l => `<tr>${s.colunas.map(c => `<td style="text-align:${c.alinhar === 'dir' ? 'right' : 'left'}">${fmtRel(l[c.chave], c.formato)}</td>`).join('')}</tr>`).join('')}
      ${s.total ? `<tr style="font-weight:700">${s.colunas.map(c => `<td style="text-align:${c.alinhar === 'dir' ? 'right' : 'left'}">${s.total[c.chave] === undefined ? '' : fmtRel(s.total[c.chave], c.formato)}</td>`).join('')}</tr>` : ''}
    </tbody></table></div>` : '<div class="muted texto-pequeno">Sem registos no período.</div>'}`).join('');
  return `<div class="kpi-grid mb-2">${resumo}</div>
    ${alertas ? `<div class="card" style="border-left:3px solid var(--c-warning,#f0a500);padding:.5rem .7rem;margin-bottom:.5rem">${alertas}</div>` : ''}
    ${seccoes}
    <div class="row-acoes mt-2"><button class="btn-primario" data-on-click="descarregarPdf('/relatorios/gerados/${esc(r.id)}/pdf', '${esc(r.tipo.toLowerCase())}-${esc(r.de)}.pdf')">Descarregar PDF</button></div>`;
}

// ── Configurações → Configuração de relatórios → Geração automática (só ADMIN) ──
async function carregarConfigRelatoriosAuto() {
  const box = document.getElementById('cfg-relatorios-auto');
  if (!box) return;
  try {
    const [cfg, cat] = await Promise.all([api('GET', '/relatorios/auto/config'), api('GET', '/relatorios/catalogo')]);
    const lic = c => !c.licenca || typeof licenciadoModulo !== 'function' || licenciadoModulo(c.licenca);
    const coluna = (f, titulo, quando) => `
      <div><div style="font-weight:600;margin-bottom:.25rem">${titulo}</div><div class="muted texto-pequeno" style="margin-bottom:.35rem">${quando}</div>
        ${cat.filter(c => c.frequencias.includes(f) && lic(c)).map(c => `<label class="texto-pequeno" style="display:flex;gap:.4rem;align-items:center;margin-bottom:.2rem"><input type="checkbox" class="rauto-${f}" value="${esc(c.tipo)}" style="width:auto;margin:0"${cfg[f].includes(c.tipo) ? ' checked' : ''}> ${esc(c.nome)}</label>`).join('')}
      </div>`;
    box.innerHTML = `
      <b>⏱️ Geração automática</b>
      <div class="muted texto-pequeno" style="margin:.3rem 0 .6rem">O sistema gera sozinho os relatórios escolhidos e guarda-os em Relatórios → «Relatórios gerados». Períodos sem movimento não geram relatório.</div>
      <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-bottom:.6rem">
        <label class="texto-pequeno" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="rauto-ativo" style="width:auto;margin:0"${cfg.ativo ? ' checked' : ''}> Ligada</label>
        <label class="texto-pequeno">A partir das <input id="rauto-hora" type="time" value="${esc(cfg.hora)}" style="width:7rem;display:inline-block"></label>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.6rem 1rem;margin-bottom:.6rem">
        ${coluna('DIA', 'Diários', 'O dia anterior')}${coluna('SEMANA', 'Semanais', 'À segunda: semana anterior')}${coluna('MES', 'Mensais', 'No dia 1: mês anterior')}
      </div>
      <div class="row-acoes">
        <button class="btn-primario" data-on-click="guardarConfigRelatoriosAuto()">Guardar a geração automática</button>
        ${cfg.configurado ? '<button class="btn-secundario" data-on-click="pedirReporRelatoriosAuto()">Repor o padrão</button>' : ''}
      </div>`;
  } catch (e) { box.innerHTML = `<div class="erro-msg">Geração automática: ${esc(e.message)}</div>`; }
}

async function guardarConfigRelatoriosAuto() {
  const marcados = f => [...document.querySelectorAll('.rauto-' + f)].filter(c => c.checked).map(c => c.value);
  try {
    await api('PUT', '/relatorios/auto/config', { ativo: document.getElementById('rauto-ativo').checked, hora: document.getElementById('rauto-hora').value, DIA: marcados('DIA'), SEMANA: marcados('SEMANA'), MES: marcados('MES') });
    toast('Geração automática guardada', 'sucesso');
    carregarConfigRelatoriosAuto();
  } catch (e) { toast(e.message, 'erro'); }
}

function pedirReporRelatoriosAuto() {
  modalConfirmar('Repor o padrão', 'A escolha do estabelecimento é apagada e a geração automática volta ao padrão do sistema (ligada às 06:00). Continuar?', 'reporRelatoriosAutoConfirmado');
}
async function reporRelatoriosAutoConfirmado() {
  fecharModal();
  try { await api('PUT', '/relatorios/auto/config', { repor: true }); toast('Geração automática reposta', 'sucesso'); carregarConfigRelatoriosAuto(); }
  catch (e) { toast(e.message, 'erro'); }
}
