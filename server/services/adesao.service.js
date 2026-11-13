'use strict';
/**
 * Contrato de Adesão à Plataforma Nuk_POS da GESTNUK AI (decisão do dono de 13/11/2026).
 *
 * - Assina-o o administrador TITULAR do estabelecimento (`funcionarios.titular`), escrevendo o nome completo
 *   (num estabelecimento antigo sem titular, qualquer ADMIN activo, para nunca ficar bloqueado sem saída),
 *   depois de entrar com a sua palavra-passe (assinatura electrónica com convenção de prova, DLP n.º 14/26).
 * - Fica gravado o texto apresentado, o nome escrito, a data, o dispositivo, o endereço de rede e a impressão
 *   digital SHA-256 (texto + nome + data + estabelecimento). Assinado, não se repete nem se altera (409).
 * - Sem a versão em vigor assinada, `verificarLicencaTenant` responde 428 a toda a operação.
 */
const PDFDocument = require('pdfkit');
const { pool } = require('../db');
const { erro, withTx } = require('./shared');
const { ADESAO_VERSAO, TITULAR, PLATAFORMA, textoAdesao, hashTexto, hashAssinatura } = require('./adesao-texto');

async function dados(q, tenantId) {
  const t = (await q.query(`SELECT id, nome, nif, telefone_whatsapp FROM tenants WHERE id = $1`, [tenantId])).rows[0];
  if (!t) throw erro(404, 'Estabelecimento não encontrado');
  const cfg = await q.query(`SELECT chave, valor FROM configuracoes WHERE tenant_id = $1 AND chave IN ('nome_estabelecimento','nif_empresa','telefone')`, [tenantId]);
  const c = Object.fromEntries(cfg.rows.map(x => [x.chave, x.valor]));
  const titular = (await q.query(
    `SELECT id, nome, email FROM funcionarios WHERE tenant_id = $1 AND ativo AND (titular OR nivel_acesso = 'ADMIN')
      ORDER BY titular DESC, criado_em LIMIT 1`, [tenantId])).rows[0] || null;
  const licenca = (await q.query(
    `SELECT l.inicio, l.fim, p.nome AS plano_nome, p.preco_mensal
       FROM licencas l LEFT JOIN planos_assinatura p ON p.id = l.plano_id
      WHERE l.tenant_id = $1 AND l.estado = 'ACTIVA' ORDER BY l.fim DESC LIMIT 1`, [tenantId])).rows[0] || null;
  return {
    tenant: { nome: c.nome_estabelecimento || t.nome, nif: c.nif_empresa || t.nif, telefone: c.telefone || t.telefone_whatsapp },
    titular, licenca,
  };
}

async function assinada(tenantId) {
  return (await pool.query(
    `SELECT a.versao, a.nome_escrito, a.assinado_em, a.hash, a.texto_hash, f.nome AS assinado_por
       FROM adesoes_plataforma a LEFT JOIN funcionarios f ON f.id = a.assinado_por
      WHERE a.tenant_id = $1 AND a.versao = $2`, [tenantId, ADESAO_VERSAO])).rows[0] || null;
}

// Pode assinar: o titular; se o estabelecimento não tiver titular activo (contas antigas), um ADMIN activo.
const SQL_PODE_ASSINAR = `SELECT 1 FROM funcionarios f WHERE f.id = $1 AND f.tenant_id = $2 AND f.ativo
   AND (f.titular OR (f.nivel_acesso = 'ADMIN' AND NOT EXISTS (SELECT 1 FROM funcionarios t WHERE t.tenant_id = $2 AND t.titular AND t.ativo)))`;

async function eTitular(tenantId, userId) {
  if (!userId) return false;
  return !!(await pool.query(SQL_PODE_ASSINAR, [userId, tenantId])).rows[0];
}

/** Estado para o ecrã: pendente, quem pode assinar e o texto exacto que fica gravado. */
async function estado({ tenantId, userId }) {
  if (!tenantId) throw erro(400, 'Esta conta não pertence a um estabelecimento');
  const a = await assinada(tenantId);
  let texto;
  if (a) {
    texto = (await pool.query(`SELECT texto FROM adesoes_plataforma WHERE tenant_id = $1 AND versao = $2`, [tenantId, ADESAO_VERSAO])).rows[0].texto.split('\n\n');
  } else {
    const d = await dados(pool, tenantId);
    texto = d.titular ? textoAdesao(d) : null;
  }
  return { versao: ADESAO_VERSAO, titular: TITULAR, plataforma: PLATAFORMA, pendente: !a, assinada: a, pode_assinar: !a && await eTitular(tenantId, userId), texto };
}

