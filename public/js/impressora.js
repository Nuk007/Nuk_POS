'use strict';
/**
 * Impressão directa em impressoras térmicas ESC/POS, a partir do navegador deste dispositivo.
 *  - Ligações: USB (WebUSB), porta série/USB-série (Web Serial) e Bluetooth (Web Bluetooth) — Chrome/Edge;
 *    sem nenhuma destas, usa o talão em PDF do servidor (impressão pelo navegador).
 *  - Configuração POR DISPOSITIVO (localStorage): ligação, largura do papel, acentos e o que este dispositivo imprime
 *    (recibos do Caixa + gaveta, talões da Cozinha, talões do Bar).
 *  - Talões de cozinha/bar: o dispositivo pede ao servidor os talões novos do seu posto (o servidor garante que cada um
 *    sai uma só vez) quando chega um pedido (socket) e a cada 15 s.
 * Sem handlers inline (CSP): data-on-click / data-on-change com argumentos literais.
 */
const IMP_CHAVE = 'nuk_impressora';
const IMP_PADRAO = { ligacao: 'NENHUMA', colunas: 48, acentos: 'CP860', recibos: true, gaveta: true, cozinha: false, bar: false };
const BT_SERVICOS = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455'];
let _impLigacao = null; // { tipo, enviar(bytes) }
let _impTimer = null;

function impConfig() {
  try { return { ...IMP_PADRAO, ...(JSON.parse(localStorage.getItem(IMP_CHAVE) || '{}')) }; } catch { return { ...IMP_PADRAO }; }
}
function impGuardar(c) { try { localStorage.setItem(IMP_CHAVE, JSON.stringify(c)); } catch { /* armazenamento indisponível: só nesta sessão */ } }

// ── Codificador ESC/POS ─────────────────────────────────────
// CP860 (Português) — os caracteres acentuados mais comuns; com acentos «SEM» tiram-se os acentos.
const CP860 = { 'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87, 'ê': 0x88, 'Ê': 0x89, 'è': 0x8A, 'Í': 0x8B, 'Ô': 0x8C, 'ì': 0x8D, 'Ã': 0x8E, 'Â': 0x8F,
  'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93, 'õ': 0x94, 'ò': 0x95, 'Ú': 0x96, 'ù': 0x97, 'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9A, 'Ù': 0x9D, 'Ó': 0x9F, 'á': 0xA0, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5, 'ª': 0xA6, 'º': 0xA7 };
function impTextoBytes(texto, acentos) {
  const out = [];
  for (const ch of String(texto)) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c < 127) { out.push(c); continue; }
    if (acentos === 'CP860' && CP860[ch] !== undefined) { out.push(CP860[ch]); continue; }
    const simples = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out.push(simples.length === 1 && simples.charCodeAt(0) < 127 ? simples.charCodeAt(0) : 0x3F); // ?
  }
  return out;
}
/** Documento do servidor ({ linhas, cortar, gaveta, colunas }) → bytes ESC/POS. */
function impCodificar(doc, cfg = impConfig()) {
  const b = [0x1B, 0x40]; // ESC @ — reinicia
  if (cfg.acentos === 'CP860') b.push(0x1B, 0x74, 3); // ESC t 3 — página de código CP860
  const w = doc.colunas || cfg.colunas || 48;
  for (const l of doc.linhas || []) {
    if (l.sep) { b.push(0x1B, 0x61, 0, ...impTextoBytes('-'.repeat(w), cfg.acentos), 0x0A); continue; }
    b.push(0x1B, 0x61, l.a === 'c' ? 1 : l.a === 'd' ? 2 : 0); // ESC a — alinhamento
    b.push(0x1B, 0x45, l.n ? 1 : 0);                          // ESC E — negrito
    b.push(0x1D, 0x21, l.g ? 0x11 : 0x00);                    // GS ! — tamanho duplo
    b.push(...impTextoBytes(l.t || '', cfg.acentos), 0x0A);
  }
  b.push(0x1B, 0x45, 0, 0x1D, 0x21, 0, 0x1B, 0x61, 0);
  b.push(0x1B, 0x64, 4); // avança 4 linhas
  if (doc.cortar) b.push(0x1D, 0x56, 0x42, 0x00); // GS V B — corte parcial
  if (doc.gaveta && cfg.gaveta) b.push(0x1B, 0x70, 0x00, 0x19, 0xFA); // ESC p — abre a gaveta
  return new Uint8Array(b);
}

