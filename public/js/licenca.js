// Nuk_POS — licença do estabelecimento no ecrã (14/11/2026).
// • Licença expirada ou conta suspensa → ecrã próprio (em vez de um erro vermelho solto em cada módulo),
//   com a data de fim e o botão de contacto ao suporte pelo WhatsApp.
// • A 7 dias ou menos do fim → faixa de aviso no topo, que se pode fechar (volta no dia seguinte).
// Sem handlers inline (CSP): addEventListener; textos por textContent.
'use strict';

let _licencaBloqueada = false;

function _licDataPt(fim) {
  if (!fim) return null;
  try { return new Date(fim).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' }); } catch (_) { return null; }
}

function _licLinkSuporte(numero, estabelecimento, situacao) {
  if (!numero) return null;
  const motivo = situacao === 'SUSPENSA' ? 'a conta está suspensa' : 'a licença expirou';
  const texto = `Olá! Sou do estabelecimento ${estabelecimento || ''} no Nuk_POS e ${motivo}. Quero renovar.`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** Lê o estado da licença; devolve null se o servidor não responder (não se bloqueia por isso). */
async function lerLicenca() {
  try { return await api('GET', '/saas/licenca'); } catch (_) { return null; }
}

/** No arranque: true se a licença bloqueia (e mostra o ecrã); false para seguir. Mostra o aviso dos 7 dias. */
async function verificarLicenca() {
  const l = await lerLicenca();
  if (!l) return false;
  if (l.situacao !== 'ACTIVA') { desenharLicencaBloqueada(l); return true; }
  desenharAvisoLicenca(l);
  return false;
}

/** Chamado pelo api() ao receber 403 LICENCA_EXPIRADA / TENANT_SUSPENSA em qualquer ecrã. */
async function mostrarLicencaBloqueada(resposta) {
  if (_licencaBloqueada) return;
  const l = await lerLicenca();
  desenharLicencaBloqueada(l || {
    situacao: resposta && resposta.codigo === 'TENANT_SUSPENSA' ? 'SUSPENSA' : 'EXPIRADA',
    fim: resposta && resposta.fim,
  });
}

function desenharLicencaBloqueada(l) {
  _licencaBloqueada = true;
  const app = document.getElementById('app');
  if (app) app.style.display = 'none';
  const tela = document.getElementById('tela-licenca');
  tela.style.display = 'flex';

  const suspensa = l.situacao === 'SUSPENSA';
  document.getElementById('licenca-titulo').textContent = suspensa ? 'Conta suspensa' : 'A licença expirou';
  const data = _licDataPt(l.fim);
  document.getElementById('licenca-texto').textContent = suspensa
    ? 'A conta deste estabelecimento está suspensa. Contacte o suporte Nuk_POS para a reactivar.'
    : `A licença ${l.estabelecimento ? 'de ' + l.estabelecimento + ' ' : ''}${data ? 'terminou a ' + data : 'terminou'}. ` +
      'As vendas e os restantes módulos ficam parados até à renovação.';
  document.getElementById('licenca-dados').textContent =
    'Os seus dados (vendas, clientes, stock, documentos) estão guardados e voltam a aparecer logo que a licença for renovada.';

  const btn = document.getElementById('licenca-suporte');
  const link = _licLinkSuporte(l.suporte_whatsapp, l.estabelecimento, l.situacao);
  if (link) { btn.href = link; btn.style.display = ''; } else btn.style.display = 'none';
}

function desenharAvisoLicenca(l) {
  const faixa = document.getElementById('aviso-licenca');
  if (!faixa) return;
  const hoje = new Date().toISOString().slice(0, 10);
  let fechado = null;
  try { fechado = localStorage.getItem('nuk_aviso_licenca'); } catch (_) { /* sem armazenamento */ }
  if (!l.aviso || fechado === hoje) { faixa.style.display = 'none'; return; }
  const d = l.dias_restantes;
  const quando = d <= 0 ? 'hoje' : d === 1 ? 'amanhã' : `daqui a ${d} dias`;
  const data = _licDataPt(l.fim);
  document.getElementById('aviso-licenca-texto').textContent =
    `A licença termina ${quando}${data ? ' (' + data + ')' : ''}. Renove para não interromper as vendas.`;
  const link = _licLinkSuporte(l.suporte_whatsapp, l.estabelecimento, 'AVISO');
  const btn = document.getElementById('aviso-licenca-suporte');
  if (link) {
    btn.href = `https://wa.me/${l.suporte_whatsapp}?text=${encodeURIComponent(`Olá! Quero renovar a licença do Nuk_POS de ${l.estabelecimento || 'o meu estabelecimento'}.`)}`;
    btn.style.display = '';
  } else btn.style.display = 'none';
  faixa.style.display = 'flex';
}

document.getElementById('licenca-sair').addEventListener('click', () => { _licencaBloqueada = false; logout(); });
document.getElementById('licenca-tentar').addEventListener('click', async () => {
  const l = await lerLicenca();
  if (l && l.situacao === 'ACTIVA') {
    _licencaBloqueada = false;
    document.getElementById('tela-licenca').style.display = 'none';
    iniciarApp();
  } else if (typeof toast === 'function') {
    toast('A licença ainda não foi renovada.', 'erro');
  }
});
document.getElementById('aviso-licenca-fechar').addEventListener('click', () => {
  try { localStorage.setItem('nuk_aviso_licenca', new Date().toISOString().slice(0, 10)); } catch (_) { /* ignorar */ }
  document.getElementById('aviso-licenca').style.display = 'none';
});
