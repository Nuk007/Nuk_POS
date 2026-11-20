'use strict';
// Nuk_POS — Clientes (Nuk-Coin, PIN) e Solicitações do portal.
// Scripts clássicos: as funções são globais e chamam-se umas às outras entre ficheiros (data-on-click).

// ════════════════════════════════════════════════════════════
// CLIENTES
// ════════════════════════════════════════════════════════════
const NUKCOIN_VALORES = [5000, 10000, 15000, 20000, 25000, 50000];

function linhaCliente(c) {
  return `
    <tr>
      <td class="negrito">${esc(c.nome)}</td>
      <td>${esc(c.telefone) || '—'}</td>
      <td><span class="fidelizacao-${esc(c.nivel_fidelizacao)}">★ ${esc(c.nivel_fidelizacao)}</span></td>
      <td>⭐ ${Number(c.estrelas) || 0}</td>
      <td class="texto-primario">💜 ${formatarMoeda(c.nukcoin_saldo || 0)}</td>
      <td class="muted">${formatarData(c.criado_em).split(',')[0]}</td>
      <td>
        <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="modalCarregarNukcoin('${esc(c.id)}')">Carregar Nuk-Coin</button>
        <button class="btn-secundario" style="padding:.3rem .6rem;font-size:.78rem" data-on-click="reporPinCliente('${esc(c.id)}')">Repor PIN</button>
      </td>
    </tr>`;
}

