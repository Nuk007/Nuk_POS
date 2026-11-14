'use strict';
/**
 * WhatsApp — envio oficial pela Meta Cloud API (número da plataforma GESTNUK AI) com alternativa wa.me.
 *
 * Configuração no Render (sem ela tudo funciona pela alternativa wa.me: o ecrã abre o WhatsApp com o texto pronto):
 *   WHATSAPP_TOKEN     token permanente de utilizador de sistema (Meta Business)
 *   WHATSAPP_PHONE_ID  identificador do número de envio (WhatsApp Manager → API)
 *   WHATSAPP_API_VERSAO  opcional, por omissão v21.0
 * Mensagens iniciadas pela empresa fora da janela de 24 h só passam com modelos (templates) aprovados pela Meta;
 * por isso o resumo diário usa um modelo (ver TEMPLATES) e nunca texto livre.
 * Cada envio fica em `mensagens_whatsapp` (para quem, finalidade, estado, erro) — nunca o token.
 */
const { pool } = require('../db');
const { erro } = require('./shared');
const { logger } = require('../monitoring');

/** Modelos a criar e aprovar no WhatsApp Manager (categoria «Utility», idioma pt_PT). */
const TEMPLATES = {
  resumo_diario: {
    nome: process.env.WHATSAPP_TEMPLATE_RESUMO || 'resumo_diario_nukpos',
    idioma: process.env.WHATSAPP_TEMPLATE_IDIOMA || 'pt_PT',
    // Texto a submeter à Meta (os parâmetros não podem ter mudanças de linha):
    texto: 'Resumo de {{1}} — {{2}}\nReceita: {{3}}\nPedidos: {{4}} (ticket médio {{5}})\nDespesas: {{6}}\nResultado: {{7}}\nAtenção: {{8}}\nNuk_POS · GESTNUK AI',
  },
};

const configurado = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

/** Número angolano para o formato internacional sem «+»: 9XXXXXXXX, +244 9XX XXX XXX, 00244… → 2449XXXXXXXX. */
function normalizar(tel) {
  const d = String(tel == null ? '' : tel).replace(/[\s()-]/g, '').replace(/^\+/, '').replace(/^00/, '');
  const local = d.startsWith('244') ? d.slice(3) : d;
  if (!/^9\d{8}$/.test(local)) return null;
  return '244' + local;
}

/** Ligação wa.me com o texto pronto (alternativa sem API: o funcionário toca e envia do seu WhatsApp). */
function linkWaMe(tel, texto) {
  const n = normalizar(tel);
  return `https://wa.me/${n || ''}?text=${encodeURIComponent(String(texto || '').slice(0, 3000))}`;
}

/** Parâmetro de modelo: sem mudanças de linha, tabulações nem 4+ espaços seguidos (regra da Meta); máx. 200. */
const limparParam = v => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim().slice(0, 200) || '—';

async function registar({ tenantId, para, tipo, template, finalidade, estado, metaId, motivo }) {
  try {
    await pool.query(
      `INSERT INTO mensagens_whatsapp (tenant_id, para, tipo, template, finalidade, estado, meta_id, erro) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId || null, para, tipo, template || null, finalidade, estado, metaId || null, motivo ? String(motivo).slice(0, 300) : null]);
  } catch (e) { logger.warn({ err: e }, 'Registo de mensagem WhatsApp falhou'); }
}

async function chamarMeta(corpo) {
  const versao = process.env.WHATSAPP_API_VERSAO || 'v21.0';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`https://graph.facebook.com/${versao}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw erro(502, `WhatsApp recusou o envio: ${(j.error && j.error.message) || `HTTP ${r.status}`}`);
    return (j.messages && j.messages[0] && j.messages[0].id) || null;
  } catch (e) {
    if (e.statusCode) throw e;
    throw erro(502, e.name === 'AbortError' ? 'WhatsApp não respondeu a tempo' : `Falha a contactar o WhatsApp: ${e.message}`);
  } finally { clearTimeout(t); }
}

/**
 * Envia um modelo aprovado. Devolve { enviado: true, id } ou lança 400 (número inválido), 409 (API por configurar)
 * ou 502 (a Meta recusou ou não respondeu). Regista sempre o resultado.
 */
async function enviarTemplate({ tenantId, para, chave, parametros, finalidade }) {
  const tpl = TEMPLATES[chave];
  if (!tpl) throw erro(400, 'Modelo de mensagem desconhecido');
  const numero = normalizar(para);
  if (!numero) throw erro(400, 'Número de WhatsApp inválido (9XXXXXXXX)');
  if (!configurado()) throw erro(409, 'O envio oficial do WhatsApp ainda não está configurado', { codigo: 'WHATSAPP_POR_CONFIGURAR' });
  try {
    const id = await chamarMeta({
      to: numero, type: 'template',
      template: { name: tpl.nome, language: { code: tpl.idioma }, components: [{ type: 'body', parameters: parametros.map(p => ({ type: 'text', text: limparParam(p) })) }] },
    });
    await registar({ tenantId, para: numero, tipo: 'TEMPLATE', template: tpl.nome, finalidade, estado: 'ENVIADA', metaId: id });
    return { enviado: true, id };
  } catch (e) {
    await registar({ tenantId, para: numero, tipo: 'TEMPLATE', template: tpl.nome, finalidade, estado: 'FALHOU', motivo: e.message });
    throw e;
  }
}

module.exports = { configurado, normalizar, linkWaMe, enviarTemplate, limparParam, TEMPLATES };
