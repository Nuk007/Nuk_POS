'use strict';
// Portal do cliente — carrinho e pedido, serviços e eventos, alojamento, cadastro e delegação de eventos.
// Continua cliente.js (dividido a 21/11/2026 para nenhum ficheiro passar das 400 linhas); as funções são globais e partilhadas.

// ── Carrinho ────────────────────────────────────
function verCarrinho() {
  const ul = $('cart-list');
  ul.replaceChildren();
  const itens = itensCarrinho();
  if (!itens.length) {
    const li = no('li', null, 'Carrinho vazio');
    li.style.cssText = 'color:var(--muted);font-size:.82rem;padding:12px 0;text-align:center';
    ul.appendChild(li);
  }
  itens.forEach(i => {
    const li = no('li', 'cart-item');
    const qtd = no('span', 'cart-item-qty');
    const menos = no('button', 'qty-btn', '−'); menos.dataset.action = 'qtd'; menos.dataset.id = i.id; menos.dataset.delta = '-1';
    const mais = no('button', 'qty-btn', '+'); mais.dataset.action = 'qtd'; mais.dataset.id = i.id; mais.dataset.delta = '1';
    qtd.append(menos, no('span', null, String(i.qtd)), mais);
    li.append(no('span', 'cart-item-name', i.nome), qtd, no('span', 'cart-item-price', fmt(i.preco * i.qtd)));
    ul.appendChild(li);
  });
  // Estimativa: quem decide o desconto final é o servidor
  const bruto = totalBruto();
  const comEstrelas = session.isCliente && session.stars >= 5 && bruto <= 25000;
  $('disc-info').style.display = comEstrelas ? 'block' : 'none';
  $('cart-total').textContent = fmt(comEstrelas ? Math.round(bruto * 0.8 * 100) / 100 : bruto);
  // Convidado não tem carteira
  $('pay-coin').style.display = session.isCliente ? '' : 'none';
  if (!session.isCliente && session.payMethod === 'coin') limparPagamento();
  $('pay-coin-sub').textContent = 'Saldo: ' + fmt(session.wallet);
  $('coin-pay-info').style.display = session.payMethod === 'coin' ? 'block' : 'none';
  if (!$('cart-mesa').value && MESA_QR) $('cart-mesa').value = MESA_QR;
  go('s-carrinho');
}
function limparPagamento() {
  session.payMethod = null;
  document.querySelectorAll('.pay-opt').forEach(o => o.classList.remove('selected'));
  $('coin-pay-info').style.display = 'none';
}
function selectPay(el, method) {
  if (method === 'coin' && !session.isCliente) { toast('O Nuk-Coin é só para clientes registados.', 'err'); return; }
  session.payMethod = method;
  document.querySelectorAll('.pay-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  $('coin-pay-info').style.display = method === 'coin' ? 'block' : 'none';
}

function novaChave() {
  const b = new Uint8Array(16);
  (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
async function confirmarPedido() {
  if (session.aEnviar) return;
  const itens = itensCarrinho();
  if (!itens.length) { toast('Adicione produtos ao carrinho.', 'err'); return; }
  if (!session.payMethod) { toast('Seleccione a forma de pagamento.', 'err'); return; }
  const metodo = METODOS[session.payMethod];
  const body = { itens: itens.map(i => ({ produto_id: i.id, quantidade: i.qtd })), metodo_pagamento: metodo.api };
  if (session.isCliente) { body.cliente_id = session.clienteId; body.pin = session.pin; }
  const mesa = $('cart-mesa').value.trim();
  if (mesa) body.mesa_ref = mesa;
  // Uma chave por pedido: se a resposta se perder, o «tentar de novo» devolve o mesmo pedido em vez de o repetir
  if (!session.chavePedido) session.chavePedido = novaChave();
  body.chave_idempotencia = session.chavePedido;

  const botao = document.querySelector('[data-action="confirmar-pedido"]');
  session.aEnviar = true; ocupar(botao, true);
  const r = await chamar('/api/cliente/pedido-restaurante', { method: 'POST', body });
  session.aEnviar = false; ocupar(botao, false);
  if (!r.ok) {
    // O pedido NÃO foi enviado: o carrinho fica intacto para tentar de novo
    toast(r.rede ? 'Sem ligação ao servidor. O pedido NÃO foi enviado — tente novamente.' : (r.data.erro || 'Não foi possível enviar o pedido.'), 'err');
    return;
  }
  const d = r.data;
  session.chavePedido = null;
  session.cart = {}; limparPagamento(); updateCartBadge(); buildMenu();
  if (session.isCliente) {
    if (d.nukcoin_saldo_novo != null) session.wallet = parseFloat(d.nukcoin_saldo_novo);
    atualizarSaldo(); // sincroniza estrelas e saldo reais
    $('cli-wallet-pill').textContent = '💜 ' + fmt(session.wallet);
  }
  $('pedido-ok-msg').textContent = 'Pedido ' + d.codigo + ' enviado. Pagamento: ' + metodo.nome + ' — ' + fmt(parseFloat(d.total_final));
  $('star-earned').style.display = d.estrela_ganha ? 'block' : 'none';
  const desc = parseFloat(d.desconto) || 0;
  $('disc-earned').style.display = desc > 0 ? 'block' : 'none';
  if (desc > 0) $('disc-earned').textContent = '🎁 Desconto de ' + fmt(desc) + ' aplicado neste pedido!';
  go('s-pedido-ok');
}

// ── Serviços e Eventos ──────────────────────────
/** Envia a solicitação ao POS. Devolve true só se o servidor a registou. */
async function enviarSolicitacao(tipo, nomeServico) {
  if (session.aEnviar) return false;
  if (!session.nome || !session.tel) { toast('Identifique-se primeiro.', 'err'); go('s-acesso'); return false; }
  session.aEnviar = true;
  const r = await chamar('/api/cliente/solicitacao', { method: 'POST', body: { tipo, nome_servico: nomeServico, nome: session.nome, telefone: session.tel } });
  session.aEnviar = false;
  if (!r.ok) { toast(r.rede ? 'Sem ligação ao servidor. O pedido NÃO foi enviado — tente novamente.' : (r.data.erro || 'Não foi possível enviar o pedido.'), 'err'); return false; }
  return true;
}
function mostrarConfirmacao(emoji, titulo, msg) {
  $('sol-emoji').textContent = emoji;
  $('sol-titulo').textContent = titulo;
  $('sol-msg').textContent = msg;
  go('s-solicitacao-ok');
}
async function solicitarServico(nome, preco, categoria) {
  const tipo = categoria === 'HOSPEDAGEM' ? 'HOSPEDAGEM' : 'SERVICO';
  if (!(await enviarSolicitacao(tipo, nome))) return;
  mostrarConfirmacao('🛎️', 'Pedido enviado!', nome + (preco ? ' (' + preco + ')' : '') + ' — a nossa equipa entrará em contacto para confirmar.');
}
async function solicitarEvento(nome) {
  if (!(await enviarSolicitacao('EVENTO', nome))) return;
  mostrarConfirmacao('🎉', 'Evento solicitado!', nome + ' — receberá um orçamento personalizado em breve. Obrigado!');
}

// ── Alojamento: preços reais do estabelecimento e pedido de reserva ──
const FRACAO_ICONE = { DUAS_HORAS: '⏱️', PERNOITE: '🌙', DIARIA: '📅' };
async function carregarHospedagem() {
  const grid = $('grid-hospedagem'); if (!grid) return;
  const r = await chamar('/api/cliente/hospedagem');
  if (r.status === 404) { $('hosp-seccao').style.display = 'none'; return; }
  grid.textContent = '';
  if (!r.ok) { grid.appendChild(no('div', 'muted', r.rede ? MSG_REDE : 'Não foi possível carregar os quartos.')); return; }
  session.hosp = r.data;
  if (!r.data.tipos.length) { grid.appendChild(no('div', 'muted', 'Sem quartos disponíveis de momento.')); return; }
  r.data.tipos.forEach(t => {
    Object.keys(r.data.fracoes).forEach(f => {
      const preco = t.precos[f];
      if (!preco) return;
      const item = no('div', 'menu-item');
      item.dataset.action = 'escolher-quarto'; item.dataset.tipo = t.tipo; item.dataset.fracao = f;
      item.appendChild(no('span', 'menu-item-emoji', FRACAO_ICONE[f] || '🛏️'));
      item.appendChild(no('div', 'menu-item-name', `${t.tipo} · ${r.data.fracoes[f]}`));
      item.appendChild(no('div', 'menu-item-price', (t.quartos > 1 ? 'desde ' : '') + fmt(preco)));
      grid.appendChild(item);
    });
  });
}
function escolherQuarto(tipo, fracao) {
  session.reservaQuarto = { tipo, fracao };
  const h = session.hosp || { fracoes: {} };
  $('hosp-escolha').textContent = `Quarto ${tipo} · ${h.fracoes[fracao] || fracao}`;
  const agora = new Date(Date.now() + 30 * 60000 - new Date().getTimezoneOffset() * 60000);
  if (!$('hosp-inicio').value) $('hosp-inicio').value = agora.toISOString().slice(0, 16);
  $('hosp-form').style.display = 'block';
  $('hosp-form').scrollIntoView({ behavior: 'smooth' });
}
async function pedirReservaQuarto() {
  if (session.aEnviar) return;
  const esc = session.reservaQuarto;
  if (!esc) return;
  if (!session.nome || !session.tel) { toast('Identifique-se primeiro.', 'err'); go('s-acesso'); return; }
  const v = $('hosp-inicio').value;
  const inicio = v ? new Date(v) : null;
  if (!inicio || isNaN(inicio)) { toast('Indique a data e hora de entrada.', 'err'); return; }
  session.aEnviar = true;
  const r = await chamar('/api/cliente/reserva-quarto', { method: 'POST', body: { tipo_quarto: esc.tipo, fracao: esc.fracao, inicio: inicio.toISOString(), nome: session.nome, telefone: session.tel, observacoes: $('hosp-obs').value.trim() || undefined } });
  session.aEnviar = false;
  if (!r.ok) { toast(r.rede ? 'Sem ligação ao servidor. O pedido NÃO foi enviado — tente novamente.' : (r.data.erro || 'Não foi possível enviar o pedido.'), 'err'); return; }
  $('hosp-form').style.display = 'none'; session.reservaQuarto = null;
  mostrarConfirmacao('🛏️', 'Pedido de reserva enviado!', r.data.mensagem);
}

// ── Cadastro ────────────────────────────────────
async function cadastrar() {
  if (session.aEnviar) return;
  const nome = $('cad-nome').value.trim();
  const tel = $('cad-tel').value.trim();
  const prov = $('cad-prov').value;
  const ref = $('cad-ref').value.trim();
  const pin = $('cad-pin').value.trim();
  if (!nome) { toast('Insira o nome.', 'err'); return; }
  if (!/^9[0-9]{8}$/.test(tel)) { toast('Telemóvel inválido (9XXXXXXXX).', 'err'); return; }
  if (!prov) { toast('Seleccione a província.', 'err'); return; }
  if (!/^\d{4}$/.test(pin)) { toast('Escolha um PIN de 4 dígitos.', 'err'); return; }

  session.aEnviar = true;
  const r = await chamar('/api/cliente/cadastrar', { method: 'POST', body: { nome, telefone: tel, provincia: prov, pin, referido_por_tel: ref || null } });
  session.aEnviar = false;
  if (!r.ok) { toast(r.rede ? MSG_REDE : (r.data.erro || 'Erro no cadastro.'), 'err'); return; }

  const c = r.data.cliente;
  session = Object.assign(novaSessao(), {
    nome: c.nome, tel: c.telefone, prov: c.provincia || prov,
    isCliente: true, clienteId: c.id, pin, stars: c.estrelas || 0, wallet: parseFloat(c.nukcoin_saldo) || 0,
  });
  $('cad-pin').value = '';
  if (r.data.referral_bonus) toast('⭐ O seu amigo (+244 ' + ref + ') ganhou uma estrela!', 'info');
  renderStars(session.stars);
  mostrarConfirmacao('🎉', 'Cadastro concluído!', 'Bem-vindo, ' + session.nome.split(' ')[0] + '! Recebeu ' + (c.pontos || 0) + ' pontos de boas-vindas. Pode agora aceder a todos os serviços.');
}

// ── Delegação de eventos (a CSP bloqueia onclick= inline) ──
const ACOES = {
  'go':                   el => go(el.dataset.screen),
  'submit-acesso':        () => submitAcesso(),
  'sair':                 () => sair(),
  'abrir-cliente':        () => abrirCliente(),
  'abrir-cadastrar':      () => abrirCadastrar(),
  'abrir-nukcoin':        () => loadNukCoin(),
  'abrir-restaurante':    () => loadRestaurante(),
  'recarregar-menu':      () => recarregarMenu(),
  'atualizar-saldo':      () => atualizarSaldo(),
  'add-produto':          el => addProduto(el.dataset.id),
  'ver-carrinho':         () => verCarrinho(),
  'qtd':                  el => alterarQtd(el.dataset.id, parseInt(el.dataset.delta, 10)),
  'select-pay':           el => selectPay(el, el.dataset.method),
  'confirmar-pedido':     () => confirmarPedido(),
  'voltar-inicio':        () => voltarInicio(),
  'voltar-de-restaurante': () => voltarMenu(),
  'voltar-de-servicos':   () => voltarMenu(),
  'voltar-de-eventos':    () => voltarMenu(),
  'solicitar-servico':    el => solicitarServico(el.dataset.tipo, el.dataset.preco, el.dataset.categoria),
  'solicitar-evento':     el => solicitarEvento(el.dataset.tipo),
  'cadastrar':            () => cadastrar(),
  'escolher-quarto':      el => escolherQuarto(el.dataset.tipo, el.dataset.fracao),
  'pedir-reserva-quarto': () => pedirReservaQuarto(),
  'cancelar-reserva-quarto': () => { $('hosp-form').style.display = 'none'; session.reservaQuarto = null; },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACOES[el.dataset.action];
  if (fn) fn(el);
});
