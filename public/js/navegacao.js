'use strict';
/**
 * Botão «voltar» do telemóvel e do navegador (pedido do dono, 21/11/2026, «como no AviationMoney»).
 * O Nuk_POS é uma página única: mudar de módulo não mudava o endereço, por isso o «voltar» do Android fechava logo
 * a aplicação. Agora entram no histórico do navegador:
 *  - cada mudança de módulo (`carregarModulo`);
 *  - cada ecrã interno de um módulo (ex.: o painel de venda de uma mesa, de um quarto ou do Take Away — `navSubEcra`);
 *  - a janela (modal) aberta e o menu lateral aberto no telemóvel.
 * «Voltar» fecha a janela ou o menu, sai do ecrã interno para a lista do módulo, ou regressa ao módulo anterior.
 * No primeiro ecrã pede um segundo toque (2,5 s) para sair, para a app não fechar sem querer.
 * Uma janela fechada por um botão recua o histórico; o que se abrir enquanto esse recuo não acaba fica em espera
 * e entra depois (senão o recuo apagava a entrada nova).
 */
const NAV = { pronto: false, ignorarPop: 0, pendentes: [], ultimoSair: 0, sub: null, rede: null };

const navEstado = extra => ({ nuk: 1, modulo: NUK.moduloActual, sub: NAV.sub, ...extra });

function navEmpurrar(estado) {
  if (!NAV.pronto) return;
  if (NAV.ignorarPop) { NAV.pendentes.push(estado); return; }
  history.pushState(estado, '');
}
function navLibertarPendentes() {
  clearTimeout(NAV.rede);
  NAV.ignorarPop = 0;
  const p = NAV.pendentes.splice(0);
  for (const e of p) history.pushState(e, '');
}
/** Recua uma entrada do histórico sem reagir a ela (a janela já foi fechada pelo botão). */
function navRecuar() {
  if (!NAV.pronto) return;
  NAV.ignorarPop++;
  history.back();
  clearTimeout(NAV.rede);
  NAV.rede = setTimeout(() => { if (NAV.ignorarPop) navLibertarPendentes(); }, 1500); // rede de segurança
}

/** Chamada no fim do arranque, depois do primeiro módulo. */
function navIniciar() {
  if (NAV.pronto) return;
  NAV.sub = null;
  history.replaceState({ nuk: 1, raiz: true }, '');
  history.pushState(navEstado(), '');
  NAV.pronto = true;
}
function navParar() { NAV.pronto = false; NAV.sub = null; NAV.pendentes = []; NAV.ignorarPop = 0; }

/** carregarModulo avisa aqui antes de desenhar. Devolve sem fazer nada quando a mudança vem do próprio «voltar». */
function navAoMudarModulo(modulo, deHistorico) {
  if (!NAV.pronto || deHistorico) return;
  if (modulo === NUK.moduloActual) {
    // recarregar o mesmo módulo (ex.: depois de gravar, ou «← Mesas» no painel): sai do ecrã interno, se houver
    if (NAV.sub) { NAV.sub = null; navRecuar(); }
    return;
  }
  NAV.sub = null;
  navEmpurrar({ nuk: 1, modulo, sub: null });
}
/** Um módulo abriu um ecrã interno (ex.: painel de venda de uma mesa): «voltar» regressa à lista do módulo. */
function navSubEcra(nome) {
  if (!NAV.pronto || NAV.sub === nome) return;
  NAV.sub = nome;
  navEmpurrar(navEstado({ sub: nome }));
}
const navEmSubEcra = () => !!NAV.sub;

const modalAberto = () => { const o = document.getElementById('modal-overlay'); return !!o && o.style.display === 'flex'; };
const sidebarAberta = () => { const s = document.getElementById('sidebar'); return !!s && s.classList.contains('aberta'); };

function navAoAbrirModal(jaAberta) { if (!jaAberta) navEmpurrar(navEstado({ modal: true })); }
function navAoFecharModal(peloVoltar) { if (!peloVoltar && NAV.pronto) navRecuar(); }
function navAoAbrirSidebar() { navEmpurrar(navEstado({ sidebar: true })); }
function navAoFecharSidebar(peloVoltar) { if (!peloVoltar && NAV.pronto) navRecuar(); }

addEventListener('popstate', e => {
  if (NAV.ignorarPop) { navLibertarPendentes(); return; }
  if (!NAV.pronto || !NUK.token) return;
  // 1) janela aberta → fecha-a
  if (modalAberto()) { fecharModal(true); return; }
  // 2) menu lateral aberto (telemóvel) → fecha-o
  if (sidebarAberta()) { fecharSidebar(true); return; }
  const st = e.state;
  if (!st || !st.nuk) return;
  // 3) primeiro ecrã: volta ao módulo inicial; lá, um segundo toque sai da app
  if (st.raiz) {
    const inicial = moduloPermitido('dashboard');
    if (NUK.moduloActual !== inicial || NAV.sub) {
      NAV.sub = null;
      carregarModulo(inicial, { deHistorico: true });
      history.pushState(navEstado(), '');
      return;
    }
    if (Date.now() - NAV.ultimoSair < 2500) { NAV.pronto = false; history.back(); return; } // segundo toque: sai
    NAV.ultimoSair = Date.now();
    toast('Toque outra vez em «voltar» para sair.', 'aviso', 2500);
    history.pushState(navEstado(), '');
    return;
  }
  // 4) módulo ou ecrã interno anterior
  const mudouModulo = st.modulo !== NUK.moduloActual;
  if (mudouModulo || (NAV.sub && !st.sub)) {
    NAV.sub = null; // o ecrã interno não se reconstrói: abre-se a lista do módulo
    carregarModulo(st.modulo, { deHistorico: true });
    if (st.sub || st.modal || st.sidebar) history.replaceState(navEstado(), '');
  } else NAV.sub = st.sub || null;
});
