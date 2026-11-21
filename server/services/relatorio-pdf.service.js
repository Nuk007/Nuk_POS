'use strict';
/**
 * PDF A4 de qualquer relatório gerado (formato comum de relatorios-geradores.service): cabeçalho do estabelecimento,
 * título e período, quadro-resumo, secções em tabela e alertas. A Folha de Caixa usa o seu próprio desenho.
 */
const PDFDocument = require('pdfkit');
const { tenantInfo } = require('./documentos.service');

const NAVY = '#1F3864', CINZA = '#D9D9D9', SALMAO = '#FCE4D6', LARANJA = '#E8650A';
const dataPt = d => String(d).split('-').reverse().join('/');
function fmt(v, formato) {
  if (v === null || v === undefined || v === '') return '-';
  if (formato === 'kz' || formato === 'num') {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    const casas = formato === 'kz' ? 2 : (Number.isInteger(n) ? 0 : 3);
    const [i, d] = Math.abs(n).toFixed(casas).split('.');
    return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d && !/^0+$/.test(d) ? ',' + d.replace(/0+$/, formato === 'kz' ? '0' : '') : '');
  }
  if (formato === 'pct') return `${String(v).replace('.', ',')} %`;
  return String(v).replace(/−/g, '-');
}

function renderizar(doc) {
  return new Promise((resolve, reject) => {
    const b = []; doc.on('data', x => b.push(x)); doc.on('end', () => resolve(Buffer.concat(b))); doc.on('error', reject); doc.end();
  });
}

async function relatorioPdf({ tenantId, relatorio }) {
  const r = relatorio.dados;
  if (r.pdf === 'FOLHA_CAIXA') return require('./folha-caixa-pdf.service').folhaPdf({ tenantId, dia: relatorio.de });
  const info = await tenantInfo(tenantId);
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `${r.titulo} ${relatorio.de}`, Author: 'Nuk_POS' } });
  const X = 36, W = 595.28 - 72, FUNDO = 800;
  let y = 36;
  const novaPagina = h => { if (y + h > FUNDO) { doc.addPage(); y = 36; return true; } return false; };

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(info.nome, X, y, { width: W * 0.6, lineBreak: false, ellipsis: true });
  doc.fillColor('#555').font('Helvetica').fontSize(7.5).text([info.morada, info.nif ? `NIF ${info.nif}` : null, info.telefone ? `Tel. ${info.telefone}` : null].filter(Boolean).join(' · '), X, y + 16, { width: W * 0.6, lineBreak: false, ellipsis: true });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(r.titulo, X + W * 0.4, y, { width: W * 0.6, align: 'right' });
  doc.fillColor('#000').font('Helvetica').fontSize(9).text(relatorio.de === relatorio.ate ? `Dia ${dataPt(relatorio.de)}` : `${dataPt(relatorio.de)} a ${dataPt(relatorio.ate)}`, X + W * 0.4, doc.y + 2, { width: W * 0.6, align: 'right' });
  y = Math.max(doc.y, y + 34) + 10;

  // Resumo em caixas (até 4 por linha)
  const res = r.resumo || [];
  for (let i = 0; i < res.length; i += 4) {
    const fila = res.slice(i, i + 4), w = W / 4;
    novaPagina(34);
    fila.forEach((k, j) => {
      doc.rect(X + j * w, y, w - 4, 30).fill(SALMAO);
      doc.fillColor('#555').font('Helvetica').fontSize(6.5).text(k.rotulo, X + j * w + 4, y + 3, { width: w - 12, lineBreak: false, ellipsis: true });
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text(fmt(k.valor, k.formato) + (k.formato === 'kz' && k.valor !== null ? ' Kz' : ''), X + j * w + 4, y + 14, { width: w - 12, lineBreak: false, ellipsis: true });
    });
    y += 34;
  }
  if ((r.alertas || []).length) {
    y += 4;
    for (const a of r.alertas) {
      const h = doc.font('Helvetica').fontSize(7.5).heightOfString(`! ${a}`, { width: W - 8 }) + 4;
      novaPagina(h);
      doc.rect(X, y, 2, h - 2).fill(LARANJA);
      doc.fillColor('#333').text(`! ${fmt(a)}`, X + 6, y + 1, { width: W - 8 });
      y += h;
    }
  }

  for (const s of r.seccoes || []) {
    const cols = s.colunas || [];
    if (!cols.length) continue;
    // larguras: texto ocupa o que sobra; números 70 pt cada
    const numW = 64, nTxt = cols.filter(c => c.formato === 'txt').length || 1;
    const txtW = Math.max(60, (W - numW * cols.filter(c => c.formato !== 'txt').length) / nTxt);
    const larg = cols.map(c => (c.formato === 'txt' ? txtW : numW));
    const escala = W / larg.reduce((a, b) => a + b, 0);
    for (let i = 0; i < larg.length; i++) larg[i] *= escala;
    const H = 13;
    const linhaTabela = (valores, o = {}) => {
      let x = X;
      if (o.fill) doc.rect(X, y, W, H).fill(o.fill);
      cols.forEach((c, i) => {
        const v = valores[i];
        doc.fillColor('#000').font(o.b ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
          .text(v, x + 3, y + 3, { width: larg[i] - 6, align: o.cab ? 'center' : (c.alinhar === 'dir' ? 'right' : 'left'), lineBreak: false, ellipsis: true });
        x += larg[i];
      });
      doc.moveTo(X, y + H).lineTo(X + W, y + H).lineWidth(0.3).stroke('#bbb');
      y += H;
    };
    y += 8;
    novaPagina(40);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5).text(s.titulo, X, y); y = doc.y + 3;
    linhaTabela(cols.map(c => c.rotulo), { fill: CINZA, b: true, cab: true });
    if (!s.linhas || !s.linhas.length) { doc.fillColor('#777').font('Helvetica-Oblique').fontSize(7.5).text('Sem registos no período.', X + 3, y + 3); y += H; continue; }
    for (const l of s.linhas) {
      if (novaPagina(H)) linhaTabela(cols.map(c => c.rotulo), { fill: CINZA, b: true, cab: true });
      linhaTabela(cols.map(c => fmt(l[c.chave], c.formato)));
    }
    if (s.total) { novaPagina(H); linhaTabela(cols.map(c => (s.total[c.chave] === undefined ? '' : fmt(s.total[c.chave], c.formato))), { fill: SALMAO, b: true }); }
  }
  doc.page.margins.bottom = 0;
  doc.fillColor('#999').font('Helvetica').fontSize(6).text(`Gerado automaticamente pelo Nuk_POS em ${new Date(relatorio.gerado_em || Date.now()).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })} · documento interno de gestão, sem validade fiscal`, X, 815, { width: W, align: 'center', lineBreak: false });
  return renderizar(doc);
}

module.exports = { relatorioPdf, fmt };
