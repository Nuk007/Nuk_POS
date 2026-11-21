'use strict';
/**
 * ProdutosService — ementa do estabelecimento (lógica que estava na rota; 21/11/2026).
 * Desde 21/11/2026 (pedido do dono, funções do WinREST que faltavam):
 *  - `vendido_ao_peso`: o preço é por kg e, ao vender, a quantidade é o peso (até 3 casas: gramas);
 *  - `codigo_barras`: único por estabelecimento; EAN-8/UPC-A/EAN-13 têm o dígito de controlo verificado;
 *    sem código, o sistema gera um EAN-13 interno começado por 2 (gama reservada a uso na própria loja).
 */
const crypto = require('crypto');
const { pool } = require('../db');
const { erro } = require('./shared');
const listas = require('./listas.service');

const PESO_MAX = 999.999;          // kg por linha
const QTD_MAX = 1000;              // unidades por linha
const CODIGO_RE = /^[0-9A-Za-z.\-]{4,32}$/;

/** Dígito de controlo EAN/UPC dos primeiros n−1 algarismos. */
function digitoControlo(semControlo) {
  let soma = 0;
  for (let i = semControlo.length - 1, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += Number(semControlo[i]) * peso;
  return String((10 - (soma % 10)) % 10);
}
const eanValido = c => digitoControlo(c.slice(0, -1)) === c.slice(-1);

/** undefined = não mexe; null/'' = tira o código; texto = valida. */
function validarCodigoBarras(v) {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === '') return null;
  const c = String(v).trim();
  if (!CODIGO_RE.test(c)) throw erro(400, 'Código de barras inválido (4 a 32 letras, algarismos, ponto ou hífen)');
  if (/^(\d{8}|\d{12}|\d{13})$/.test(c) && !eanValido(c)) throw erro(400, 'Código de barras com o dígito de controlo errado: confirme a leitura');
  return c;
}

/** Quantidade de uma linha de venda: inteira (1–1000) ou, ao peso, em kg com até 3 casas (0,001–999,999). */
function validarQuantidade(q, aoPeso, nome = 'produto') {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) throw erro(400, `Quantidade inválida para ${nome}`);
  if (aoPeso) {
    if (n > PESO_MAX || Math.abs(Math.round(n * 1000) - n * 1000) > 1e-6) throw erro(400, `Peso inválido para ${nome} (até ${PESO_MAX} kg, ao grama)`);
    return Math.round(n * 1000) / 1000;
  }
  if (!Number.isInteger(n) || n > QTD_MAX) throw erro(400, `Quantidade inválida para ${nome} (1 a ${QTD_MAX} unidades)`);
  return n;
}

function traduzirUnico(e) {
  if (e && e.code === '23505' && String(e.constraint || '').includes('codigo_barras')) return erro(409, 'Este código de barras já está noutro produto deste estabelecimento');
  return e;
}

async function listar({ tenantId }) {
  const r = await pool.query(`SELECT * FROM produtos WHERE ($1::uuid IS NULL OR tenant_id = $1) ORDER BY categoria, nome`, [tenantId || null]);
  return r.rows;
}

function validarPreco(preco) {
  const n = parseFloat(preco);
  if (isNaN(n) || n < 0) throw erro(400, 'preco inválido');
  return n;
}

async function criar({ tenantId, nome, descricao, preco, categoria, disponivel, vendido_ao_peso, codigo_barras }) {
  if (!nome || preco === undefined) throw erro(400, 'nome e preco são obrigatórios');
  const precoNum = validarPreco(preco);
  const codigo = validarCodigoBarras(codigo_barras);
  await listas.exigirValor(tenantId, 'CATEGORIA_PRODUTO', categoria, 'Categoria');
  try {
    const r = await pool.query(
      `INSERT INTO produtos (tenant_id, nome, descricao, preco, categoria, disponivel, ativo, vendido_ao_peso, codigo_barras, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,NOW()) RETURNING *`,
      [tenantId || null, String(nome).trim(), descricao || null, precoNum, categoria || null, disponivel !== false, vendido_ao_peso === true, codigo || null]);
    return r.rows[0];
  } catch (e) { throw traduzirUnico(e); }
}

