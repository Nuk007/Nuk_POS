'use strict';
/**
 * Modo sem internet do POS (14/11/2026).
 *
 * - Leituras do painel de venda (produtos, preços em vigor, mesas, quartos): cada resposta boa fica guardada no
 *   dispositivo; sem ligação, `api()` (nukpos.js) devolve a última cópia (`offlineLer`).
 * - Pedidos: se o envio falhar por falta de rede, o pedido fica na fila deste dispositivo (`offlineGuardar`), com a
 *   sua chave de idempotência e a hora real da venda. A fila envia-se sozinha quando a ligação volta (evento
 *   `online`, a cada 20 s e ao arrancar). O servidor nunca duplica (mesma chave = mesmo pedido) e usa os preços
 *   da hora da venda. Um pedido recusado (ex.: stock esgotado) fica marcado para alguém decidir — descartar pede
 *   confirmação.
 * - Indicador na barra de topo (#offline-estado): «📴 Sem ligação», «⏳ N por enviar», «⚠ N recusados».
 * O pagamento continua a precisar de ligação (dinheiro, Nuk-Coin e documentos fiscais nunca se decidem offline).
 */
const OFF_CACHE = ['/produtos?disponivel=true', '/precos/actuais', '/mesas', '/quartos', '/configuracoes'];
const OFF_ORIGENS = ['MESA', 'BALCAO', 'LAZER', 'LOJA', 'QUARTO', 'TAKEAWAY'];
let _offTimer = null;
let _offEnviando = false;

const offlineEstab = () => (NUK.utilizador && NUK.utilizador.tenant_slug) || 'geral';
const offlineChaveFila = () => `nuk_fila_offline:${offlineEstab()}`;
const offlineChaveCache = path => `nuk_cache:${offlineEstab()}:${path}`;