async function modulo_clientes(el) {
  try {
    const _clientesResp = await api('GET', '/clientes') || [];
    const clientes = Array.isArray(_clientesResp) ? _clientesResp : (_clientesResp.data || []);
    window._clientesCache = clientes;

    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">👥 Clientes</span>
        <button class="btn-primario" data-on-click="modalNovoCliente()">+ Novo Cliente</button>
        <input type="text" class="input-pesquisa" placeholder="Pesquisar..." data-on-input="pesquisarClientes(this.value)">
      </div>
      <div class="card tabela-wrapper">
        <table id="tab-clientes">
          <thead><tr><th>Nome</th><th>Telefone</th><th>Nível</th><th>Estrelas</th><th>Nuk-Coin</th><th>Registado em</th><th>Acções</th></tr></thead>
          <tbody>
            ${clientes.map(linhaCliente).join('')}
            ${!clientes.length ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:1rem">Sem clientes</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`;
  }
}

// O carregamento de Nuk-Coin é feito no Caixa (exige o caixa aberto e regista a forma de pagamento)
function modalCarregarNukcoin(id) { window._nukcoinPre = id; carregarModulo('nukcoin'); }

async function reporPinCliente(id) {
  if (!confirm('Repor o PIN deste cliente? Ele define um novo PIN no próximo acesso.')) return;
  try {
    const r = await api('POST', '/cliente/reset-pin', { cliente_id: id });
    toast(r.mensagem || 'PIN reposto', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
}

async function pesquisarClientes(q) {
  if (q.length < 2) return;
  try {
    const _cResp = await api('GET', `/clientes?q=${encodeURIComponent(q)}`) || [];
    const clientes = Array.isArray(_cResp) ? _cResp : (_cResp.data || []);
    const tbody = document.querySelector('#tab-clientes tbody');
    window._clientesCache = clientes;
    if (tbody) tbody.innerHTML = clientes.map(linhaCliente).join('') || '<tr><td colspan="7" class="muted" style="text-align:center">Sem resultados</td></tr>';
  } catch {}
}

function modalNovoCliente() {
  abrirModal('Novo Cliente', `
    <div class="campo"><label>Nome</label><input type="text" id="nc-nome" placeholder="Nome completo"></div>
    <div class="campo"><label>Telefone</label><input type="tel" id="nc-tel" placeholder="+244 9xx xxx xxx"></div>
    <div class="campo"><label>Email</label><input type="email" id="nc-email" placeholder="email@exemplo.com"></div>
    <div class="campo"><label>NIF</label><input type="text" id="nc-nif" placeholder="Opcional"></div>
    <button class="btn-primario btn-bloco" data-on-click="guardarNovoCliente()">Guardar</button>
  `);
}

async function guardarNovoCliente() {
  const nome = document.getElementById('nc-nome').value;
  const telefone = document.getElementById('nc-tel').value;
  const email = document.getElementById('nc-email').value;
  const nif = document.getElementById('nc-nif').value;
  if (!nome) { toast('Nome é obrigatório', 'erro'); return; }
  try {
    await api('POST', '/clientes', { nome, telefone: telefone||null, email: email||null, nif: nif||null });
    toast('Cliente registado!', 'sucesso');
    fecharModal();
    carregarModulo('clientes');
  } catch (e) { toast(e.message, 'erro'); }
}

// ════════════════════════════════════════════════════════════
// SOLICITAÇÕES DO PORTAL (hospedagem, serviços e eventos pedidos pelo cliente)
// ════════════════════════════════════════════════════════════
const ROTULO_SOLICITACAO = { HOSPEDAGEM: '🛏️ Hospedagem', SERVICO: '🛎️ Serviço', EVENTO: '🎉 Evento' };
NUK.filtroSolicitacoes = 'PENDENTE';

async function modulo_solicitacoes(el) {
  try {
    const estado = NUK.filtroSolicitacoes;
    const r = await api('GET', `/solicitacoes-portal?limit=100${estado ? '&status=' + encodeURIComponent(estado) : ''}`);
    const lista = r.data || [];
    el.innerHTML = `
      <div class="toolbar">
        <span class="secao-titulo">🔔 Solicitações do portal</span>
        <select class="input-pesquisa" data-on-change="filtrarSolicitacoes(this.value)">
          ${[['PENDENTE', 'Por tratar'], ['CONFIRMADA', 'Confirmadas'], ['CANCELADA', 'Canceladas'], ['', 'Todas']]
            .map(([v, t]) => `<option value="${v}" ${v === estado ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="card tabela-wrapper">
        <table>
          <thead><tr><th>Há</th><th>Tipo</th><th>Pedido</th><th>Cliente</th><th>Telefone</th><th>Estado</th><th>Acções</th></tr></thead>
          <tbody>
            ${lista.map(linhaSolicitacao).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:1rem">Sem solicitações</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    actualizarBadgeSolicitacoes();
  } catch (e) {
    el.innerHTML = `<div class="erro-msg">Erro: ${esc(e.message)}</div>`;
  }
}

function linhaSolicitacao(s) {
  const porTratar = s.status === 'PENDENTE';
  return `<tr>
    <td>${tempoDesde(s.criado_em)}</td>
    <td>${ROTULO_SOLICITACAO[s.tipo] || esc(s.tipo)}</td>
    <td><strong>${esc(s.nome_servico)}</strong>${s.valor_estimado ? `<div class="muted texto-pequeno">${formatarMoeda(s.valor_estimado)}</div>` : ''}</td>
    <td>${esc(s.nome_contacto)}</td>
    <td>${esc(s.telefone_contacto)}</td>
    <td>${badgeStatus(s.status)}</td>
    <td>${porTratar && s.fracao && s.inicio
      ? `<button class="btn-primario" data-on-click="modalReservarSolicitacao('${esc(s.id)}')">Reservar quarto</button> <button class="btn-secundario" data-on-click="pedirCancelarSolicitacao('${esc(s.id)}')">Cancelar</button>`
      : porTratar
      ? `<button class="btn-primario" data-on-click="actualizarSolicitacao('${esc(s.id)}','CONFIRMADA')">Confirmar</button> <button class="btn-secundario" data-on-click="pedirCancelarSolicitacao('${esc(s.id)}')">Cancelar</button>`
      : ''}</td>
  </tr>`;
}

function filtrarSolicitacoes(estado) {
  NUK.filtroSolicitacoes = estado;
  carregarModulo('solicitacoes');
}

function pedirCancelarSolicitacao(id) {
  modalConfirmar('Cancelar solicitação', 'Tem a certeza que quer <b>cancelar esta solicitação</b>?', 'cancelarSolicitacaoConfirmada', id);
}
function cancelarSolicitacaoConfirmada(id) { fecharModal(); actualizarSolicitacao(id, 'CANCELADA'); }

async function actualizarSolicitacao(id, status) {
  try {
    await api('PATCH', `/solicitacoes-portal/${id}/status`, { status });
    toast(status === 'CONFIRMADA' ? 'Solicitação confirmada' : 'Solicitação cancelada', 'sucesso');
    carregarModulo('solicitacoes');
  } catch (e) { toast(e.message, 'erro'); }
}

// Pedido de reserva do portal: escolher o quarto livre e criar a reserva (perfil «vender quartos»)
async function modalReservarSolicitacao(id) {
  try {
    const r = await api('GET', `/solicitacoes-portal/${id}/quartos-livres`);
    const s = r.solicitacao;
    abrirModal('Reservar quarto', `
      <p style="margin-bottom:.5rem"><b>${esc(s.nome_servico)}</b><br><span class="muted">${esc(s.nome_contacto)} · ${esc(s.telefone_contacto)}</span></p>
      ${r.quartos.length ? r.quartos.map(q => `<button class="btn-secundario btn-bloco" style="margin:.25rem 0" data-on-click="reservarSolicitacao('${esc(id)}','${esc(q.id)}')">Quarto ${esc(q.numero)} · ${formatarMoeda(q.preco)}</button>`).join('')
        : '<div class="erro-msg">Não há quartos deste tipo livres nesse período. Contacte o cliente para outra hora.</div>'}`);
  } catch (e) { toast(e.message, 'erro'); }
}
async function reservarSolicitacao(id, quartoId) {
  try {
    const r = await api('POST', `/solicitacoes-portal/${id}/reservar`, { quarto_id: quartoId });
    abrirModal('Reserva criada', `
      <p>Quarto <b>${esc(r.quarto_numero)}</b> reservado para ${esc(r.solicitacao.nome_contacto)}.</p>
      <a class="btn-primario btn-bloco" style="text-align:center;text-decoration:none;margin-top:.6rem" href="${esc(r.link_whatsapp)}" target="_blank" rel="noopener">Avisar o cliente pelo WhatsApp</a>`);
    carregarModulo('solicitacoes');
  } catch (e) { toast(e.message, 'erro'); }
}