async function assinar({ tenantId, userId, nome, aceito, ip, dispositivo }) {
  if (!tenantId) throw erro(400, 'Esta conta não pertence a um estabelecimento');
  const n = String(nome || '').trim().replace(/\s+/g, ' ');
  if (n.length < 5 || n.length > 160 || !n.includes(' ') || aceito !== true) {
    throw erro(400, 'Escreva o seu nome completo e confirme que leu e aceita o contrato.');
  }
  return withTx(async (c) => {
    await c.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    const tit = (await c.query(SQL_PODE_ASSINAR, [userId, tenantId])).rows[0];
    if (!tit) throw erro(403, 'Só o administrador titular do estabelecimento assina o Contrato de Adesão.');
    const ja = (await c.query(`SELECT 1 FROM adesoes_plataforma WHERE tenant_id = $1 AND versao = $2`, [tenantId, ADESAO_VERSAO])).rows[0];
    if (ja) throw erro(409, 'O Contrato de Adesão desta versão já está assinado.');
    const par = textoAdesao(await dados(c, tenantId));
    const texto = par.join('\n\n');
    const quando = new Date();
    const hash = hashAssinatura(texto, n, quando.toISOString(), tenantId);
    await c.query(
      `INSERT INTO adesoes_plataforma (tenant_id, versao, texto, texto_hash, assinado_por, nome_escrito, assinado_em, ip, dispositivo, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tenantId, ADESAO_VERSAO, texto, hashTexto(par), userId, n, quando, String(ip || '').slice(0, 60), String(dispositivo || '').slice(0, 200), hash]);
    return { versao: ADESAO_VERSAO, nome_escrito: n, assinado_em: quando, hash };
  });
}

const NAVY = '#1F3864', LARANJA = '#E8650A', CINZA = '#6b7280';
const dataLuanda = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** PDF A4 do contrato assinado (para guardar ou imprimir). */
async function pdf({ tenantId }) {
  const a = (await pool.query(
    `SELECT a.*, f.nome AS conta FROM adesoes_plataforma a LEFT JOIN funcionarios f ON f.id = a.assinado_por
      WHERE a.tenant_id = $1 AND a.versao = $2`, [tenantId, ADESAO_VERSAO])).rows[0];
  if (!a) throw erro(409, 'O Contrato de Adesão ainda não foi assinado.');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 56, right: 56 }, info: { Title: `Contrato de Adesão ${PLATAFORMA}`, Author: TITULAR } });
  const fim = new Promise((ok, falha) => { const b = []; doc.on('data', x => b.push(x)); doc.on('end', () => ok(Buffer.concat(b))); doc.on('error', falha); });
  const L = doc.page.width - 112;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(TITULAR, 56, 50);
  doc.fillColor(CINZA).font('Helvetica').fontSize(9).text(`Contrato de Adesão à Plataforma ${PLATAFORMA}`);
  doc.moveTo(56, doc.y + 6).lineTo(56 + L, doc.y + 6).lineWidth(2).strokeColor(LARANJA).stroke();
  doc.moveDown(1.2);
  a.texto.split('\n\n').forEach((p, i) => {
    if (i === 0) { doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11.5).text(p, { width: L }); doc.moveDown(0.6); return; }
    const m = p.match(/^((?:Cláusula \d+\.ª — [^.]+\.)|(?:ANEXO [IV]+ — [^.]+\.)|(?:\d+\. [^.]+\.))(.*)$/s);
    doc.fillColor('#111').fontSize(9.5);
    if (m) { doc.font('Helvetica-Bold').text(m[1] + ' ', { width: L, align: 'justify', continued: true }).font('Helvetica').text(m[2].trimStart()); }
    else doc.font('Helvetica').text(p, { width: L, align: 'justify' });
    doc.moveDown(0.45);
  });
  doc.moveDown(0.6);
  const y = doc.y;
  if (y > doc.page.height - 170) doc.addPage();
  doc.rect(56, doc.y, L, 74).fill('#FCE4D6');
  const y0 = doc.y + 10;
  doc.fillColor(LARANJA).font('Helvetica-Bold').fontSize(10.5).text('Assinatura electrónica do Aderente', 66, y0);
  doc.fillColor('#111').font('Helvetica').fontSize(9)
    .text(`Assinado por ${a.nome_escrito} (conta de ${a.conta || '—'}) em ${dataLuanda(a.assinado_em)} (Luanda).`, 66, y0 + 16, { width: L - 20 })
    .text(`Dispositivo: ${a.dispositivo || '—'} · Endereço de rede: ${a.ip || '—'}`, { width: L - 20 })
    .text(`Impressão digital (SHA-256): ${a.hash}`, { width: L - 20 });
  doc.moveDown(2);
  doc.fillColor(CINZA).fontSize(7.5).text(`Documento gerado na Plataforma ${PLATAFORMA} · ${TITULAR} · versão ${a.versao} · impressão digital do texto ${a.texto_hash}`, 56, doc.y, { width: L });
  doc.end();
  return fim;
}

module.exports = { estado, assinar, pdf };