function offlineFila() {
  try { const v = JSON.parse(localStorage.getItem(offlineChaveFila()) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function offlineGravarFila(f) {
  try { localStorage.setItem(offlineChaveFila(), JSON.stringify(f)); } catch (e) { toast('Memória do dispositivo cheia: não foi possível guardar o pedido', 'erro', 8000); throw e; }
  offlineIndicador();
}

/** Guarda a resposta de uma leitura do painel de venda (só as da lista). */
function offlineGuardarLeitura(path, dados) {
  if (!OFF_CACHE.some(p => path.startsWith(p))) return;
  try { localStorage.setItem(offlineChaveCache(path), JSON.stringify({ em: Date.now(), dados })); } catch (e) { /* sem espaço: segue sem cópia */ }
}
/** Última cópia guardada de uma leitura (ou undefined). */
function offlineLer(path) {
  if (!OFF_CACHE.some(p => path.startsWith(p))) return undefined;
  try { const v = JSON.parse(localStorage.getItem(offlineChaveCache(path)) || 'null'); return v ? v.dados : undefined; } catch (e) { return undefined; }
}

/** Põe o pedido na fila deste dispositivo. Devolve a entrada. */
function offlineGuardar(corpo) {
  if (!OFF_ORIGENS.includes(corpo.origem)) throw new Error('Este tipo de pedido precisa de ligação');
  if (!corpo.chave_idempotencia) throw new Error('Pedido sem chave: não pode ser guardado');
  const f = offlineFila();
  if (f.some(x => x.corpo.chave_idempotencia === corpo.chave_idempotencia)) return f.find(x => x.corpo.chave_idempotencia === corpo.chave_idempotencia);
  const entrada = { corpo: { ...corpo, registado_em: corpo.registado_em || new Date().toISOString() }, tentativas: 0, erro: null, recusado: false };
  f.push(entrada);
  offlineGravarFila(f);
  return entrada;
}

const offlineErroDeRede = e => !!(e && (e.semRede || e.name === 'TypeError'));

/** Envia a fila, um a um, por ordem. Pára no primeiro erro de rede. Devolve { enviados, recusados }. */
async function offlineSincronizar() {
  if (_offEnviando || !NUK.token) return { enviados: 0, recusados: 0 };
  let f = offlineFila();
  const pendentes = f.filter(x => !x.recusado);
  if (!pendentes.length) { offlineIndicador(); return { enviados: 0, recusados: 0 }; }
  _offEnviando = true;
  let enviados = 0, recusados = 0;
  try {
    for (const entrada of pendentes) {
      try {
        await api('POST', '/pedidos', entrada.corpo);
        f = offlineFila().filter(x => x.corpo.chave_idempotencia !== entrada.corpo.chave_idempotencia);
        offlineGravarFila(f);
        enviados++;
      } catch (e) {
        if (offlineErroDeRede(e)) break; // continua sem ligação: tenta mais tarde
        f = offlineFila();
        const x = f.find(y => y.corpo.chave_idempotencia === entrada.corpo.chave_idempotencia);
        if (x) { x.tentativas++; x.erro = e.message; x.recusado = true; offlineGravarFila(f); }
        recusados++;
      }
    }
  } finally { _offEnviando = false; }
  if (enviados) toast(`${enviados} pedido(s) feitos sem internet enviados`, 'sucesso', 6000);
  if (recusados) toast(`${recusados} pedido(s) feitos sem internet foram recusados: veja ⚠ na barra de topo`, 'erro', 9000);
  offlineIndicador();
  return { enviados, recusados };
}

function offlineIndicador() {
  const el = document.getElementById('offline-estado');
  if (!el) return;
  const f = offlineFila();
  const recusados = f.filter(x => x.recusado).length, porEnviar = f.length - recusados;
  const semRede = typeof navigator !== 'undefined' && navigator.onLine === false;
  const partes = [];
  if (semRede) partes.push('📴 Sem ligação');
  if (porEnviar) partes.push(`⏳ ${porEnviar} por enviar`);
  if (recusados) partes.push(`⚠ ${recusados} recusado${recusados > 1 ? 's' : ''}`);
  el.textContent = partes.join(' · ');
  el.style.display = partes.length ? '' : 'none';
  el.style.color = recusados ? 'var(--c-danger)' : semRede ? '#f59e0b' : '';
}

function modalOffline() {
  const f = offlineFila();
  const desc = x => `${x.corpo.origem}${x.corpo.mesa_numero ? ' ' + x.corpo.mesa_numero : ''} · ${x.corpo.itens.reduce((a, i) => a + Number(i.quantidade), 0)} artigo(s) · ${new Date(x.corpo.registado_em).toLocaleTimeString('pt-PT', { timeZone: 'Africa/Luanda', hour: '2-digit', minute: '2-digit' })}`;
  abrirModal('Pedidos feitos sem internet', `
    ${f.length ? f.map((x, i) => `<div style="padding:.4rem 0;border-bottom:1px solid var(--c-border)">
      <div>${esc(desc(x))} ${x.recusado ? '<b style="color:var(--c-danger)">recusado</b>' : '<span class="muted">por enviar</span>'}</div>
      ${x.erro ? `<div class="muted texto-pequeno">${esc(x.erro)}</div>` : ''}
      ${x.recusado ? `<button class="btn-perigo" style="padding:.2rem .55rem;font-size:.75rem;margin-top:.25rem" data-on-click="pedirDescartarOffline(${i})">Descartar</button>` : ''}
    </div>`).join('') : '<p class="muted">Nada por enviar.</p>'}
    <button class="btn-primario btn-bloco" style="margin-top:.6rem" data-on-click="offlineSincronizarAgora()">Enviar agora</button>`);
}
async function offlineSincronizarAgora() {
  const r = await offlineSincronizar();
  if (!r.enviados && !r.recusados && offlineFila().some(x => !x.recusado)) toast('Ainda sem ligação ao servidor', 'erro');
  modalOffline();
}
function pedirDescartarOffline(i) {
  modalConfirmar('Descartar pedido', 'Este pedido foi recusado pelo servidor e <b>não será registado</b>. Descartar?', 'descartarOfflineConfirmado', i);
}
function descartarOfflineConfirmado(i) {
  const f = offlineFila();
  if (f[i] && f[i].recusado) { f.splice(i, 1); offlineGravarFila(f); }
  fecharModal();
  toast('Pedido descartado', 'sucesso');
}

function offlineArrancar() {
  offlineIndicador();
  if (_offTimer) clearInterval(_offTimer);
  _offTimer = setInterval(offlineSincronizar, 20000);
  offlineSincronizar();
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => { offlineIndicador(); offlineSincronizar(); });
  window.addEventListener('offline', offlineIndicador);
}
