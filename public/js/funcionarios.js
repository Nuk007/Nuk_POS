'use strict';
// Nuk_POS — Funcionários e acessos delegados.
// Scripts clássicos: as funções são globais e chamam-se umas às outras entre ficheiros (data-on-click).

// ════════════════════════════════════════════════════════════
// FUNCIONÁRIOS
// ════════════════════════════════════════════════════════════
async function modulo_funcionarios(el) {
  if (!['ADMIN','GERENTE'].includes(NUK.utilizador.nivel_acesso)) {
    el.innerHTML = '<div class="erro-msg">Acesso restrito</div>';
    return;
  }
  try {
    const lista = await api('GET', '/funcionarios') || [];
    window._funcionarios = lista;
    window._acessosMeta = await api('GET', '/funcionarios/acessos').catch(() => null);

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">👨‍💼 Funcionários</span>
        <button class="btn-primario" data-on-click="modalNovoFuncionario()">+ Novo Funcionário</button>
      </div>
      <div class="card tabela-wrapper">
        <table>
          <thead><tr><th>Nome</th><th>Cargo</th><th>Nível</th><th>Avaliação</th><th>Estado</th><th>Último Acesso</th><th>Acções</th></tr></thead>
          <tbody>
            ${lista.map(f => `
              <tr>
                <td><b>${f.nome}</b>${f.titular ? ' <span class="status-badge status-CONFIRMADA" title="Conta titular do estabelecimento">Titular</span>' : ''}<div class="muted texto-pequeno">${f.email}</div>${f.pode_vender_quartos ? '<span class="muted texto-pequeno">🛏 vende quartos </span>' : ''}${f.arruma_quartos ? '<span class="muted texto-pequeno">🧹 arruma quartos</span>' : ''}</td>
                <td>${f.cargo || '—'}</td>
                <td><span class="status-badge ${f.nivel_acesso === 'ADMIN' ? 'status-CONFIRMADA' : f.nivel_acesso === 'GERENTE' ? 'status-EM_PREPARO' : 'status-LIVRE'}">${f.nivel_acesso}</span></td>
                <td>★ ${parseFloat(f.media_avaliacao||0).toFixed(1)} <span class="muted">(${f.total_avaliacoes})</span></td>
                <td>${f.ativo ? '<span class="status-badge status-LIVRE">Activo</span>' : '<span class="status-badge status-FECHADO">Inactivo</span>'}</td>
                <td class="muted">${f.ultimo_acesso ? formatarData(f.ultimo_acesso) : 'Nunca'}</td>
                <td><div class="row-acoes">
                  ${(f.nivel_acesso === 'ADMIN' && !NUK.utilizador.titular) ? '' : `<button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalEditarFuncionario('${f.id}')">Editar</button>`}
                  ${(f.nivel_acesso === 'ADMIN' && !NUK.utilizador.titular) ? '' : f.titular ? (NUK.utilizador.titular ? '<button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalTransferirTitularidade()">Transferir titularidade</button>' : '') : `<button class="btn-${f.ativo ? 'perigo' : 'sucesso'}" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="${f.ativo ? `pedirDesactivarFunc('${f.id}')` : `toggleActivarFunc('${f.id}',false)`}">${f.ativo ? 'Desactivar' : 'Activar'}</button>`}
                </div></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}


// ── Acessos delegados: o titular fixa o limite dos administradores; estes atribuem dentro desse limite ──
function htmlAcessos(prefixo, seleccionados, nivel, bloqueado) {
  const m = window._acessosMeta;
  if (!m) return '';
  const caixa = k => `<label><input type="checkbox" id="${prefixo}-ac-${k}" ${seleccionados.includes(k) ? 'checked' : ''} ${bloqueado || !m.meu_limite.includes(k) ? 'disabled' : ''}> ${esc(m.rotulos[k] || k)}</label>`;
  return `<div class="campo" id="${prefixo}-wrap"><label>${nivel === 'ADMIN' ? 'Acessos (limite do administrador)' : 'Acessos'}</label>
    <div class="acessos-grid" id="${prefixo}-acessos">${m.modulos.map(caixa).join('')}${nivel === 'ADMIN' ? m.capacidades.map(caixa).join('') : ''}</div>
    <div class="muted texto-pequeno" style="margin-top:.3rem">${bloqueado ? 'Este funcionário tem acessos acima do seu limite: só o titular os pode alterar.' : m.sou_titular ? 'Como titular, define o que cada administrador pode dar aos restantes funcionários.' : 'Só pode atribuir os acessos que o titular lhe delegou (os restantes estão desactivados).'}</div></div>`;
}
function lerAcessos(prefixo) {
  const m = window._acessosMeta;
  if (!m || !document.getElementById(`${prefixo}-acessos`)) return undefined;
  return [...m.modulos, ...m.capacidades].filter(k => { const c = document.getElementById(`${prefixo}-ac-${k}`); return c && c.checked && !c.disabled; });
}
// Ao mudar o nível, propõe os acessos predefinidos desse nível dentro do limite de quem atribui
function actualizarAcessosForm(prefixo) {
  const m = window._acessosMeta, nivel = document.getElementById(`${prefixo}-nivel`).value;
  if (!m) return;
  const alvo = document.getElementById(`${prefixo}-wrap`);
  if (alvo) alvo.outerHTML = htmlAcessos(prefixo, (m.padrao[nivel] || []).filter(k => m.meu_limite.includes(k)), nivel, false);
}

function modalNovoFuncionario() {
  abrirModal('Novo Funcionário', `
    <div class="campo"><label>Nome</label><input type="text" id="nf-nome"></div>
    <div class="campo"><label>Email</label><input type="email" id="nf-email"></div>
    <div class="campo"><label>Palavra-passe (6 a 8 dígitos)</label><input type="password" id="nf-senha" inputmode="numeric" minlength="6" maxlength="8" placeholder="6 a 8 dígitos" autocomplete="new-password"></div>
    <div class="campo"><label>Cargo</label><input type="text" id="nf-cargo" placeholder="Ex: Empregado de Mesa"></div>
    <div class="campo"><label>Nível de Acesso</label>
      <select id="nf-nivel" data-on-change="actualizarAcessosForm('nf')">
        <option value="OPERADOR">Operador</option>
        <option value="GERENTE">Gerente</option>
        ${window._acessosMeta && !window._acessosMeta.sou_titular ? '' : '<option value="ADMIN">Admin</option>'}
      </select>
    </div>
    ${htmlAcessos('nf', window._acessosMeta ? window._acessosMeta.padrao.OPERADOR.filter(k => window._acessosMeta.meu_limite.includes(k)) : [], 'OPERADOR', false)}
    <div class="campo"><label>Salário (Kz)</label><input type="number" id="nf-sal" value="200000" min="0"></div>
    <div class="campo"><label>Comissão sobre vendas (%)</label><input type="number" id="nf-com" value="0" min="0" max="100" step="0.5"></div>
    <div class="campo"><label><input type="checkbox" id="nf-vq"> Pode vender/reservar/abrir quartos</label></div>
    <div class="campo"><label><input type="checkbox" id="nf-aq"> Arruma quartos (recebe os avisos de limpeza)</label></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarNovoFuncionario()">Guardar</button>
  `);
}

async function guardarNovoFuncionario() {
  const nome = document.getElementById('nf-nome').value;
  const email = document.getElementById('nf-email').value;
  const password = document.getElementById('nf-senha').value;
  const cargo = document.getElementById('nf-cargo').value;
  const nivel_acesso = document.getElementById('nf-nivel').value;
  const salario = parseFloat(document.getElementById('nf-sal').value) || 0;
  if (!nome || !email || !/^\d{6,8}$/.test(password)) { toast('Preencha todos os campos (palavra-passe de 6 a 8 dígitos)', 'erro'); return; }
  try {
    await api('POST', '/funcionarios', { nome, email, password, cargo, nivel_acesso, salario, comissao_pct: parseFloat((document.getElementById('nf-com') || {}).value) || 0,
      pode_vender_quartos: document.getElementById('nf-vq').checked, arruma_quartos: document.getElementById('nf-aq').checked, permissoes: lerAcessos('nf') });
    toast('Funcionário criado!', 'sucesso');
    fecharModal();
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

function modalEditarFuncionario(id) {
  const f = (window._funcionarios || []).find(x => x.id === id);
  if (!f) return;
  const campoNivel = f.titular
    ? '<div class="campo"><label>Nível</label><input type="text" value="ADMIN (titular)" disabled><div class="muted texto-pequeno">O titular mantém-se Administrador. Para mudar, transfira a titularidade.</div></div><input type="hidden" id="ef-nivel" value="ADMIN">'
    : `<div class="campo"><label>Nível</label><select id="ef-nivel" ${window._acessosMeta && !window._acessosMeta.sou_titular ? 'disabled' : ''} data-on-change="actualizarAcessosForm('ef')">${['OPERADOR','GERENTE','ADMIN'].map(n => `<option value="${n}" ${n===f.nivel_acesso?'selected':''}>${n}</option>`).join('')}</select></div>`;
  abrirModal('Editar Funcionário', `
    <div class="campo"><label>Nome</label><input type="text" id="ef-nome" value="${esc(f.nome)}"></div>
    <div class="campo"><label>Cargo</label><input type="text" id="ef-cargo" value="${esc(f.cargo || '')}"></div>
    ${campoNivel}
    <div class="campo"><label>Salário (Kz)</label><input type="number" id="ef-sal" value="${esc(f.salario || 0)}" min="0"></div>
    <div class="campo"><label>Comissão sobre vendas (%)</label><input type="number" id="ef-com" value="${esc(Number(f.comissao_pct || 0))}" min="0" max="100" step="0.5"></div>
    <div class="campo"><label><input type="checkbox" id="ef-vq" ${f.pode_vender_quartos ? 'checked' : ''}> Pode vender/reservar/abrir quartos</label></div>
    <div class="campo"><label><input type="checkbox" id="ef-aq" ${f.arruma_quartos ? 'checked' : ''}> Arruma quartos (recebe os avisos de limpeza)</label></div>
    ${f.titular ? '' : htmlAcessos('ef', f.acessos || [], f.nivel_acesso, !!window._acessosMeta && !window._acessosMeta.sou_titular && (f.acessos || []).some(k => !window._acessosMeta.meu_limite.includes(k)))}
    <div class="campo"><label>Nova palavra-passe (6 a 8 dígitos; vazio para não alterar)</label><input type="password" id="ef-senha" inputmode="numeric" minlength="6" maxlength="8" placeholder="6 a 8 dígitos" autocomplete="new-password"></div>
    <button class="btn-primario btn-bloco" data-on-click="salvarEdicaoFuncionario('${id}')">Guardar</button>
  `);
}

function modalTransferirTitularidade() {
  const alvos = (window._funcionarios || []).filter(f => f.ativo && !f.titular);
  abrirModal('Transferir titularidade', `
    <p class="muted" style="margin-bottom:.75rem">A conta titular é a primeira conta do estabelecimento e não pode ser apagada: só passa para outra pessoa. O novo titular fica Administrador e você mantém a sua conta.</p>
    <div class="campo"><label>Novo titular</label>
      <select id="tt-novo">${alvos.length ? alvos.map(f => `<option value="${esc(f.id)}">${esc(f.nome)} — ${esc(f.email)}</option>`).join('') : '<option value="">Sem outros funcionários activos</option>'}</select>
    </div>
    <div class="campo"><label>A sua palavra-passe (confirmação)</label><input type="password" id="tt-senha" autocomplete="current-password"></div>
    <button class="btn-perigo btn-bloco" data-on-click="confirmarTransferirTitularidade()">Transferir titularidade</button>
  `);
}

async function confirmarTransferirTitularidade() {
  const novo = document.getElementById('tt-novo').value;
  const password = document.getElementById('tt-senha').value;
  if (!novo || !password) { toast('Escolha o novo titular e escreva a sua palavra-passe', 'erro'); return; }
  try {
    const r = await api('POST', '/funcionarios/transferir-titularidade', { novo_titular_id: novo, password });
    NUK.utilizador.titular = false;
    toast(`${r.nome} é agora o titular`, 'sucesso');
    fecharModal();
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

async function salvarEdicaoFuncionario(id) {
  const nome = document.getElementById('ef-nome').value;
  const cargo = document.getElementById('ef-cargo').value;
  const nivel_acesso = document.getElementById('ef-nivel').value;
  const salario = parseFloat(document.getElementById('ef-sal').value) || 0;
  const password = document.getElementById('ef-senha').value;
  const dados = { nome, cargo, nivel_acesso, salario, comissao_pct: parseFloat((document.getElementById('ef-com') || {}).value) || 0,
    pode_vender_quartos: document.getElementById('ef-vq').checked, arruma_quartos: document.getElementById('ef-aq').checked };
  if (password && !/^\d{6,8}$/.test(password)) { toast('A palavra-passe tem de ter entre 6 e 8 dígitos', 'erro'); return; }
  if (password) dados.password = password;
  const acessos = lerAcessos('ef');
  if (acessos) dados.permissoes = acessos;
  try {
    await api('PUT', `/funcionarios/${id}`, dados);
    toast('Funcionário actualizado!', 'sucesso');
    fecharModal();
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}

function pedirDesactivarFunc(id) {
  modalConfirmar('Desactivar funcionário', 'Tem a certeza que quer <b>desactivar este funcionário</b>? Deixa de poder entrar no sistema.', 'desactivarFuncConfirmado', id);
}
function desactivarFuncConfirmado(id) { fecharModal(); toggleActivarFunc(id, true); }

async function toggleActivarFunc(id, ativo) {
  try {
    await api('PUT', `/funcionarios/${id}`, { ativo: !ativo });
    toast(`Funcionário ${!ativo ? 'activado' : 'desactivado'}`, 'sucesso');
    carregarModulo('funcionarios');
  } catch (e) { toast(e.message, 'erro'); }
}
