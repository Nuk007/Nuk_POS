'use strict';
// Nuk_POS — Mesas e Quartos (operação e formulário de quarto das Configurações).
// Scripts clássicos: as funções são globais e chamam-se umas às outras entre ficheiros (data-on-click).

// ════════════════════════════════════════════════════════════
// MESAS
// ════════════════════════════════════════════════════════════
async function modulo_mesas(el) {
  try {
    const mesas = await api('GET', '/mesas') || [];
    window._mesasLista = mesas;
    const zonas = [...new Set(mesas.map(m => m.zona || 'Geral'))].sort();

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">🪑 Mesas</span>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${['LIVRE','OCUPADA','LIMPEZA'].map(s => `<span class="status-badge status-${s}">${s}</span>`).join('')}
        </div>
      </div>
      ${zonas.map(zona => {
        const mesasZona = mesas.filter(m => (m.zona || 'Geral') === zona);
        return `
          <div class="mb-2">
            <div class="secao-titulo" style="font-size:.8rem;color:var(--c-muted);margin-bottom:.5rem">${zona.toUpperCase()} (${mesasZona.length})</div>
            <div class="grid-cards">
              ${mesasZona.map(m => `
                <div class="mesa-card ${m.status}" data-on-click="abrirVendaMesa('${m.id}')">
                  <div class="card-numero">${m.numero}</div>
                  <div class="card-zona">${m.capacidade} lugares</div>
                  <div class="status-badge status-${m.status}" style="font-size:.7rem;margin-top:.3rem">${m.status}</div>
                  ${parseInt(m.pedidos_ativos) > 0 ? `<div class="card-pedidos" style="margin-top:.2rem">${m.pedidos_ativos} pedido(s)</div>` : ''}
                </div>`).join('')}
            </div>
          </div>`;
      }).join('')}
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${e.message}</div>`;
  }
}

function modalMesa(id, numero, statusActual) {
  const statuses = ['LIVRE','OCUPADA','RESERVADA','LIMPEZA','MANUTENCAO'];
  abrirModal(`Mesa ${numero}`, `
    <p class="muted mb-2">Estado actual: ${badgeStatus(statusActual)}</p>
    <div class="campo">
      <label>Alterar estado para</label>
      <select id="nova-status-mesa">
        ${statuses.map(s => `<option value="${s}" ${s === statusActual ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.5rem">
      <button class="btn-primario" style="flex:1" data-on-click="salvarStatusMesa('${id}')">Actualizar</button>
      <button class="btn-secundario" data-on-click="fecharModal()">Cancelar</button>
    </div>
    <hr style="border-color:var(--c-border);margin:1rem 0">
    <button class="btn-primario btn-bloco" data-on-click="novoPedidoNaMesa('${id}')">
      + Novo Pedido nesta mesa
    </button>
  `);
}

async function salvarStatusMesa(id) {
  const status = document.getElementById('nova-status-mesa').value;
  try {
    await api('PATCH', `/mesas/${id}/status`, { status });
    toast('Estado da mesa actualizado', 'sucesso');
    fecharModal();
    carregarModulo('mesas');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// QUARTOS
// ════════════════════════════════════════════════════════════
async function modulo_quartos(el) {
  window._quartosVoltar = null; // aberto pelo menu: as acções voltam aos Quartos
  try {
    const quartos = await api('GET', '/quartos') || [];
    window._quartos = quartos;
    const tipos = [...new Set(quartos.map(q => q.tipo))].sort();
    const u = NUK.utilizador || {};
    const chefia = ['ADMIN', 'GERENTE'].includes(u.nivel_acesso);
    const porArrumar = quartos.filter(q => q.status === 'LIMPEZA');
    const meus = porArrumar.filter(q => (q.limpeza && q.limpeza.escalado) ? chefia : (u.arruma_quartos || (!q.limpeza && chefia)));

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">🛏️ Quartos</span>
        <span class="quartos-legenda muted texto-pequeno"><span class="estrela amarela">★</span> reservado &nbsp; <span class="estrela vermelha">★</span> reserva em menos de 1 h (vendas bloqueadas)</span>
      </div>
      ${meus.length ? `<div class="quartos-aviso">🧹 ${meus.length === 1 ? 'Um quarto por arrumar' : meus.length + ' quartos por arrumar'}: ${meus.map(q => `<b>${esc(q.numero)}</b>`).join(', ')} — toque no quarto para o dar como limpo.</div>` : ''}
      ${quartos.length ? '' : '<div class="muted" style="padding:2rem;text-align:center">Ainda não há quartos. Um Administrador pode criá-los em <b>⚙️ Configurações → Quartos e preços</b>.</div>'}
      ${tipos.map(tipo => {
        const qs = quartos.filter(q => q.tipo === tipo);
        return `
          <div class="mb-2">
            <div class="secao-titulo" style="font-size:.8rem;color:var(--c-muted);margin-bottom:.5rem">${esc(tipo.replace(/_/g,' '))} (${qs.length})</div>
            <div class="grid-cards">${qs.map(htmlBotaoQuarto).join('')}</div>
          </div>`;
      }).join('')}
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`;
  }
}

// Hora local (HH:MM; com dd/mm quando não é hoje)
function horaQuarto(x) {
  const d = new Date(x), h = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? h : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${h}`;
}
const NOME_ESTADO_QUARTO = { DISPONIVEL: 'Disponível', OCUPADO: 'Ocupado', LIMPEZA: 'A arrumar', POR_PAGAR: 'Por pagar', MANUTENCAO: 'Em manutenção', BLOQUEADO: 'Bloqueado' };
function textoEstadoQuarto(q) {
  if (q.status === 'OCUPADO' && q.livre_as) return `Ocupado · livre às ${horaQuarto(q.livre_as)}`;
  if (q.status === 'LIMPEZA' && q.limpeza) return q.limpeza.escalado ? 'A arrumar · prazo excedido' : `A arrumar · até ${horaQuarto(q.livre_as)}`;
  return NOME_ESTADO_QUARTO[q.status] || q.status;
}
// Segunda linha do botão, por baixo do estado: a hora a que o quarto fica livre / o prazo de arrumação
function subtextoLivreQuarto(q) {
  if (q.status === 'OCUPADO') return q.livre_as ? `livre às ${horaQuarto(q.livre_as)}` : 'hora por definir';
  if (q.status === 'LIMPEZA' && q.limpeza) return q.limpeza.escalado ? 'prazo excedido' : `livre às ${horaQuarto(q.livre_as)}`;
  if (q.status === 'POR_PAGAR') return 'pagar no Caixa';
  return '';
}
function htmlBotaoQuarto(q) {
  const estrela = q.estrela ? `<div class="estrela ${q.estrela === 'VERMELHA' ? 'vermelha' : 'amarela'}" title="${q.estrela === 'VERMELHA' ? 'Reserva em menos de 1 hora: vendas bloqueadas' : 'Reservado para um período'}">★ reservado</div>` : '<div class="estrela vazia">&nbsp;</div>';
  return `
    <div class="quarto-card ${esc(q.status)} ${q.limpeza && q.limpeza.escalado ? 'escalado' : ''}" data-on-click="modalQuarto('${esc(q.id)}')">
      <div class="card-numero">${esc(q.numero)}</div>
      <div class="card-tipo">${esc(q.tipo.replace(/_/g, ' '))}</div>
      <div class="quarto-estado">${esc(NOME_ESTADO_QUARTO[q.status] || q.status)}</div>
      <div class="quarto-livre">${esc(subtextoLivreQuarto(q))}</div>
      ${estrela}
    </div>`;
}

/** Depois de uma acção num quarto: volta ao ecrã de onde se abriu (Quartos ou Balcão → «Vender quarto»). */
function recarregarQuartos() { carregarModulo(window._quartosVoltar || 'quartos'); }
const FRACOES_QUARTO = { DUAS_HORAS: ['Hora', '2 h', 'preco_2h'], PERNOITE: ['Noite', '12 h', 'preco_pernoite'], DIARIA: ['Diária', '24 h', 'preco_diaria'] };
const quartoPorId = id => (window._quartos || []).find(q => q.id === id);

// Clique no botão do quarto: estado, serviço (Hora/Noite/Diária) e as acções Vender / Reservar / Abrir Quarto
function modalQuarto(id) {
  const q = quartoPorId(id);
  if (!q) return;
  const u = NUK.utilizador || {};
  const chefia = ['ADMIN', 'GERENTE'].includes(u.nivel_acesso);
  window._quartoSel = { id, fracao: null };
  const vende = !!u.pode_vender_quartos;
  const bloqueio = q.venda_bloqueada || (q.status !== 'DISPONIVEL' ? NOME_ESTADO_QUARTO[q.status] : null);
  const podeVender = vende && q.status === 'DISPONIVEL' && !q.venda_bloqueada;
  const podeReservar = vende && !['MANUTENCAO', 'BLOQUEADO'].includes(q.status);
  const podeAbrir = vende && q.status === 'OCUPADO';

  const escalado = q.limpeza && q.limpeza.escalado;
  const podeLimpar = q.status === 'LIMPEZA' && (q.limpeza ? (escalado ? chefia : !!u.arruma_quartos) : (chefia || !!u.arruma_quartos));
  const reservas = (q.reservas_futuras || []).map(r => {
    const perto = new Date(r.checkin) - Date.now() <= 3600e3;
    return `<div class="quarto-reserva">
      <div><b>${horaQuarto(r.checkin)}</b> → ${horaQuarto(r.checkout)} · ${esc(FRACOES_QUARTO[r.fracao][0])}${r.nome_hospede ? ' · ' + esc(r.nome_hospede) : ''}</div>
      ${vende ? `<div class="row-acoes">
        ${perto && q.status === 'DISPONIVEL' ? `<button class="btn-primario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="entradaReservaQuarto('${esc(r.id)}')">Dar entrada</button>` : ''}
        <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="pedirCancelarReservaQuarto('${esc(r.id)}')">Cancelar</button>
      </div>` : ''}
    </div>`;
  }).join('');

  abrirModal(`Quarto ${q.numero} — ${q.tipo.replace(/_/g, ' ')}`, `
    <p class="mb-2">${badgeStatus(q.status)} <span class="muted">${esc(textoEstadoQuarto(q))}</span></p>
    ${q.ocupacao ? `<p class="muted texto-pequeno mb-2">Em curso: ${horaQuarto(q.ocupacao.checkin)} → ${horaQuarto(q.ocupacao.checkout)} · ${esc(FRACOES_QUARTO[q.ocupacao.fracao][0])}${q.ocupacao.nome_hospede ? ' · ' + esc(q.ocupacao.nome_hospede) : ''}</p>` : ''}
    ${q.status === 'POR_PAGAR' ? '<div class="quartos-aviso">💳 O quarto está arrumado mas tem consumos por pagar. Só fica disponível depois de o Caixa receber a conta (Caixa → Receber mesas).</div>' : ''}
    ${vende && ['OCUPADO'].includes(q.status) ? `<button class="btn-secundario btn-bloco" style="margin-bottom:.75rem" data-on-click="consumoQuarto('${esc(q.id)}')">+ Registar consumo no quarto</button>` : ''}
    ${q.status === 'LIMPEZA' ? `<div class="quartos-aviso">${escalado ? '⚠️ O prazo de arrumação terminou: só um gerente ou supervisor pode abrir este quarto.' : `🧹 Arrumar até às ${horaQuarto(q.livre_as)}.`}
      ${podeLimpar ? '<button class="btn-primario btn-bloco" style="margin-top:.5rem" data-on-click="pedirQuartoLimpo()">Dar como limpo e disponível</button>' : '<div class="muted texto-pequeno" style="margin-top:.4rem">Só quem tem o perfil de arrumação o pode dar como limpo.</div>'}</div>` : ''}
    <div class="campo"><label>Serviço</label>
      <div class="servicos-quarto">
        ${Object.entries(FRACOES_QUARTO).map(([k, [nome, dur, col]]) => `
          <button type="button" class="servico-quarto" id="srv-${k}" data-on-click="escolherServicoQuarto('${k}')"><b>${nome}</b><span>${dur}</span><span>${formatarMoeda(q[col])}</span></button>`).join('')}
      </div>
    </div>
    ${!vende ? '<p class="muted texto-pequeno mb-2">Não tem o perfil «Vender quartos». O Administrador activa-o na sua ficha de funcionário.</p>' : (bloqueio && !podeReservar ? `<p class="muted texto-pequeno mb-2">${esc(bloqueio)}</p>` : '')}
    ${vende && q.venda_bloqueada ? `<p class="aviso-vermelho mb-2">★ ${esc(q.venda_bloqueada)}</p>` : ''}
    <div class="acoes-quarto">
      <button class="btn-primario" ${podeVender ? '' : 'disabled'} data-on-click="passoQuarto('VENDER')">Vender</button>
      <button class="btn-secundario" ${podeReservar ? '' : 'disabled'} data-on-click="passoQuarto('RESERVAR')">Reservar</button>
      <button class="btn-secundario" ${podeAbrir ? '' : 'disabled'} data-on-click="passoQuarto('ABRIR')" title="O cliente saiu antes da hora">Abrir Quarto</button>
    </div>
    <div id="passo-quarto"></div>
    ${reservas ? `<div class="campo" style="margin-top:1rem"><label>Reservas</label>${reservas}</div>` : ''}
    ${chefia ? `<details style="margin-top:1rem"><summary class="muted texto-pequeno">Estado manual (manutenção / bloqueio)</summary>
      <div class="campo" style="margin-top:.5rem"><select id="novo-status-quarto">${['DISPONIVEL', 'MANUTENCAO', 'BLOQUEADO'].map(s => `<option value="${s}" ${s === q.status ? 'selected' : ''}>${NOME_ESTADO_QUARTO[s]}</option>`).join('')}</select></div>
      <button class="btn-secundario" data-on-click="salvarStatusQuarto('${esc(q.id)}')">Actualizar estado</button></details>` : ''}
  `);
}

function escolherServicoQuarto(fracao) {
  if (!window._quartoSel) return;
  window._quartoSel.fracao = fracao;
  Object.keys(FRACOES_QUARTO).forEach(k => document.getElementById(`srv-${k}`)?.classList.toggle('activo', k === fracao));
}

// Passo seguinte depois de escolher o serviço e a acção
function passoQuarto(acao) {
  const sel = window._quartoSel, q = sel && quartoPorId(sel.id), alvo = document.getElementById('passo-quarto');
  if (!q || !alvo) return;
  if (acao === 'ABRIR') {
    alvo.innerHTML = `<div class="quartos-aviso"><b>Abrir o quarto ${esc(q.numero)}?</b> O cliente sai antes da hora: o quarto passa a «a arrumar» e a equipa de arrumação é avisada (30 min para o dar como limpo).
      <div style="display:flex;gap:.5rem;margin-top:.6rem"><button class="btn-perigo" style="flex:1" data-on-click="confirmarAbrirQuarto()">Sim, abrir</button><button class="btn-secundario" style="flex:1" data-on-click="fecharPassoQuarto()">Não, voltar</button></div></div>`;
    return;
  }
  if (!sel.fracao) { toast('Escolha primeiro o serviço: Hora, Noite ou Diária', 'aviso'); return; }
  const [nome, dur, col] = FRACOES_QUARTO[sel.fracao];
  const inicio = acao === 'RESERVAR' ? `<div class="campo"><label>Início da reserva *</label><input type="datetime-local" id="pq-inicio" value="${horaLocalInput(new Date(Date.now() + 3600e3 * 3))}"></div>` : '';
  alvo.innerHTML = `<div class="quartos-passo">
    <div class="mb-2"><b>${acao === 'VENDER' ? 'Vender' : 'Reservar'} · ${nome} (${dur})</b> — <span style="color:var(--c-primary);font-weight:700">${formatarMoeda(q[col])}</span></div>
    ${inicio}
    <div class="campo"><label>Nome do hóspede</label><input type="text" id="pq-nome" maxlength="200" placeholder="Opcional"></div>
    <div class="campo"><label>Observações</label><input type="text" id="pq-obs" maxlength="300"></div>
    <div style="display:flex;gap:.5rem"><button class="btn-primario" style="flex:1" data-on-click="confirmarPassoQuarto('${acao}')">Confirmar ${acao === 'VENDER' ? 'venda' : 'reserva'}</button><button class="btn-secundario" data-on-click="fecharPassoQuarto()">Voltar</button></div></div>`;
}
const horaLocalInput = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function fecharPassoQuarto() { const a = document.getElementById('passo-quarto'); if (a) a.innerHTML = ''; }

async function confirmarPassoQuarto(acao) {
  const sel = window._quartoSel;
  if (!sel) return;
  const corpo = { fracao: sel.fracao, nome_hospede: document.getElementById('pq-nome').value.trim() || undefined, observacoes: document.getElementById('pq-obs').value.trim() || undefined };
  try {
    if (acao === 'RESERVAR') {
      const v = document.getElementById('pq-inicio').value;
      if (!v) { toast('Indique o início da reserva', 'erro'); return; }
      corpo.inicio = new Date(v).toISOString();
    }
    await api('POST', `/quartos/${sel.id}/${acao === 'VENDER' ? 'vender' : 'reservar'}`, corpo);
    toast(acao === 'VENDER' ? 'Venda registada' : 'Reserva registada', 'sucesso');
    fecharModal();
    recarregarQuartos();
  } catch (e) { toast(e.message, 'erro'); recarregarQuartos(); }
}

async function confirmarAbrirQuarto() {
  const sel = window._quartoSel;
  try {
    await api('POST', `/quartos/${sel.id}/abrir`);
    toast('Quarto aberto — equipa de arrumação avisada', 'sucesso');
    fecharModal();
    recarregarQuartos();
  } catch (e) { toast(e.message, 'erro'); }
}

function pedirQuartoLimpo() {
  const q = quartoPorId(window._quartoSel && window._quartoSel.id);
  if (q) modalConfirmar('Dar quarto como limpo', `O quarto <b>${esc(q.numero)}</b> fica <b>limpo e disponível</b> para venda. Confirma?`, 'confirmarQuartoLimpo', q.id);
}
async function confirmarQuartoLimpo(id) {
  fecharModal();
  try {
    const r = await api('POST', `/quartos/${id}/limpo`);
    toast(r && r.atraso_min ? `Quarto disponível (atraso de ${r.atraso_min} min registado)` : 'Quarto limpo e disponível', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
  recarregarQuartos();
}

async function entradaReservaQuarto(id) {
  try { await api('POST', `/quartos/reservas/${id}/entrada`); toast('Entrada registada', 'sucesso'); fecharModal(); }
  catch (e) { toast(e.message, 'erro'); }
  recarregarQuartos();
}
function pedirCancelarReservaQuarto(id) {
  modalConfirmar('Cancelar reserva', 'Tem a certeza que quer <b>cancelar esta reserva</b>?', 'cancelarReservaQuarto', id);
}
async function cancelarReservaQuarto(id) {
  fecharModal();
  try { await api('POST', `/quartos/reservas/${id}/cancelar`); toast('Reserva cancelada', 'sucesso'); }
  catch (e) { toast(e.message, 'erro'); }
  recarregarQuartos();
}

// ── Listas configuráveis (tipos de quarto, categorias, unidades): opções activas + a actual mesmo se desactivada ──
async function opcoesLista(lista, actual) {
  const ops = await api('GET', `/listas/${lista}`) || [];
  const valores = ops.filter(o => o.ativo).map(o => o.valor);
  if (actual && !valores.includes(actual)) valores.unshift(actual);
  return valores;
}
const htmlOpcoes = (valores, sel) => valores.map(v => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(String(v).replace(/_/g, ' '))}</option>`).join('');


async function modalFormQuarto(id) {
  let q = { numero: '', tipo: 'STANDARD', andar: 0, preco_2h: '', preco_pernoite: '', preco_diaria: '', descricao: '' };
  if (id) {
    const lista = await api('GET', '/quartos') || [];
    q = lista.find(x => x.id === id) || q;
  }
  const tipos = await opcoesLista('TIPO_QUARTO', q.tipo);
  abrirModal(id ? `Editar quarto ${esc(q.numero)}` : 'Novo quarto', `
    <div class="campo"><label>Número / nome *</label><input type="text" id="qf-numero" maxlength="10" value="${esc(q.numero)}" placeholder="Ex.: 101"></div>
    <div class="campo"><label>Tipo *</label>
      <select id="qf-tipo">${htmlOpcoes(tipos, q.tipo)}</select>
    </div>
    <div class="campo"><label>Andar</label><input type="number" id="qf-andar" value="${esc(q.andar)}"></div>
    <div class="campo"><label>Preço 2 horas (Kz) *</label><input type="number" min="0" step="any" id="qf-p2h" value="${esc(q.preco_2h)}"></div>
    <div class="campo"><label>Preço pernoite (Kz) *</label><input type="number" min="0" step="any" id="qf-ppern" value="${esc(q.preco_pernoite)}"></div>
    <div class="campo"><label>Preço diária (Kz) *</label><input type="number" min="0" step="any" id="qf-pdia" value="${esc(q.preco_diaria)}"></div>
    <div class="campo"><label>Descrição</label><input type="text" id="qf-desc" maxlength="500" value="${esc(q.descricao)}"></div>
    <div style="display:flex;gap:.5rem;margin-top:.5rem">
      <button class="btn-primario" style="flex:1" data-on-click="guardarQuarto('${id}')">Guardar</button>
      <button class="btn-secundario" data-on-click="fecharModal()">Cancelar</button>
    </div>
    ${id ? `<button class="btn-secundario btn-bloco" style="margin-top:.75rem;color:var(--c-erro,#e55)" data-on-click="pedirApagarQuarto('${id}')">🗑 Apagar quarto</button>` : ''}
  `);
}

async function guardarQuarto(id) {
  const v = i => document.getElementById(i).value;
  const dados = {
    numero: v('qf-numero').trim(), tipo: v('qf-tipo'), andar: v('qf-andar') === '' ? 0 : Number(v('qf-andar')),
    preco_2h: v('qf-p2h'), preco_pernoite: v('qf-ppern'), preco_diaria: v('qf-pdia'), descricao: v('qf-desc'),
  };
  try {
    await api(id ? 'PUT' : 'POST', id ? `/quartos/${id}` : '/quartos', dados);
    toast(id ? 'Quarto actualizado' : 'Quarto criado', 'sucesso');
    fecharModal();
    carregarModulo('configuracoes');
  } catch (e) {
    toast(e.message || 'Erro ao guardar quarto', 'erro');
  }
}

function pedirApagarQuarto(id) {
  modalConfirmar('Apagar quarto', 'Tem a certeza que quer <b>apagar este quarto</b>? Não pode ser desfeito.', 'apagarQuarto', id);
}

async function apagarQuarto(id) {
  fecharModal();
  try {
    await api('DELETE', `/quartos/${id}`);
    toast('Quarto apagado', 'sucesso');
    fecharModal();
    carregarModulo('configuracoes');
  } catch (e) {
    toast(e.message || 'Erro ao apagar quarto', 'erro');
  }
}

async function salvarStatusQuarto(id) {
  const status = document.getElementById('novo-status-quarto').value;
  try {
    await api('PATCH', `/quartos/${id}/status`, { status });
    toast('Estado actualizado', 'sucesso');
  } catch (e) {
    toast(e.message || 'Erro ao actualizar estado', 'erro');
  }
  fecharModal();
  recarregarQuartos();
}

// ════════════════════════════════════════════════════════════
