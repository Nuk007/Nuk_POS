'use strict';
/**
 * Balcão (regra do dono, 20/11/2026): o Balcão só vende bebidas, piscina e a estadia dos quartos. As categorias de
 * produto que o Balcão vende escolhem-se em Configurações (chave `balcao_categorias`, JSON); por omissão Bebida,
 * Cocktail e Piscina. A estadia vende-se pelos botões dos quartos (quartos-vendas.service), não como produto.
 */
const { pool } = require('../db');
const { erro } = require('./shared');
const listas = require('./listas.service');

const PADRAO = ['BEBIDA', 'COCKTAIL', 'PISCINA'];
const CHAVE = 'balcao_categorias';

/** Categorias de produto que o Balcão vende neste estabelecimento (MAIÚSCULAS). */
async function categorias(db, tenantId) {
  const r = await (db || pool).query(`SELECT valor FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
  if (!r.rows[0]) return [...PADRAO];
  try {
    const v = JSON.parse(r.rows[0].valor);
    return Array.isArray(v) ? v.map(x => String(x).toUpperCase()) : [...PADRAO];
  } catch { return [...PADRAO]; }
}

/** Só ADMIN (a rota garante): grava a lista; cada categoria tem de existir nas categorias activas do estabelecimento. */
async function definir({ tenantId, categorias: lista }) {
  if (!Array.isArray(lista) || !lista.length) throw erro(400, 'Escolha pelo menos uma categoria para o Balcão');
  if (lista.length > 30) throw erro(400, 'Demasiadas categorias');
  const vals = [...new Set(lista.map(x => String(x || '').trim().toUpperCase()).filter(Boolean))];
  for (const v of vals) await listas.exigirValor(tenantId, 'CATEGORIA_PRODUTO', v, 'Categoria');
  await pool.query(
    `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = $3, atualizado_em = NOW()`, [tenantId, CHAVE, JSON.stringify(vals)]);
  return { categorias: vals };
}

module.exports = { categorias, definir, PADRAO };