async function actualizar({ tenantId, id, nome, descricao, preco, categoria, disponivel, ativo, vendido_ao_peso, codigo_barras }) {
  if (categoria) {
    const at = await pool.query(`SELECT categoria FROM produtos WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`, [id, tenantId || null]);
    if (!at.rows[0] || at.rows[0].categoria !== categoria) await listas.exigirValor(tenantId, 'CATEGORIA_PRODUTO', categoria, 'Categoria');
  }
  const codigo = validarCodigoBarras(codigo_barras);
  try {
    const r = await pool.query(
      `UPDATE produtos SET
         nome = COALESCE($1, nome), descricao = COALESCE($2, descricao), preco = COALESCE($3, preco),
         categoria = COALESCE($4, categoria), disponivel = COALESCE($5, disponivel), ativo = COALESCE($6, ativo),
         vendido_ao_peso = COALESCE($9, vendido_ao_peso),
         codigo_barras = CASE WHEN $10::boolean THEN $11 ELSE codigo_barras END,
         atualizado_em = NOW()
       WHERE id = $7 AND ($8::uuid IS NULL OR tenant_id = $8) RETURNING *`,
      [nome || null, descricao || null, preco !== undefined ? validarPreco(preco) : null, categoria || null,
        disponivel !== undefined ? disponivel : null, ativo !== undefined ? ativo : null, id, tenantId || null,
        typeof vendido_ao_peso === 'boolean' ? vendido_ao_peso : null, codigo !== undefined, codigo === undefined ? null : codigo]);
    if (!r.rows[0]) throw erro(404, 'Produto não encontrado');
    return r.rows[0];
  } catch (e) { throw traduzirUnico(e); }
}

/** Produto disponível pelo código de barras (leitor no painel de venda). */
async function porCodigo({ tenantId, codigo }) {
  const c = String(codigo || '').trim();
  if (!c || c.length > 32) throw erro(400, 'Código de barras inválido');
  const r = await pool.query(
    `SELECT * FROM produtos WHERE tenant_id = $1 AND codigo_barras = $2 AND ativo = true`, [tenantId, c]);
  if (!r.rows[0]) throw erro(404, `Nenhum produto com o código ${c}`);
  if (!r.rows[0].disponivel) throw erro(409, `${r.rows[0].nome} está indisponível`);
  return r.rows[0];
}

/** Gera um EAN-13 interno (começa por 2) único no estabelecimento e grava-o no produto que ainda não tem código. */
async function gerarCodigo({ tenantId, id }) {
  const p = await pool.query(`SELECT id, codigo_barras FROM produtos WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!p.rows[0]) throw erro(404, 'Produto não encontrado');
  if (p.rows[0].codigo_barras) throw erro(409, 'O produto já tem código de barras. Para gerar outro, apague primeiro o actual.');
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const corpo = '2' + String(crypto.randomInt(0, 1e11)).padStart(11, '0');
    const codigo = corpo + digitoControlo(corpo);
    try {
      const r = await pool.query(`UPDATE produtos SET codigo_barras = $3, atualizado_em = NOW() WHERE id = $1 AND tenant_id = $2 AND codigo_barras IS NULL RETURNING *`, [id, tenantId, codigo]);
      if (!r.rows[0]) throw erro(409, 'O produto já tem código de barras');
      return r.rows[0];
    } catch (e) { if (!(e.code === '23505')) throw e; }
  }
  throw erro(503, 'Não foi possível gerar um código livre. Tente novamente.');
}

module.exports = { listar, criar, actualizar, porCodigo, gerarCodigo, validarCodigoBarras, validarQuantidade, digitoControlo, eanValido, PESO_MAX, QTD_MAX };
