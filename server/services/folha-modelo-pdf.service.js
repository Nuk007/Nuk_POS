'use strict';
/**
 * Folha de Caixa em branco (A4, frente e verso) para preencher à mão — o desenho da folha em papel do Clube 3D com os
 * dados do estabelecimento (Configurações) e os itens do seu modelo (`folha-modelo.service`).
 * Frente: n.º/data, abertura e fecho, compras/saídas por área, controlo do dia, totais J/K, assinaturas.
 * Verso: vendas por grupo em duas colunas, com os preços impressos.
 */
const PDFDocument = require('pdfkit');
const { tenantInfo } = require('./documentos.service');
const modelo = require('./folha-modelo.service');

const NAVY = '#1F3864', SALMAO = '#FCE4D6', CINZA = '#D9D9D9', VERDE = '#E2EFDA', VERM = '#C00000', AZUL = '#2F5597';
const AREAS = { ESPLANADA_BAR: 'Esplanada / Bar', COZINHA: 'Cozinha', PISCINA: 'Piscina', HOTEL: 'Hotel', TECNICA: 'Técnica', DIVERSOS: 'Diversos' };
const rotArea = a => AREAS[a] || String(a).replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const kz = n => {
  if (n === null || n === undefined) return '';
  const [i, d] = Number(n).toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d === '00' ? '' : ',' + d);
};

function renderizar(doc) {
  return new Promise((resolve, reject) => {
    const b = []; doc.on('data', x => b.push(x)); doc.on('end', () => resolve(Buffer.concat(b))); doc.on('error', reject); doc.end();
  });
}

