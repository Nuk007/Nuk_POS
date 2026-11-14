#!/usr/bin/env node
'use strict';
/**
 * Agente local de impressão do Nuk_POS (GESTNUK AI).
 *
 * Corre num computador ligado à mesma rede das impressoras térmicas Wi-Fi/cabo. De 3 em 3 segundos pergunta ao
 * Nuk_POS se há talões ou recibos para imprimir e envia-os por TCP para a impressora (IP:9100, ESC/POS).
 * Sem dependências: só precisa do Node.js 18 ou mais recente.
 *
 *   NUKPOS_TOKEN=nka_xxx node agente.js
 *   node agente.js --token nka_xxx [--url https://nukpos.onrender.com]
 *
 * O token cria-se em Nuk_POS → Configurações → Impressão em rede (aparece uma só vez).
 */
const net = require('net');

const arg = nome => { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : undefined; };
const CONFIG = {
  url: (arg('url') || process.env.NUKPOS_URL || 'https://nukpos.onrender.com').replace(/\/+$/, ''),
  token: arg('token') || process.env.NUKPOS_TOKEN || '',
  intervaloMs: 3000,
  tempoLimiteMs: 8000,
};

/** Só impressoras da rede local e portas 9100–9109 (o servidor também confirma). */
function destino(impressora) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{4})$/.exec(String(impressora));
  if (!m) return null;
  const o = m.slice(1, 5).map(Number), porta = Number(m[5]);
  const privado = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
  if (!privado || o.some(x => x > 255) || porta < 9100 || porta > 9109) return null;
  return { host: o.join('.'), port: porta };
}

/** Envia os bytes por TCP e resolve quando a impressora fecha a ligação (ou o envio termina). */
function enviarTcp({ host, port }, bytes, tempoLimiteMs = CONFIG.tempoLimiteMs) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port });
    let feito = false;
    const fim = (e) => { if (feito) return; feito = true; s.destroy(); e ? reject(e) : resolve(); };
    s.setTimeout(tempoLimiteMs, () => fim(new Error(`a impressora ${host}:${port} não respondeu`)));
    s.on('error', e => fim(new Error(`${host}:${port} — ${e.code || e.message}`)));
    s.on('connect', () => s.end(bytes, () => setTimeout(() => fim(), 300)));
  });
}

async function chamar(caminho, { method = 'GET', body } = {}) {
  const r = await fetch(CONFIG.url + caminho, {
    method,
    headers: { 'X-Agente-Token': CONFIG.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.erro || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}

/** Uma volta: reclama os trabalhos, imprime cada um e comunica o resultado. Devolve quantos tratou. */
async function volta({ chamarApi = chamar, enviar = enviarTcp, log = console.log } = {}) {
  const { trabalhos = [] } = await chamarApi('/api/agente-impressao/trabalhos');
  for (const t of trabalhos) {
    const d = destino(t.impressora);
    try {
      if (!d) throw new Error(`impressora não permitida: ${t.impressora}`);
      await enviar(d, Buffer.from(t.dados, 'base64'));
      await chamarApi(`/api/agente-impressao/trabalhos/${t.id}`, { method: 'POST', body: { ok: true } });
      log(`✓ impresso em ${t.impressora}`);
    } catch (e) {
      log(`✗ ${e.message}`);
      await chamarApi(`/api/agente-impressao/trabalhos/${t.id}`, { method: 'POST', body: { ok: false, erro: e.message } }).catch(() => {});
    }
  }
  return trabalhos.length;
}

async function principal() {
  if (!/^nka_/.test(CONFIG.token)) {
    console.error('Falta o token do agente. Crie-o em Nuk_POS → Configurações → Impressão em rede e corra:\n  node agente.js --token nka_...');
    process.exit(1);
  }
  console.log(`Agente de impressão Nuk_POS ligado a ${CONFIG.url}. Ctrl+C para parar.`);
  let espera = CONFIG.intervaloMs;
  for (;;) {
    try { await volta(); espera = CONFIG.intervaloMs; }
    catch (e) {
      if (e.status === 401) { console.error('Token inválido ou revogado. Crie um novo em Configurações.'); process.exit(2); }
      console.error(`Sem ligação ao Nuk_POS (${e.message}). Nova tentativa em ${Math.round(espera / 1000)} s.`);
      espera = Math.min(espera * 2, 30000);
    }
    await new Promise(r => setTimeout(r, espera));
  }
}

if (require.main === module) principal();
module.exports = { destino, enviarTcp, volta, CONFIG };
