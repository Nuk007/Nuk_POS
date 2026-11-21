'use strict';
/**
 * Folha de Caixa em PDF (A4) — o mesmo desenho da folha em papel (abertura/fecho, compras/saídas por área, vendas por
 * grupo, totais E..K) com os números que o sistema calculou (`folha-caixa.service.gerar`). Sem estado: gera um Buffer.
 */
const PDFDocument = require('pdfkit');
const { tenantInfo } = require('./documentos.service');
const folha = require('./folha-caixa.service');

const NAVY = '#1F3864', LARANJA = '#E8650A', SALMAO = '#FCE4D6', CINZA = '#D9D9D9', VERDE = '#E2EFDA', AZUL = '#DDEBF7';
const kz = n => {
  if (n === null || n === undefined) return '-';
  const [i, d] = Math.abs(Number(n)).toFixed(2).split('.');
  return (Number(n) < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};
const AREAS = { ESPLANADA_BAR: 'Esplanada / Bar', COZINHA: 'Cozinha', PISCINA: 'Piscina', HOTEL: 'Hotel', TECNICA: 'Técnica', DIVERSOS: 'Diversos' };
const rotArea = a => AREAS[a] || String(a).replace(/_/g, ' ');

function renderizar(doc) {
  return new Promise((resolve, reject) => {
    const bufs = [];
    doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    doc.end();
  });
}

async function folhaPdf({ tenantId, dia }) {
  const f = await folha.gerar({ tenantId, dia });
  const info = await tenantInfo(tenantId);
  const doc = new PDFDocument({ size: 'A4', margin: 32, info: { Title: `Folha de Caixa ${f.dia}`, Author: 'Nuk_POS' } });
  const X = 32, W = 595.28 - 64;
  let y = 32;

  const caixa = (x, yy, w, h, txt, o = {}) => {
    if (o.fill) doc.rect(x, yy, w, h).fill(o.fill);
    doc.rect(x, yy, w, h).lineWidth(0.5).stroke('#555');
    if (txt !== undefined && txt !== null) {
      doc.fillColor(o.cor || '#000').font(o.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.tam || 8)
        .text(String(txt), x + 3, yy + (h - (o.tam || 8)) / 2 - 1, { width: w - 6, align: o.alinhar || 'left', lineBreak: false, ellipsis: true });
    }
  };
  const novaPaginaSe = h => { if (y + h > 800) { doc.addPage(); y = 32; } };

  // Cabeçalho
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text(info.nome, X, y, { width: W * 0.6 });
  doc.fillColor('#555').font('Helvetica').fontSize(7.5).text([info.morada, info.nif ? `NIF ${info.nif}` : null, info.telefone].filter(Boolean).join(' · '), X, y + 18, { width: W * 0.6 });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(`Folha de Caixa nº ${f.numero}`, X + W * 0.55, y, { width: W * 0.45, align: 'right' });
  const [a, m, d] = f.dia.split('-');
  doc.fillColor('#000').font('Helvetica').fontSize(10).text(`Data ${d}/${m}/${a}`, X + W * 0.55, y + 18, { width: W * 0.45, align: 'right' });
  y += 40;

  // Abertura / fecho
  const q = W / 4;
  caixa(X, y, q, 22, 'VALOR EM CAIXA = ABERTURA (A)', { fill: CINZA, negrito: true, tam: 7 });
  caixa(X + q, y, q, 22, kz(f.abertura.A), { fill: SALMAO, alinhar: 'right', negrito: true });
  caixa(X + 2 * q, y, q, 22, 'VALOR EM CAIXA = FECHO (A+J-D)', { fill: CINZA, negrito: true, tam: 7 });
  caixa(X + 3 * q, y, q, 22, kz(f.fecho.calculado), { fill: SALMAO, alinhar: 'right', negrito: true });
  y += 22;
  if (f.fecho.declarado !== null) {
    caixa(X, y, 3 * q, 14, `Contado no fecho: ${kz(f.fecho.declarado)} Kz · diferença ${kz(f.fecho.diferenca)} Kz`, { tam: 7, alinhar: 'right' });
    caixa(X + 3 * q, y, q, 14, '', {}); y += 14;
  }

  // Compras / saídas
  y += 4;
  caixa(X, y, W, 14, '== COMPRAS / SAÍDAS ==', { fill: VERDE, negrito: true, alinhar: 'center', cor: '#C00000' }); y += 14;
  caixa(X, y, 90, 13, 'ÁREA', { fill: CINZA, negrito: true }); caixa(X + 90, y, W - 180, 13, 'DESCRIÇÃO', { fill: CINZA, negrito: true, alinhar: 'center' });
  caixa(X + W - 90, y, 90, 13, 'VALOR (Kz)', { fill: CINZA, negrito: true, alinhar: 'center' }); y += 13;
  const linhas = f.saidas.linhas.length ? f.saidas.linhas : [{ area: '—', descricao: 'Sem compras nem despesas registadas neste dia', valor: null }];
  for (const s of linhas) {
    novaPaginaSe(13);
    caixa(X, y, 90, 13, s.area === '—' ? '—' : rotArea(s.area), { negrito: true, tam: 7.5 });
    caixa(X + 90, y, W - 180, 13, `${s.descricao}${s.pago === 'BANCO' ? ' (banco)' : ''}`, { tam: 7.5 });
    caixa(X + W - 90, y, 90, 13, s.valor === null ? '' : kz(s.valor), { alinhar: 'right', tam: 7.5 }); y += 13;
  }
  novaPaginaSe(60);
  const por = Object.entries(f.saidas.por_area).map(([k, v]) => `${rotArea(k)} ${kz(v)}`).join(' · ');
  caixa(X, y, W - 180, 13, por ? `Por área: ${por}` : '', { tam: 7 });
  caixa(X + W - 180, y, 90, 13, 'T. DIV. (B)', { negrito: true, cor: '#C00000' }); caixa(X + W - 90, y, 90, 13, kz(f.saidas.B), { alinhar: 'right', negrito: true }); y += 13;
  caixa(X + W - 180, y, 90, 13, 'BANCO (C)'); caixa(X + W - 90, y, 90, 13, kz(f.saidas.C), { alinhar: 'right', fill: SALMAO }); y += 13;
  caixa(X + W - 180, y, 90, 13, 'CAIXA (D)'); caixa(X + W - 90, y, 90, 13, kz(f.saidas.D), { alinhar: 'right', fill: SALMAO }); y += 13;
  caixa(X + W - 180, y, 90, 13, 'TOTAL (C+D)', { fill: CINZA, negrito: true }); caixa(X + W - 90, y, 90, 13, kz(f.saidas.total), { alinhar: 'right', fill: SALMAO, negrito: true }); y += 17;

  // Vendas por grupo
  novaPaginaSe(40);
  caixa(X, y, W, 14, '== VENDAS / ENTRADAS ==', { fill: VERDE, negrito: true, alinhar: 'center', cor: '#C00000' }); y += 14;
  const ordem = [['BEBIDAS', 'F', 'BEBIDAS'], ['COMIDAS', 'G', 'COMIDAS'], ['PISCINA', 'H', 'PISCINA'], ['QUARTOS', 'I', 'QUARTOS'], ['OUTROS', 'E', 'SHISHAS / CIGARROS / DIVERSAS']];
  for (const [g, letra, titulo] of ordem) {
    const grupo = f.vendas.grupos[g];
    novaPaginaSe(28);
    caixa(X, y, W - 180, 13, titulo, { fill: g === 'OUTROS' ? AZUL : CINZA, negrito: true });
    caixa(X + W - 180, y, 40, 13, 'QTD', { fill: CINZA, negrito: true, alinhar: 'center' });
    caixa(X + W - 140, y, 50, 13, 'PREÇO', { fill: CINZA, negrito: true, alinhar: 'center' });
    caixa(X + W - 90, y, 90, 13, 'VALOR', { fill: CINZA, negrito: true, alinhar: 'center' }); y += 13;
    for (const l of grupo.linhas) {
      novaPaginaSe(12);
      caixa(X, y, W - 180, 12, l.produto, { tam: 7.5 });
      caixa(X + W - 180, y, 40, 12, l.quantidade, { tam: 7.5, alinhar: 'right' });
      caixa(X + W - 140, y, 50, 12, l.preco === null ? '' : kz(l.preco), { tam: 7, alinhar: 'right', cor: '#2F5597' });
      caixa(X + W - 90, y, 90, 12, kz(l.valor), { tam: 7.5, alinhar: 'right' }); y += 12;
    }
    caixa(X, y, W - 90, 13, `(${letra}) Total ${titulo.toLowerCase()}`, { fill: VERDE, negrito: true, cor: '#C00000', alinhar: 'right' });
    caixa(X + W - 90, y, 90, 13, kz(grupo.total), { fill: SALMAO, alinhar: 'right', negrito: true }); y += 15;
  }

  // Totais
  novaPaginaSe(80);
  const t3 = W / 3;
  caixa(X, y, t3 * 0.55, 26, 'TOTAL VENDAS (E+F+G+H+I)', { fill: CINZA, negrito: true, tam: 8 });
  caixa(X + t3 * 0.55, y, t3 * 0.45, 26, kz(f.vendas.total), { fill: SALMAO, alinhar: 'right', negrito: true, tam: 9 });
  caixa(X + t3, y, t3 * 0.55, 26, 'TOTAL VENDA CAIXA (J)', { fill: CINZA, negrito: true, tam: 8 });
  caixa(X + t3 * 1.55, y, t3 * 0.45, 26, kz(f.entradas.J), { fill: SALMAO, alinhar: 'right', negrito: true, tam: 9 });
  caixa(X + 2 * t3, y, t3 * 0.55, 26, 'TOTAL VENDA BANCO (K)', { fill: CINZA, negrito: true, tam: 8 });
  caixa(X + t3 * 2.55, y, t3 * 0.45, 26, kz(f.entradas.K), { fill: SALMAO, alinhar: 'right', negrito: true, tam: 9 });
  y += 30;
  const extra = [
    f.vendas.descontos ? `Descontos/campanhas nas contas: ${kz(f.vendas.descontos)} Kz` : null,
    f.vendas.a_credito ? `Lançado em conta corrente (dívidas de clientes): ${kz(f.vendas.a_credito)} Kz` : null,
    f.quebras.total || f.quebras.linhas.length ? `Quebras (ao custo): ${f.quebras.linhas.map(x => `${x.item} ${x.quantidade} ${x.unidade}`).join(', ')} — ${kz(f.quebras.total)} Kz` : null,
    f.por_receber.n ? `Por receber do dia: ${f.por_receber.n} conta(s), ${kz(f.por_receber.valor)} Kz` : null,
    ...f.alertas.map(x => `⚠ ${x}`),
  ].filter(Boolean);
  doc.font('Helvetica').fontSize(7.5).fillColor('#333');
  for (const e of extra) { novaPaginaSe(12); doc.text(e.replace('⚠', '!'), X, y, { width: W }); y = doc.y + 2; }

  novaPaginaSe(40);
  y += 18;
  doc.fillColor('#000').fontSize(9).text('Elaborou ……………………………………', X + 20, y);
  doc.text('Verificou ……………………………………', X + W / 2 + 20, y);
  doc.page.margins.bottom = 0; // o rodapé fica abaixo da margem sem abrir página nova
  doc.fillColor(LARANJA).fontSize(6.5).text('Gerado pelo Nuk_POS · GESTNUK (filial da Technuk, Lda) · documento interno de gestão, sem validade fiscal', X, 812, { width: W, align: 'center', lineBreak: false });
  return renderizar(doc);
}

module.exports = { folhaPdf };
