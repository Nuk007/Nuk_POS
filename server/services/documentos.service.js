'use strict';
/**
 * Documentos imprimíveis (PDF): talão de pedido (80 mm, impressora térmica) e factura (A4).
 * Lógica de negócio fora das rotas. Sem estado: gera um Buffer.
 *
 * Validade fiscal: enquanto o Nuk_POS não estiver certificado pela AGT (AGT_CERTIFICADO != 'true'),
 * todos os documentos levam a menção «Documento sem validade fiscal».
 */
const path = require('path');
const PDFDocument = require('pdfkit');
const { pool } = require('../db');
const { erro } = require('./shared');

const LOGO = path.join(__dirname, '..', '..', 'public', 'img', 'logo-nukpos.png');
const LOGO_RATIO = 405 / 597;
const NAVY = '#14213d', LARANJA = '#E8650A', CINZA = '#6b7280';
const EMPRESA = 'Nuk_POS · GESTNUK (filial da Technuk, Lda)';

const fiscalValido = () => process.env.AGT_CERTIFICADO === 'true';
const T = t => t || null;
const kz = n => `${Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
const dataLuanda = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const METODOS = { CASH: 'Dinheiro', TPA: 'TPA / Multicaixa', EXPRESS: 'Multicaixa Express', TRANSFERENCIA: 'Transferência', NUKCOIN: 'Nuk-Coin' };

function renderizar(doc) {
  return new Promise((resolve, reject) => {
    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);
    doc.end();
  });
}

// Logótipo sobre placa azul-escura (o texto prateado precisa de contraste no papel)
function cabecalhoLogo(doc, x, y, largura, alturaPlaca) {
  doc.roundedRect(x, y, largura, alturaPlaca, 8).fill(NAVY);
  const w = Math.min(largura - 16, (alturaPlaca - 10) / LOGO_RATIO);
  doc.image(LOGO, x + (largura - w) / 2, y + (alturaPlaca - w * LOGO_RATIO) / 2, { width: w });
}

async function tenantInfo(tenantId) {
  const r = await pool.query(`SELECT nome, nif, email, telefone_whatsapp FROM tenants WHERE ($1::uuid IS NULL OR id = $1) ORDER BY criado_em LIMIT 1`, [T(tenantId)]);
  const cfg = await pool.query(`SELECT chave, valor FROM configuracoes WHERE chave IN ('nome_estabelecimento','morada_estabelecimento') AND ($1::uuid IS NULL OR tenant_id = $1)`, [T(tenantId)]);
  const c = Object.fromEntries(cfg.rows.map(x => [x.chave, x.valor]));
  const t = r.rows[0] || {};
  return { nome: c.nome_estabelecimento || t.nome || 'Estabelecimento', nif: t.nif, morada: c.morada_estabelecimento, email: t.email, telefone: t.telefone_whatsapp };
}

async function carregarPedido(tenantId, pedidoId) {
  const p = await pool.query(
    `SELECT p.*, m.numero AS mesa_numero, c.nome AS cliente_nome
       FROM pedidos p LEFT JOIN mesas m ON m.id = p.mesa_id LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.id = $1 AND ($2::uuid IS NULL OR p.tenant_id = $2)`, [pedidoId, T(tenantId)]);
  if (!p.rows[0]) throw erro(404, 'Pedido não encontrado');
  const it = await pool.query(
    `SELECT i.quantidade, i.preco_unitario, pr.nome FROM itens_pedido i JOIN produtos pr ON pr.id = i.produto_id WHERE i.pedido_id = $1 ORDER BY i.criado_em, pr.nome`, [pedidoId]);
  return { pedido: p.rows[0], itens: it.rows };
}

/** Talão do pedido, 80 mm de largura (altura ajustada ao conteúdo). */
async function talaoPedido({ tenantId, pedidoId }) {
  const [t, { pedido, itens }] = await Promise.all([tenantInfo(tenantId), carregarPedido(tenantId, pedidoId)]);
  const W = 226.77, M = 10, util = W - 2 * M; // 80 mm
  const altura = 268 + itens.length * 24 + (Number(pedido.desconto) > 0 ? 14 : 0) + (Number(pedido.nukcoin_pago) > 0 ? 14 : 0);
  const doc = new PDFDocument({ size: [W, altura], margins: { top: M, bottom: M, left: M, right: M }, info: { Title: `Talão ${String(pedido.id).slice(0, 8)}`, Author: 'Nuk_POS' } });

  cabecalhoLogo(doc, M, M, util, 62);
  doc.y = M + 70;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(t.nome, { align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor(CINZA);
  if (t.nif) doc.text(`NIF ${t.nif}`, { align: 'center' });
  if (t.morada) doc.text(t.morada, { align: 'center' });
  if (t.telefone) doc.text(`Tel. ${t.telefone}`, { align: 'center' });
  doc.moveDown(0.6).fillColor('#000').font('Helvetica-Bold').fontSize(9).text('TALÃO DE PEDIDO', { align: 'center' });
  doc.font('Helvetica').fontSize(7.5).text(`Nº ${String(pedido.id).slice(0, 8).toUpperCase()} · ${dataLuanda(pedido.criado_em)}`, { align: 'center' });
  doc.text(`${pedido.mesa_numero ? 'Mesa ' + pedido.mesa_numero : 'Sem mesa'}${pedido.cliente_nome ? ' · ' + pedido.cliente_nome : ''}`, { align: 'center' });
  doc.moveDown(0.5);

  const linha = (esq, dir, bold) => {
    const y = doc.y; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    doc.text(esq, M, y, { width: util - 70 }); doc.text(dir, M + util - 70, y, { width: 70, align: 'right' });
    doc.y = Math.max(doc.y, y + 11);
  };
  doc.moveTo(M, doc.y).lineTo(W - M, doc.y).dash(2, { space: 2 }).stroke('#999').undash(); doc.moveDown(0.4);
  for (const i of itens) linha(`${Number(i.quantidade)}x ${i.nome}`, kz(Number(i.quantidade) * Number(i.preco_unitario)));
  doc.moveDown(0.2); doc.moveTo(M, doc.y).lineTo(W - M, doc.y).dash(2, { space: 2 }).stroke('#999').undash(); doc.moveDown(0.4);
  const desc = Number(pedido.desconto) || 0, total = Number(pedido.total) || 0;
  if (desc > 0) { linha('Subtotal', kz(total + desc)); linha('Desconto', `- ${kz(desc)}`); }
  linha('TOTAL', kz(total), true);
  linha(`IVA incluído (${14}%)`, kz(total - total / 1.14));
  linha('Pagamento', METODOS[pedido.metodo_pagamento] || pedido.metodo_pagamento || 'Dinheiro');
  if (Number(pedido.nukcoin_pago) > 0) linha('Pago em Nuk-Coin', kz(pedido.nukcoin_pago));

  doc.moveDown(0.8).font('Helvetica').fontSize(7).fillColor(CINZA).text(fiscalValido() ? 'Obrigado pela preferência!' : 'Documento sem validade fiscal.', M, doc.y, { width: util, align: 'center' });
  doc.text(EMPRESA, M, doc.y + 2, { width: util, align: 'center' });
  return renderizar(doc);
}

/** Factura em A4. */
async function facturaPdf({ tenantId, faturaId }) {
  const f = await pool.query(`SELECT f.*, c.nome AS cliente_nome FROM faturas f LEFT JOIN clientes c ON c.id = f.cliente_id WHERE f.id = $1 AND ($2::uuid IS NULL OR f.tenant_id = $2)`, [faturaId, T(tenantId)]);
  const fat = f.rows[0];
  if (!fat) throw erro(404, 'Factura não encontrada');
  const t = await tenantInfo(tenantId || fat.tenant_id);
  let itens = [];
  if (fat.pedido_id) itens = (await carregarPedido(fat.tenant_id, fat.pedido_id)).itens;

  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: fat.numero_fatura, Author: 'Nuk_POS' } });
  const L = 40, R = 555, util = R - L;
  cabecalhoLogo(doc, L, 36, 170, 82);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('FACTURA', 300, 40, { width: util - 260, align: 'right' });
  doc.fontSize(11).fillColor(LARANJA).text(fat.numero_fatura, 300, 62, { width: util - 260, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(`Emitida em ${dataLuanda(fat.emitida_em)}`, 300, 80, { width: util - 260, align: 'right' });
  doc.text(fiscalValido() ? 'Original' : 'Documento sem validade fiscal', 300, 93, { width: util - 260, align: 'right' });

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(t.nome, L, 140);
  doc.font('Helvetica').fontSize(9).fillColor(CINZA);
  [t.nif && `NIF ${t.nif}`, t.morada, t.email, t.telefone && `Tel. ${t.telefone}`].filter(Boolean).forEach(x => doc.text(x, L));
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('CLIENTE', 340, 140);
  doc.font('Helvetica').fillColor(CINZA).text(fat.nome_cliente || fat.cliente_nome || 'Consumidor final', 340, 153, { width: R - 340 });
  doc.text(fat.nif_cliente ? `NIF ${fat.nif_cliente}` : 'NIF não indicado', 340);

  let y = 230;
  doc.rect(L, y, util, 20).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
  doc.text('Descrição', L + 8, y + 6); doc.text('Qtd', 340, y + 6, { width: 40, align: 'right' }); doc.text('Preço', 385, y + 6, { width: 75, align: 'right' }); doc.text('Total', 465, y + 6, { width: 82, align: 'right' });
  y += 26; doc.font('Helvetica').fillColor('#000');
  const linhas = itens.length ? itens.map(i => [i.nome, Number(i.quantidade), Number(i.preco_unitario)]) : [['Serviços prestados', 1, Number(fat.total)]];
  for (const [nome, q, p] of linhas) {
    if (y > 700) { doc.addPage(); y = 50; }
    doc.fontSize(9).text(nome, L + 8, y, { width: 280 }); doc.text(String(q), 340, y, { width: 40, align: 'right' });
    doc.text(kz(p), 385, y, { width: 75, align: 'right' }); doc.text(kz(q * p), 465, y, { width: 82, align: 'right' });
    y += 18; doc.moveTo(L, y - 4).lineTo(R, y - 4).lineWidth(0.4).stroke('#e5e7eb');
  }
  y += 10;
  const tot = (rot, val, bold) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(bold ? NAVY : '#000'); doc.text(rot, 330, y, { width: 120 }); doc.text(val, 440, y, { width: 107, align: 'right' }); y += bold ? 20 : 16; };
  tot('Total sem IVA', kz(fat.total_sem_iva));
  tot(`IVA (${Number(fat.taxa_iva)}%)`, kz(fat.iva));
  tot('TOTAL', kz(fat.total), true);

  doc.font('Helvetica').fontSize(8).fillColor(CINZA);
  if (fat.hash_assinatura) doc.text(`Assinatura: ${String(fat.hash_assinatura).slice(0, 4)}`, L, 770);
  doc.text(`${fiscalValido() ? 'Processado por programa certificado AGT' : 'Documento sem validade fiscal — programa em processo de certificação AGT'} · ${EMPRESA}`, L, 785, { width: util, align: 'center' });
  return renderizar(doc);
}

module.exports = { talaoPedido, facturaPdf };