// ── Ligações ────────────────────────────────────────────────
async function impLigarUSB(device) {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  let alvo = null;
  for (const itf of device.configuration.interfaces) {
    for (const alt of itf.alternates) {
      const ep = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
      if (ep && (!alvo || alt.interfaceClass === 7)) alvo = { itf: itf.interfaceNumber, ep: ep.endpointNumber };
    }
  }
  if (!alvo) throw new Error('Esta ligação USB não parece ser uma impressora');
  await device.claimInterface(alvo.itf);
  return { tipo: 'USB', nome: device.productName || 'Impressora USB', enviar: bytes => device.transferOut(alvo.ep, bytes) };
}
async function impLigarSerie(port) {
  if (!port.writable) await port.open({ baudRate: 9600 });
  return { tipo: 'SERIE', nome: 'Impressora (porta série)', enviar: async bytes => { const w = port.writable.getWriter(); try { await w.write(bytes); } finally { w.releaseLock(); } } };
}
async function impLigarBluetooth(device) {
  const gatt = await device.gatt.connect();
  let carac = null;
  for (const s of await gatt.getPrimaryServices()) {
    for (const c of await s.getCharacteristics()) { if (c.properties.write || c.properties.writeWithoutResponse) { carac = c; break; } }
    if (carac) break;
  }
  if (!carac) throw new Error('Não encontrei onde escrever nesta impressora Bluetooth');
  return {
    tipo: 'BLUETOOTH', nome: device.name || 'Impressora Bluetooth',
    enviar: async bytes => { for (let i = 0; i < bytes.length; i += 100) { const parte = bytes.slice(i, i + 100); await (carac.properties.writeWithoutResponse ? carac.writeValueWithoutResponse(parte) : carac.writeValue(parte)); } },
  };
}
/** Escolher a impressora (precisa de um toque do utilizador: o navegador mostra a lista). */
async function impEscolher(tipo) {
  try {
    if (tipo === 'USB') {
      if (!navigator.usb) throw new Error('Este navegador não suporta USB directo (use Chrome ou Edge)');
      _impLigacao = await impLigarUSB(await navigator.usb.requestDevice({ filters: [] }));
    } else if (tipo === 'SERIE') {
      if (!navigator.serial) throw new Error('Este navegador não suporta porta série (use Chrome ou Edge no computador)');
      _impLigacao = await impLigarSerie(await navigator.serial.requestPort());
    } else if (tipo === 'BLUETOOTH') {
      if (!navigator.bluetooth) throw new Error('Este navegador não suporta Bluetooth (use Chrome no Android ou no computador)');
      _impLigacao = await impLigarBluetooth(await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICOS }));
    }
    const c = impConfig(); c.ligacao = tipo; impGuardar(c);
    toast(`Impressora ligada: ${_impLigacao.nome}`, 'sucesso');
    modalImpressora();
  } catch (e) { if (e && e.name !== 'NotFoundError') toast(e.message || 'Não foi possível ligar a impressora', 'erro'); }
}
/** Volta a ligar sem perguntar (USB e série lembram a autorização; Bluetooth precisa de novo toque). */
async function impReligar() {
  const c = impConfig();
  if (_impLigacao) return _impLigacao;
  try {
    if (c.ligacao === 'USB' && navigator.usb) { const [d] = await navigator.usb.getDevices(); if (d) _impLigacao = await impLigarUSB(d); }
    if (c.ligacao === 'SERIE' && navigator.serial) { const [p] = await navigator.serial.getPorts(); if (p) _impLigacao = await impLigarSerie(p); }
  } catch { _impLigacao = null; }
  return _impLigacao;
}
async function impEnviar(doc) {
  const lig = await impReligar();
  if (!lig) throw new Error('Impressora não ligada. Toque em 🖨️ para a ligar.');
  try { await lig.enviar(impCodificar(doc)); }
  catch (e) { _impLigacao = null; throw new Error('A impressora não respondeu: ' + (e.message || e)); }
}

// ── Recibos do Caixa ────────────────────────────────────────
async function imprimirRecibo(pedidoIds, { manual = false } = {}) {
  const c = impConfig();
  if (!manual && !c.recibos) return;
  try {
    if (c.ligacao === 'NENHUMA') {
      if (manual && pedidoIds.length === 1 && typeof descarregarPdf === 'function') descarregarPdf(`/pedidos/${pedidoIds[0]}/talao.pdf`, `talao-${String(pedidoIds[0]).slice(0, 8)}.pdf`);
      return;
    }
    const doc = await api('POST', '/impressao/recibo', { pedido_ids: pedidoIds, colunas: c.colunas });
    await impEnviar(doc);
  } catch (e) { toast(e.message, 'erro'); }
}

// ── Talões de cozinha/bar automáticos ───────────────────────
let _impOcupado = false;
async function impVerificarPreparacao() {
  const c = impConfig();
  if (_impOcupado || c.ligacao === 'NENHUMA' || (!c.cozinha && !c.bar)) return;
  _impOcupado = true;
  try {
    for (const posto of [c.cozinha && 'COZINHA', c.bar && 'BAR'].filter(Boolean)) {
      const docs = await api('POST', '/impressao/preparacao/reclamar', { posto, colunas: c.colunas }) || [];
      for (const d of docs) await impEnviar(d);
    }
  } catch (e) { toast(e.message, 'erro', 6000); }
  finally { _impOcupado = false; }
}
function impArrancar() {
  const c = impConfig();
  const b = document.getElementById('btn-impressora');
  if (b) { b.style.display = ''; b.textContent = c.ligacao === 'NENHUMA' ? '🖨️' : `🖨️ ${c.cozinha || c.bar ? [c.cozinha && 'Cozinha', c.bar && 'Bar'].filter(Boolean).join('+') : 'Caixa'}`; }
  if (_impTimer) { clearInterval(_impTimer); _impTimer = null; }
  if (c.ligacao !== 'NENHUMA' && (c.cozinha || c.bar)) {
    _impTimer = setInterval(impVerificarPreparacao, 15000);
    impVerificarPreparacao();
  }
}

