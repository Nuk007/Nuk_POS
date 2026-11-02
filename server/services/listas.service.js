'use strict';
/**
 * ListasService — listas de opções configuráveis por estabelecimento (tipos de quarto, categorias de produto,
 * categorias e unidades de stock). Cada tenant recebe os valores padrão na primeira leitura e depois edita-os.
 */
const { pool } = require('../db');
const { erro } = require('./shared');

const DEFAULTS = {
  TIPO_QUARTO: ['STANDARD', 'SUPERIOR', 'SUITE', 'SUITE_PRESIDENCIAL', 'VIP_EXECUTIVO'],
  CATEGORIA_PRODUTO: ['CHURRASCO', 'PEIXE', 'BEBIDA', 'SOBREMESA', 'ACOMPANHAMENTO', 'COCKTAIL', 'ENTRADA', 'SHISHA', 'PRATO', 'OUTRO'],
  CATEGORIA_STOCK: ['CARNE', 'PEIXE', 'VEGETAL', 'TEMPERO', 'BEBIDA', 'CARVAO', 'LIMPEZA', 'OUTRO'],
  UNIDADE_STOCK: ['un', 'kg', 'g', 'L', 'ml'],
};
// Onde cada lista é usada (para impedir apagar valores em uso)
const USO = {
  TIPO_QUARTO: ['quartos', 'tipo'],
  CATEGORIA_PRODUTO: ['produtos', 'categoria'],
  CATEGORIA_STOCK: ['stock_items', 'categoria'],
  UNIDADE_STOCK: ['stock_items', 'unidade'],
};
const NOMES = { TIPO_QUARTO: 'Tipos de quarto', CATEGORIA_PRODUTO: 'Categorias de produto', CATEGORIA_STOCK: 'Categorias de stock', UNIDADE_STOCK: 'Unidades de stock' };

function validarLista(lista) {
  if (!DEFAULTS[lista]) throw erro(404, 'Lista desconhecida');
}

/** Normaliza o que o administrador escreve: unidades ficam como escritas; o resto em MAIÚSCULAS_COM_SUBLINHADO. */
function normalizar(lista, texto) {
  let v = String(texto ?? '').trim();
  if (lista === 'UNIDADE_STOCK') v = v.replace(/\s+/g, '');
  else v = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const max = lista === 'UNIDADE_STOCK' ? 10 : 30;
  if (!v) throw erro(400, 'Indique um nome');
  if (v.length > max) throw erro(400, `Nome demasiado longo (máx. ${max} caracteres)`);
  return v;
}

async function garantirPadroes(tenantId, lista) {
  const n = await pool.query(`SELECT 1 FROM listas_opcoes WHERE tenant_id=$1 AND lista=$2 LIMIT 1`, [tenantId, lista]);
  if (n.rows[0]) return;
  // inclui também valores já usados por dados existentes (ex.: categorias antigas do tenant)
  const [tab, col] = USO[lista];
  const usados = await pool.query(`SELECT DISTINCT ${col} AS v FROM ${tab} WHERE tenant_id=$1 AND ${col} IS NOT NULL`, [tenantId]); // tab/col vêm de USO (fixo)
  const valores = [...new Set([...DEFAULTS[lista], ...usados.rows.map(r => r.v)])];
  for (let i = 0; i < valores.length; i++) {
    await pool.query(
      `INSERT INTO listas_opcoes (tenant_id, lista, valor, ordem) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [tenantId, lista, valores[i], i]);
  }
}

async function listar({ tenantId, lista, incluirInactivos = true }) {
  validarLista(lista);
  if (!tenantId) return DEFAULTS[lista].map((valor, i) => ({ id: null, lista, valor, ordem: i, ativo: true }));
  await garantirPadroes(tenantId, lista);
  const r = await pool.query(
    `SELECT id, lista, valor, ordem, ativo FROM listas_opcoes
     WHERE tenant_id=$1 AND lista=$2 ${incluirInactivos ? '' : 'AND ativo = true'} ORDER BY ordem, valor`, [tenantId, lista]);
  return r.rows;
}

async function todas({ tenantId }) {
  const out = {};
  for (const l of Object.keys(DEFAULTS)) out[l] = { nome: NOMES[l], opcoes: await listar({ tenantId, lista: l }) };
  return out;
}

/** Garante que `valor` pertence à lista activa do estabelecimento. Valores vazios passam (campo opcional). */
async function exigirValor(tenantId, lista, valor, rotuloCampo) {
  if (valor === undefined || valor === null || valor === '') return;
  const ops = await listar({ tenantId, lista, incluirInactivos: false });
  if (!ops.some(o => o.valor === valor)) throw erro(400, `${rotuloCampo} inválido: "${valor}". Configure-o em Configurações → Listas`);
}

async function criar({ tenantId, lista, nome }) {
  validarLista(lista);
  if (!tenantId) throw erro(400, 'Estabelecimento em falta');
  await garantirPadroes(tenantId, lista);
  const valor = normalizar(lista, nome);
  const ordem = (await pool.query(`SELECT COALESCE(MAX(ordem),0)+1 AS o FROM listas_opcoes WHERE tenant_id=$1 AND lista=$2`, [tenantId, lista])).rows[0].o;
  try {
    return (await pool.query(`INSERT INTO listas_opcoes (tenant_id, lista, valor, ordem) VALUES ($1,$2,$3,$4) RETURNING id, lista, valor, ordem, ativo`, [tenantId, lista, valor, ordem])).rows[0];
  } catch (e) {
    if (e.code === '23505') throw erro(409, `Já existe "${valor}" nesta lista`);
    throw e;
  }
}

/** Activa/desactiva e/ou reordena. Um valor não se renomeia (os dados existentes guardam-no): cria-se outro. */
async function actualizar({ tenantId, lista, id, ativo, ordem }) {
  validarLista(lista);
  const sets = [], vals = [];
  if (ativo !== undefined) { sets.push(`ativo=$${vals.push(!!ativo)}`); }
  if (ordem !== undefined) {
    const o = Number(ordem);
    if (!Number.isInteger(o) || o < 0 || o > 9999) throw erro(400, 'Ordem inválida');
    sets.push(`ordem=$${vals.push(o)}`);
  }
  if (!sets.length) throw erro(400, 'Nada para actualizar');
  vals.push(id, tenantId, lista);
  const r = await pool.query(`UPDATE listas_opcoes SET ${sets.join(', ')} WHERE id=$${vals.length - 2} AND tenant_id=$${vals.length - 1} AND lista=$${vals.length} RETURNING id, lista, valor, ordem, ativo`, vals);
  if (!r.rows[0]) throw erro(404, 'Opção não encontrada');
  return r.rows[0];
}

async function remover({ tenantId, lista, id }) {
  validarLista(lista);
  const o = await pool.query(`SELECT valor FROM listas_opcoes WHERE id=$1 AND tenant_id=$2 AND lista=$3`, [id, tenantId, lista]);
  if (!o.rows[0]) throw erro(404, 'Opção não encontrada');
  const [tab, col] = USO[lista];
  const uso = await pool.query(`SELECT COUNT(*)::int AS n FROM ${tab} WHERE tenant_id=$1 AND ${col}=$2`, [tenantId, o.rows[0].valor]); // tab/col fixos
  if (uso.rows[0].n > 0) throw erro(409, `"${o.rows[0].valor}" está em uso em ${uso.rows[0].n} registo(s) — desactive-o em vez de apagar`);
  await pool.query(`DELETE FROM listas_opcoes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
}

module.exports = { listar, todas, exigirValor, criar, actualizar, remover, normalizar, DEFAULTS, NOMES };
