'use strict';
/**
 * Balança e venda ao peso (21/11/2026, pedido do dono: funções do WinREST que faltavam).
 *  - Produto «vendido ao peso»: o preço é por kg; ao tocar no botão abre-se o modal do peso.
 *  - O peso escreve-se à mão ou lê-se da balança ligada por porta série/USB-série (Web Serial, Chrome/Edge).
 *    As balanças de balcão mandam o peso em texto (ex.: «ST,GS,+  0.355kg», «  355 g», «W 0,355»): lê-se o último
 *    número da leitura, em kg ou g; leituras marcadas como instáveis (US/«?») são ignoradas.
 *  - Configuração POR DISPOSITIVO (localStorage `nuk_balanca`): velocidade e o pedido a enviar (nenhum = a balança
 *    envia sozinha; «P», «W» ou ENQ para as que só respondem a pedido). É configuração do aparelho, não do negócio.
 * O servidor volta a validar o peso (até 999,999 kg, ao grama).
 */
const BAL_CHAVE = 'nuk_balanca';
const BAL_PEDIDOS = { NENHUM: '', P: 'P', W: 'W', ENQ: '\x05', S: 'S\r\n' };
let _balPorta = null;

function balConfig() {
  try { return { baud: 9600, pedido: 'NENHUM', ...(JSON.parse(localStorage.getItem(BAL_CHAVE) || '{}')) }; }
  catch { return { baud: 9600, pedido: 'NENHUM' }; }
}
function balGuardarConfig(c) { try { localStorage.setItem(BAL_CHAVE, JSON.stringify(c)); } catch { /* sem armazenamento */ } }
const balSuportada = () => typeof navigator !== 'undefined' && !!navigator.serial;

/**
 * Peso em kg a partir do texto da balança, ou null se não houver leitura estável.
 * Usa a última linha completa com um número; «g» converte para kg; sem unidade, um número inteiro grande (> 50) é gramas.
 */