// ── Configuração deste dispositivo ──────────────────────────
function modalImpressora() {
  const c = impConfig();
  const ligada = _impLigacao ? `<b style="color:var(--c-success)">Ligada: ${esc(_impLigacao.nome)}</b>` : c.ligacao === 'NENHUMA' ? 'Sem impressora directa (usa o PDF)' : `<span style="color:#f59e0b">${{ USB: 'USB', SERIE: 'Porta série', BLUETOOTH: 'Bluetooth' }[c.ligacao]}: por ligar — toque em «Ligar» abaixo</span>`;
  const sup = { USB: !!navigator.usb, SERIE: !!navigator.serial, BLUETOOTH: !!navigator.bluetooth };
  abrirModal('🖨️ Impressora deste dispositivo', `
    <p style="margin-bottom:.6rem">${ligada}</p>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.8rem">
      ${['USB', 'SERIE', 'BLUETOOTH'].map(t => `<button class="btn-secundario" ${sup[t] ? '' : 'disabled title="Não suportado neste navegador"'} data-on-click="impEscolher('${t}')">Ligar por ${{ USB: 'USB', SERIE: 'porta série', BLUETOOTH: 'Bluetooth' }[t]}</button>`).join('')}
      ${c.ligacao !== 'NENHUMA' ? '<button class="btn-secundario" data-on-click="impDesligar()">Deixar de usar</button>' : ''}
    </div>
    <div class="campo"><label>Largura do papel</label><select id="imp-colunas">${[[32, '58 mm (32 colunas)'], [42, '80 mm (42 colunas)'], [48, '80 mm (48 colunas)']].map(([v, r]) => `<option value="${v}" ${Number(c.colunas) === v ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    <div class="campo"><label>Acentos</label><select id="imp-acentos"><option value="CP860" ${c.acentos === 'CP860' ? 'selected' : ''}>Português (CP860)</option><option value="SEM" ${c.acentos === 'SEM' ? 'selected' : ''}>Sem acentos (se aparecerem caracteres estranhos)</option></select></div>
    <div class="campo"><label class="negrito">Este dispositivo imprime</label>
      <label style="display:block;font-weight:normal"><input type="checkbox" id="imp-recibos" ${c.recibos ? 'checked' : ''}> Recibos do Caixa (ao receber)</label>
      <label style="display:block;font-weight:normal"><input type="checkbox" id="imp-gaveta" ${c.gaveta ? 'checked' : ''}> Abrir a gaveta quando há dinheiro</label>
      <label style="display:block;font-weight:normal"><input type="checkbox" id="imp-cozinha" ${c.cozinha ? 'checked' : ''}> Talões da Cozinha (automático)</label>
      <label style="display:block;font-weight:normal"><input type="checkbox" id="imp-bar" ${c.bar ? 'checked' : ''}> Talões do Bar (automático)</label>
    </div>
    <div style="display:flex;gap:.5rem">
      <button class="btn-primario" style="flex:2" data-on-click="impGuardarModal()">Guardar</button>
      <button class="btn-secundario" style="flex:1" data-on-click="impTeste()">Imprimir teste</button>
    </div>
    <p class="muted texto-pequeno" style="margin-top:.6rem">Funciona no Chrome ou Edge. Impressoras de rede (Wi-Fi/cabo) precisam de um pequeno programa local — fale connosco.</p>`);
}
function impGuardarModal() {
  const c = impConfig();
  c.colunas = parseInt(document.getElementById('imp-colunas').value, 10) || 48;
  c.acentos = document.getElementById('imp-acentos').value;
  ['recibos', 'gaveta', 'cozinha', 'bar'].forEach(k => { c[k] = !!document.getElementById(`imp-${k}`).checked; });
  impGuardar(c);
  fecharModal();
  toast('Impressora configurada neste dispositivo', 'sucesso');
  impArrancar();
}
function impDesligar() { const c = impConfig(); c.ligacao = 'NENHUMA'; impGuardar(c); _impLigacao = null; impArrancar(); modalImpressora(); }
async function impTeste() {
  const c = impConfig();
  const w = c.colunas;
  try {
    await impEnviar({ colunas: w, cortar: true, gaveta: false, linhas: [
      { t: 'Nuk_POS', a: 'c', n: true, g: true }, { t: 'Teste de impressão', a: 'c' }, { sep: true },
      { t: 'Acentos: ação, pão, café, Açúcar' }, { t: `Largura: ${w} colunas` }, { t: '1234567890'.repeat(5).slice(0, w) }, { sep: true },
      { t: new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' }), a: 'c' }] });
    toast('Teste enviado', 'sucesso');
  } catch (e) { toast(e.message, 'erro'); }
}
