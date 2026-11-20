'use strict';
/**
 * O que cada fluxo de venda pode vender (categorias de produto), escolhido pelo Administrador em
 * Configurações → «🧾 O que cada fluxo vende» (pedido do dono, 21/11/2026: nenhuma regra fixa no código).
 *
 * Fluxos configuráveis e o que acontece sem configuração (comportamento de antes, para não mudar nada a ninguém):
 *  - BALCAO   → Bebida, Cocktail e Piscina (regra do dono de 20/11/2026; a estadia vende-se pelos quartos);
 *  - TAKEAWAY → só comidas e bebidas: fora shisha, «outro», lazer, piscina, loja, tabaco e serviços de quarto;
 *  - LAZER    → Lazer;
 *  - LOJA     → Loja e Cigarros.
 * Mesa, Remota e Quarto não se configuram aqui (a mesa nunca vende serviços de quarto — regra do dono).
 * Grava-se em `configuracoes` (JSON), uma chave por fluxo.
 */
const { pool } = require('../db');
const { erro } = require('./shared');
const listas = require('./listas.service');

const NAO_TAKEAWAY = /^(SHISHA|OUTRO|LAZER)$|LOJA|CIGARR|TABAC|SERVIC|QUARTO|PISCINA/;

const FLUXOS = {
  BALCAO:   { chave: 'balcao_categorias',   nome: 'Balcão',    artigo: 'O Balcão',    padrao: ['BEBIDA', 'COCKTAIL', 'PISCINA'] },
  TAKEAWAY: { chave: 'takeaway_categorias', nome: 'Take Away', artigo: 'O Take Away', padrao: null, regraPadrao: c => !NAO_TAKEAWAY.test(c) },
  LAZER:    { chave: 'lazer_categorias',    nome: 'Lazer',     artigo: 'O Lazer',     padrao: ['LAZER'] },
  LOJA:     { chave: 'loja_categorias',     nome: 'Loja',      artigo: 'A Loja',      padrao: ['LOJA', 'CIGARROS'] },
};
const MENSAGEM_PADRAO = {
  TAKEAWAY: 'O Take Away é só para comidas e bebidas',
  LAZER: 'O Lazer só vende produtos de lazer',
  LOJA: 'A Loja só vende produtos da loja e cigarros',
};

const rotulo = c => c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, ' ');
const maiusc = c => String(c || '').trim().toUpperCase();

function validarFluxo(fluxo) {
  const f = FLUXOS[maiusc(fluxo)];
  if (!f) throw erro(400, `Fluxo de venda inválido. Use: ${Object.keys(FLUXOS).join(', ')}`);
  return f;
}

async function lerConfigurado(db, tenantId, chave) {
  const r = await (db || pool).query(`SELECT valor FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, chave]);
  if (!r.rows[0]) return null;
  try {
    const v = JSON.parse(r.rows[0].valor);
    return Array.isArray(v) && v.length ? v.map(maiusc) : null;
  } catch { return null; }
}

/**
 * Regra de um fluxo: `{ fluxo, configurado, categorias, permite(cat), mensagem }`.
 * Sem configuração do Take Away, `categorias` são as categorias activas que cumprem a regra antiga.
 */
async function regra(db, tenantId, fluxo) {
  const nome = maiusc(fluxo);
  const f = validarFluxo(nome);
  const conf = await lerConfigurado(db, tenantId, f.chave);
  if (conf) {
    return { fluxo: nome, configurado: true, categorias: conf, permite: c => conf.includes(maiusc(c)),
      mensagem: `${f.artigo} só vende: ${conf.map(rotulo).join(', ')}.` };
  }
  let cats = f.padrao;
  if (!cats) {
    const activas = tenantId ? await listas.listar({ tenantId, lista: 'CATEGORIA_PRODUTO', incluirInactivos: false }) : [];
    cats = activas.map(o => maiusc(o.valor)).filter(f.regraPadrao);
  }
  return { fluxo: nome, configurado: false, categorias: [...cats],
    permite: f.padrao ? c => f.padrao.includes(maiusc(c)) : c => f.regraPadrao(maiusc(c)),
    mensagem: MENSAGEM_PADRAO[nome] || `${f.artigo} só vende: ${cats.map(rotulo).join(', ')}.` };
}

/** Categorias de um fluxo (MAIÚSCULAS). */
async function categorias(db, tenantId, fluxo) { return (await regra(db, tenantId, fluxo)).categorias; }

/** Todas as regras, para o painel de venda e para as Configurações: `{ BALCAO: { categorias, configurado }, … }`. */
async function todas(tenantId) {
  const out = {};
  for (const f of Object.keys(FLUXOS)) {
    const r = await regra(null, tenantId, f);
    out[f] = { nome: FLUXOS[f].nome, categorias: r.categorias, configurado: r.configurado };
  }
  return out;
}

/** Só ADMIN (a rota garante). Cada categoria tem de estar activa no estabelecimento. `categorias: null` repõe o padrão. */
async function definir({ tenantId, fluxo, categorias: lista }) {
  const nome = maiusc(fluxo);
  const f = validarFluxo(nome);
  if (lista === null) {
    await pool.query(`DELETE FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, f.chave]);
    return { fluxo: nome, ...(await todas(tenantId))[nome] };
  }
  if (!Array.isArray(lista) || !lista.length) throw erro(400, `Escolha pelo menos uma categoria para ${f.artigo.replace(/^(O|A) /, (m, a) => (a === 'O' ? 'o ' : 'a '))}`);
  if (lista.length > 30) throw erro(400, 'Demasiadas categorias');
  const vals = [...new Set(lista.map(maiusc).filter(Boolean))];
  for (const v of vals) await listas.exigirValor(tenantId, 'CATEGORIA_PRODUTO', v, 'Categoria');
  await pool.query(
    `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = $3, atualizado_em = NOW()`, [tenantId, f.chave, JSON.stringify(vals)]);
  return { fluxo: nome, nome: f.nome, categorias: vals, configurado: true };
}

module.exports = { regra, categorias, todas, definir, FLUXOS, NAO_TAKEAWAY };