function balInterpretar(texto) {
  const linhas = String(texto || '').split(/[\r\n\x02\x03]+/).map(l => l.trim()).filter(Boolean);
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = linhas[i];
    if (/\bUS\b|\?|instav/i.test(l)) continue; // instável
    const m = l.match(/([-+]?\s*\d+(?:[.,]\d+)?)\s*(kg|g)?\s*$/i) || l.match(/([-+]?\s*\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
    if (!m) continue;
    let n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    const u = (m[2] || '').toLowerCase();
    if (u === 'g' || (!u && Number.isInteger(n) && n > 50 && !/[.,]/.test(m[1]))) n = n / 1000;
    if (n <= 0) return null;
    return Math.round(n * 1000) / 1000;
  }
  return null;
}

async function balAbrirPorta(pedirNova) {
  if (!balSuportada()) throw new Error('Este navegador não liga a balanças. Use o Chrome ou o Edge num computador, ou escreva o peso.');
  const c = balConfig();
  if (!_balPorta) {
    const autorizadas = await navigator.serial.getPorts();
    _balPorta = autorizadas[0] || null;
  }
  if (!_balPorta || pedirNova) _balPorta = await navigator.serial.requestPort();
  if (!_balPorta.readable) await _balPorta.open({ baudRate: Number(c.baud) || 9600 });
  return _balPorta;
}

/** Lê o peso (kg) da balança: envia o pedido configurado e lê até 2 s. */
async function balLerPeso() {
  const porta = await balAbrirPorta(false);
  const c = balConfig();
  const pedido = BAL_PEDIDOS[c.pedido] || '';
  if (pedido && porta.writable) {
    const w = porta.writable.getWriter();
    try { await w.write(new TextEncoder().encode(pedido)); } finally { w.releaseLock(); }
  }
  const leitor = porta.readable.getReader();
  const dec = new TextDecoder();
  let texto = '';
  const limite = Date.now() + 2000;
  try {
    while (Date.now() < limite) {
      const r = await Promise.race([leitor.read(), new Promise(res => setTimeout(() => res({ timeout: true }), limite - Date.now()))]);
      if (r.timeout || r.done) break;
      texto += dec.decode(r.value, { stream: true });
      const kg = /[\r\n\x03]/.test(texto) ? balInterpretar(texto) : null;
      if (kg) return kg;
    }
  } finally {
    try { await leitor.cancel(); } catch { /* já fechado */ }
    leitor.releaseLock();
  }
  const kg = balInterpretar(texto);
  if (!kg) throw new Error('A balança não deu um peso estável. Espere que estabilize e tente outra vez, ou escreva o peso.');
  return kg;
}

// ── Modal do peso no painel de venda ─────────────────────────
function pesoPedir(i, linhaCarrinho) {
  const v = window._venda; const p = v && v.produtos[i]; if (!p) return;
  const actual = linhaCarrinho !== undefined ? v.carrinho[linhaCarrinho] : null;
  window._pesoSel = { i, linha: linhaCarrinho };
  abrirModal(`⚖️ ${p.nome}`, `
    <p class="muted mb-2">Preço por kg: <b>${formatarMoeda(p.preco)}</b></p>
    <div class="campo"><label>Peso (kg)</label><input type="number" id="peso-kg" min="0.001" max="999.999" step="0.001" inputmode="decimal" value="${actual ? actual.quantidade : ''}" placeholder="Ex.: 0,355" data-on-input="pesoActualizar()"></div>
    <div id="peso-valor" class="venda-total" style="margin-bottom:.75rem"></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      ${balSuportada() ? '<button class="btn-secundario" style="flex:1" data-on-click="pesoLerBalanca()">⚖️ Ler da balança</button>' : ''}
      <button class="btn-primario" style="flex:1" data-on-click="pesoConfirmar()">${actual ? 'Actualizar' : 'Adicionar'}</button>
    </div>
    ${balSuportada() ? '<p class="muted texto-pequeno" style="margin-top:.6rem">Primeira vez neste computador? <button type="button" class="sem-relevo" style="background:none;border:0;padding:0;color:var(--c-primary,#E8650A);text-decoration:underline;cursor:pointer" data-on-click="modalBalanca()">Configurar a balança</button>.</p>' : ''}`);
  pesoActualizar();
  setTimeout(() => document.getElementById('peso-kg')?.focus(), 50);
}
function pesoActualizar() {
  const sel = window._pesoSel, v = window._venda; if (!sel || !v) return;
  const p = v.produtos[sel.i]; const kg = Number(document.getElementById('peso-kg')?.value);
  const el = document.getElementById('peso-valor');
  if (el) el.textContent = kg > 0 ? `${fmtQtd(kg)} × ${formatarMoeda(p.preco)} = ${formatarMoeda(Math.round(kg * Number(p.preco) * 100) / 100)}` : '';
}
async function pesoLerBalanca() {
  try {
    const kg = await balLerPeso();
    const inp = document.getElementById('peso-kg'); if (inp) inp.value = kg;
    pesoActualizar();
  } catch (e) { toast(e.message, 'erro', 6000); }
}
function pesoConfirmar() {
  const sel = window._pesoSel, v = window._venda; if (!sel || !v) return;
  const p = v.produtos[sel.i];
  const kg = Math.round(Number(document.getElementById('peso-kg')?.value) * 1000) / 1000;
  if (!(kg > 0) || kg > 999.999) { toast('Indique o peso em kg (ex.: 0,355)', 'erro'); return; }
  if (sel.linha !== undefined && v.carrinho[sel.linha]) v.carrinho[sel.linha].quantidade = kg;
  else v.carrinho.push({ produto_id: p.id, nome: p.nome, preco: parseFloat(p.preco), quantidade: kg, ao_peso: true });
  window._pesoSel = null;
  fecharModal();
  vendaRender();
}

// ── Configuração da balança deste dispositivo ───────────────
function modalBalanca() {
  const c = balConfig();
  abrirModal('⚖️ Balança deste dispositivo', `
    <p class="muted texto-pequeno mb-2">Balança ligada por cabo série ou USB-série a este computador (Chrome ou Edge). Veja no manual da balança a velocidade e se ela manda o peso sozinha ou só quando se pede.</p>
    <div class="campo"><label>Velocidade (baud)</label><select id="bal-baud">${[2400, 4800, 9600, 19200, 38400].map(b => `<option value="${b}"${Number(c.baud) === b ? ' selected' : ''}>${b}</option>`).join('')}</select></div>
    <div class="campo"><label>Pedido de peso</label><select id="bal-pedido">
      ${[['NENHUM', 'Nenhum (a balança envia sozinha)'], ['P', '«P»'], ['W', '«W»'], ['ENQ', 'ENQ (05h)'], ['S', '«S» + Enter']].map(([k, n]) => `<option value="${k}"${c.pedido === k ? ' selected' : ''}>${n}</option>`).join('')}
    </select></div>
    <div style="display:flex;gap:.5rem">
      <button class="btn-secundario" style="flex:1" data-on-click="balEscolherPorta()">Escolher a porta</button>
      <button class="btn-primario" style="flex:1" data-on-click="balTestar()">Guardar e testar</button>
    </div>
    <div id="bal-resultado" class="muted" style="margin-top:.6rem"></div>`);
}
function balGuardarDoModal() {
  balGuardarConfig({ baud: Number(document.getElementById('bal-baud')?.value) || 9600, pedido: document.getElementById('bal-pedido')?.value || 'NENHUM' });
}
async function balEscolherPorta() {
  try {
    balGuardarDoModal();
    if (_balPorta && _balPorta.readable) { try { await _balPorta.close(); } catch { /* já fechada */ } }
    _balPorta = null;
    await balAbrirPorta(true);
    toast('Balança escolhida', 'sucesso');
  } catch (e) { toast(e.message, 'erro', 6000); }
}
async function balTestar() {
  balGuardarDoModal();
  const el = document.getElementById('bal-resultado');
  try { const kg = await balLerPeso(); if (el) el.innerHTML = `<b style="color:var(--c-success)">Peso lido: ${fmtQtd(kg)}</b>`; }
  catch (e) { if (el) el.textContent = e.message; }
}
