'use strict';
/**
 * Etiquetas de produto com código de barras (21/11/2026, pedido do dono: funções do WinREST que faltavam).
 * Folha A4 de 24 etiquetas (3 × 8, 70 × 37 mm — o formato autocolante mais comum à venda): nome do estabelecimento,
 * produto, preço (por kg nos vendidos ao peso) e o código de barras (EAN-13/EAN-8/UPC-A quando o código é um
 * deles; senão Code 128). Produtos sem código recebem um EAN-13 interno antes de imprimir (gerarCodigo).
 */
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const { pool } = require('../db');
const { erro } = require('./shared');
const produtosSvc = require('./produtos.service');
const { tenantInfo } = require('./documentos.service');

const MAX_PRODUTOS = 200;
const MAX_COPIAS = 100;
const MAX_ETIQUETAS = 1000;
const POR_FOLHA = 24;

/** `itens` = texto «id:copias,id:copias» (vem do endereço) ou lista [{ produto_id, copias }]. */
function lerItens(itens) {
  const lista = Array.isArray(itens) ? itens
    : String(itens || '').split(',').filter(Boolean).map(x => { const [produto_id, copias] = x.split(':'); return { produto_id, copias }; });
  if (!lista.length) throw erro(400, 'Escolha pelo menos um produto');
  if (lista.length > MAX_PRODUTOS) throw erro(400, `No máximo ${MAX_PRODUTOS} produtos por folha`);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const out = lista.map(x => {
    const copias = x.copias === undefined || x.copias === '' ? 1 : Number(x.copias);
    if (!uuid.test(String(x.produto_id || ''))) throw erro(400, 'Produto inválido');
    if (!Number.isInteger(copias) || copias < 1 || copias > MAX_COPIAS) throw erro(400, `Cópias inválidas (1 a ${MAX_COPIAS} por produto)`);
    return { produto_id: String(x.produto_id), copias };
  });
  if (out.reduce((s, x) => s + x.copias, 0) > MAX_ETIQUETAS) throw erro(400, `No máximo ${MAX_ETIQUETAS} etiquetas de cada vez`);
  return out;
}

function simbologia(codigo) {
  if (/^\d{13}$/.test(codigo) && produtosSvc.eanValido(codigo)) return 'ean13';
  if (/^\d{8}$/.test(codigo) && produtosSvc.eanValido(codigo)) return 'ean8';
  if (/^\d{12}$/.test(codigo) && produtosSvc.eanValido(codigo)) return 'upca';
  return 'code128';
}
const imagemCodigo = codigo => bwipjs.toBuffer({ bcid: simbologia(codigo), text: codigo, scale: 3, height: 9, includetext: true, textsize: 9, paddingwidth: 2 });

const kz = v => `${String(Math.round(Number(v) * 100) / 100).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Kz`;

async function folhaEtiquetas({ tenantId, itens }) {
  const pedidos = lerItens(itens);
  const ids = [...new Set(pedidos.map(x => x.produto_id))];
  const r = await pool.query(`SELECT id, nome, preco, vendido_ao_peso, codigo_barras FROM produtos WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND ativo = true`, [tenantId, ids]);
  if (r.rows.length !== ids.length) throw erro(404, 'Um dos produtos não existe neste estabelecimento');
  const porId = new Map(r.rows.map(p => [p.id, p]));
  // sem código: gera um EAN-13 interno (fica gravado no produto, para o leitor o reconhecer)
  for (const p of r.rows) if (!p.codigo_barras) porId.set(p.id, await produtosSvc.gerarCodigo({ tenantId, id: p.id }));
  const imagens = new Map();
  for (const p of porId.values()) imagens.set(p.id, await imagemCodigo(p.codigo_barras));

  const t = await tenantInfo(tenantId);
  const mm = v => v * 72 / 25.4;
  const W = mm(70), H = mm(37), X0 = 0, Y0 = (841.89 - 8 * H) / 2;
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Etiquetas de produto', Author: 'Nuk_POS' } });
  let k = 0;
  for (const { produto_id, copias } of pedidos) {
    const p = porId.get(produto_id);
    for (let c = 0; c < copias; c++, k++) {
      const n = k % POR_FOLHA;
      if (n === 0) doc.addPage();
      const x = X0 + (n % 3) * W, y = Y0 + Math.floor(n / 3) * H;
      doc.save().lineWidth(0.3).dash(2, { space: 3 }).strokeColor('#d1d5db').rect(x, y, W, H).stroke().undash().restore();
      doc.font('Helvetica').fontSize(6).fillColor('#6b7280').text(t.nome, x + mm(3), y + mm(2.2), { width: W - mm(6), height: mm(3), ellipsis: true, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(p.nome, x + mm(3), y + mm(5.2), { width: W - mm(6), height: mm(8), ellipsis: true });
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(`${kz(p.preco)}${p.vendido_ao_peso ? ' / kg' : ''}`, x + mm(3), y + mm(13), { width: W - mm(6), lineBreak: false });
      doc.image(imagens.get(p.id), x + mm(8), y + mm(19.5), { fit: [W - mm(16), mm(15.5)], align: 'center' });
    }
  }
  return new Promise((resolve, reject) => {
    const partes = [];
    doc.on('data', d => partes.push(d)); doc.on('end', () => resolve(Buffer.concat(partes))); doc.on('error', reject);
    doc.end();
  });
}

module.exports = { folhaEtiquetas, lerItens, simbologia, MAX_ETIQUETAS };