async function folhaEmBrancoPdf({ tenantId }) {
  const [m, info, areas] = await Promise.all([modelo.ler(tenantId), tenantInfo(tenantId), modelo.areasActivas(tenantId)]);
  const doc = new PDFDocument({ size: 'A4', margin: 30, info: { Title: `${m.titulo} em branco`, Author: 'Nuk_POS' } });
  const X = 30, W = 595.28 - 60, H = 15; // altura das linhas: dá para escrever à mão
  let y = 30;

  const caixa = (x, yy, w, h, txt, o = {}) => {
    if (o.fill) doc.rect(x, yy, w, h).fill(o.fill);
    doc.rect(x, yy, w, h).lineWidth(0.5).stroke('#666');
    if (txt) doc.fillColor(o.cor || '#000').font(o.b ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.tam || 7.5)
      .text(String(txt), x + 3, yy + (h - (o.tam || 7.5)) / 2, { width: w - 6, align: o.al || 'left', lineBreak: false, ellipsis: true });
  };
  const cabecalho = verso => {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(info.nome, X, y, { width: W * 0.62, lineBreak: false, ellipsis: true });
    const dados = [info.morada, info.nif ? `NIF ${info.nif}` : null, info.telefone ? `Tel. ${info.telefone}` : null].filter(Boolean).join(' · ');
    doc.fillColor('#555').font('Helvetica').fontSize(7.5).text(dados, X, y + 16, { width: W * 0.62, lineBreak: false, ellipsis: true });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(`${m.titulo} nº ________${verso ? ' (verso)' : ''}`, X + W * 0.5, y, { width: W * 0.5, align: 'right' });
    doc.fillColor('#000').font('Helvetica').fontSize(10).text('Data ____ / ____ / ________', X + W * 0.5, y + 16, { width: W * 0.5, align: 'right' });
    y += 36;
  };

  // ── Frente ──
  cabecalho(false);
  const q = W / 4;
  caixa(X, y, q, 24, 'ABERTURA (A)', { fill: CINZA, b: true, al: 'center' }); caixa(X + q, y, q, 24, '', { fill: SALMAO });
  caixa(X + 2 * q, y, q, 24, 'FECHO (A + J - D)', { fill: CINZA, b: true, al: 'center' }); caixa(X + 3 * q, y, q, 24, '', { fill: SALMAO });
  y += 32;

  const ca = [95, W - 95 - 85, 85];
  caixa(X, y, W, H, '== COMPRAS / SAÍDAS ==', { fill: VERDE, b: true, al: 'center', cor: VERM }); y += H;
  caixa(X, y, ca[0], H, 'ÁREA', { fill: CINZA, b: true }); caixa(X + ca[0], y, ca[1], H, 'DESCRIÇÃO (fornecedor, n.º da factura)', { fill: CINZA, b: true, al: 'center' });
  caixa(X + ca[0] + ca[1], y, ca[2], H, 'VALOR (Kz)', { fill: CINZA, b: true, al: 'center' }); y += H;
  for (const a of areas) for (let i = 0; i < m.areas_brancos; i++) {
    caixa(X, y, ca[0], H, i === 0 ? rotArea(a) : '', { b: true }); caixa(X + ca[0], y, ca[1], H, ''); caixa(X + ca[0] + ca[1], y, ca[2], H, ''); y += H;
  }
  const lado = (rot, fill, nota) => {
    caixa(X, y, W - 85 - 110, H, nota || '', { tam: 6.5 }); caixa(X + W - 195, y, 110, H, rot, { b: true, fill: rot.startsWith('TOTAL') ? CINZA : undefined, cor: rot.includes('(B)') ? VERM : undefined });
    caixa(X + W - 85, y, 85, H, '', { fill }); y += H;
  };
  lado('TOTAL SAÍDAS (B)', undefined, 'C = pago por banco / fundo de compras · D = pago pelo caixa');
  lado('BANCO / FUNDO (C)', SALMAO); lado('CAIXA (D)', SALMAO); lado('TOTAL (C + D)', SALMAO);
  y += 10;

  if (m.controlo) {
    const c4 = [W * 0.3, W * 0.2, W * 0.3, W * 0.2];
    caixa(X, y, W, H, 'CONTROLO DO DIA', { fill: VERDE, b: true, al: 'center', cor: VERM }); y += H;
    const fila = (a, b, fa, fb) => {
      let x = X;
      [[a, CINZA, true], ['', fa], [b, CINZA, true], ['', fb]].forEach(([t, f, neg], i) => { caixa(x, y, c4[i], H, t, { fill: t ? f : f, b: neg }); x += c4[i]; });
      y += H;
    };
    fila('Quebras (artigo e quantidade)', 'Vendas a crédito — cliente');
    let x = X; c4.forEach(w => { caixa(x, y, w, H, ''); x += w; }); y += H;
    x = X; c4.forEach(w => { caixa(x, y, w, H, ''); x += w; }); y += H;
    fila('Fecho do TPA', 'Dinheiro contado no fecho', SALMAO, SALMAO);
    y += 10;
  }

  const c6 = W / 6;
  [['TOTAL VENDAS (E+F+G+H+I)'], ['TOTAL VENDA CAIXA (J)'], ['TOTAL VENDA BANCO (K)']].forEach(([t], i) => {
    caixa(X + i * 2 * c6, y, c6, 26, t, { fill: CINZA, b: true, tam: 6.5 }); caixa(X + i * 2 * c6 + c6, y, c6, 26, '', { fill: SALMAO });
  });
  y += 30;
  doc.fillColor('#333').font('Helvetica-Oblique').fontSize(7).text('J = Total vendas - K - vendas a crédito. As quebras não contam como vendas. Fecho = A + J - D (compare com o dinheiro contado).', X, y, { width: W });
  y += 26;
  if (m.assinaturas.length) {
    const w = W / m.assinaturas.length;
    m.assinaturas.forEach((a, i) => doc.fillColor('#000').font('Helvetica').fontSize(9).text(`${a} ……………………………`, X + i * w, y, { width: w - 6, lineBreak: false }));
  }

  // ── Verso: vendas ──
  doc.addPage(); y = 30;
  cabecalho(true);
  const cv = [W / 2 * 0.44, W / 2 * 0.12, W / 2 * 0.17, W / 2 * 0.27];
  const blocos = g => {
    if (g.oculto) return [];
    const L = [{ cab: g.nome.toUpperCase() }];
    for (const it of g.itens) L.push({ nome: it.nome, preco: it.preco });
    for (let i = 0; i < g.brancos; i++) L.push({ nome: '', preco: null });
    L.push({ tot: `(${g.letra}) TOTAL ${g.nome.toUpperCase()} =` });
    return L;
  };
  // equilibra as duas colunas: grupos por ordem, cada um na coluna mais curta
  const cols = [[], []];
  for (const g of m.grupos) { const b = blocos(g); if (!b.length) continue; (cols[0].length <= cols[1].length ? cols[0] : cols[1]).push(...b); }
  const n = Math.max(cols[0].length, cols[1].length);
  caixa(X, y, W, H, '== VENDAS / ENTRADAS ==', { fill: VERDE, b: true, al: 'center', cor: VERM }); y += H;
  const meia = (it, x0) => {
    const xs = [x0, x0 + cv[0], x0 + cv[0] + cv[1], x0 + cv[0] + cv[1] + cv[2]];
    if (!it) { cv.forEach((w, i) => caixa(xs[i], y, w, H, '')); return; }
    if (it.cab) { caixa(xs[0], y, cv[0], H, it.cab, { fill: CINZA, b: true }); ['QTD', 'PREÇO', 'VALOR'].forEach((t, i) => caixa(xs[i + 1], y, cv[i + 1], H, t, { fill: CINZA, b: true, al: 'center' })); return; }
    if (it.tot) { caixa(xs[0], y, cv[0] + cv[1] + cv[2], H, it.tot, { fill: VERDE, b: true, al: 'right', cor: VERM, tam: 6.5 }); caixa(xs[3], y, cv[3], H, '', { fill: SALMAO }); return; }
    caixa(xs[0], y, cv[0], H, it.nome); caixa(xs[1], y, cv[1], H, ''); caixa(xs[2], y, cv[2], H, kz(it.preco), { al: 'right', cor: AZUL }); caixa(xs[3], y, cv[3], H, '');
  };
  for (let i = 0; i < n; i++) {
    if (y + H > 800) { doc.addPage(); y = 30; cabecalho(true); }
    meia(cols[0][i], X); meia(cols[1][i], X + W / 2); y += H;
  }
  doc.page.margins.bottom = 0;
  doc.fillColor('#999').font('Helvetica').fontSize(6).text('Modelo gerado pelo Nuk_POS · documento interno de gestão, sem validade fiscal', X, 815, { width: W, align: 'center', lineBreak: false });
  return renderizar(doc);
}

module.exports = { folhaEmBrancoPdf };
