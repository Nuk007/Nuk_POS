'use strict';
/**
 * Modelo da Folha de Caixa em branco (21/11/2026, pedido do dono: o modelo do Clube 3D fica no sistema e cada
 * estabelecimento ajusta-o com os seus dados, acrescentando ou retirando itens). Configura-se em Configurações →
 * «Configuração de relatórios». Guardado na chave `folha_caixa_modelo` (JSON) de `configuracoes`.
 *
 * Sem modelo gravado, o padrão é feito a partir da ementa do estabelecimento: produtos activos agrupados pelos grupos
 * da Folha de Caixa (configuração `folha_caixa`, ver folha-caixa.service), com o preço de venda. Os dados do
 * cabeçalho (nome, morada, NIF, telefone) vêm sempre das Configurações principais (`tenantInfo`).
 */
const { pool } = require('../db');
const { erro } = require('./shared');
const folha = require('./folha-caixa.service');

const CHAVE = 'folha_caixa_modelo';
const ORDEM = ['BEBIDAS', 'COMIDAS', 'PISCINA', 'QUARTOS', 'OUTROS']; // F, G, H, I, E
const LETRA = { BEBIDAS: 'F', COMIDAS: 'G', PISCINA: 'H', QUARTOS: 'I', OUTROS: 'E' };
const NOMES = { BEBIDAS: 'Bebidas', COMIDAS: 'Comidas', PISCINA: 'Piscina', QUARTOS: 'Quartos', OUTROS: 'Shishas, cigarros e diversas' };
const LIMITES = { itensGrupo: 40, itensTotal: 120, brancos: 10, areasBrancos: 5, assinaturas: 4 };
const ASSINATURAS = ['Entregou', 'Recebeu', 'Verificou'];

const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Proposta a partir da ementa (não grava). */
async function daEmenta(tenantId) {
  const cfg = await folha.lerConfig(tenantId);
  const r = await pool.query(
    `SELECT nome, categoria, preco FROM produtos WHERE tenant_id = $1 AND COALESCE(ativo, true) ORDER BY categoria, nome LIMIT 400`, [tenantId]);
  const grupos = ORDEM.map(g => ({ grupo: g, letra: LETRA[g], nome: NOMES[g], itens: [], brancos: 3 }));
  const por = Object.fromEntries(grupos.map(g => [g.grupo, g]));
  for (const p of r.rows) {
    const g = por[cfg.grupos[p.categoria] || 'COMIDAS'] || por.COMIDAS;
    if (g.itens.length < LIMITES.itensGrupo) g.itens.push({ nome: texto(p.nome, 40), preco: Number(p.preco) });
  }
  for (const g of grupos) if (!g.itens.length) g.brancos = 5;
  return { titulo: 'Folha de Caixa', grupos, areas_brancos: 2, controlo: true, assinaturas: [...ASSINATURAS] };
}

/** Modelo em vigor: o gravado (validado de novo; estragado → padrão) ou o padrão da ementa. */
async function ler(tenantId) {
  const r = await pool.query(`SELECT valor FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
  if (r.rows[0]) {
    try { return { ...normalizar(JSON.parse(r.rows[0].valor)), configurado: true }; } catch { /* JSON estragado → padrão */ }
  }
  return { ...(await daEmenta(tenantId)), configurado: false };
}

/** Valida e limpa um modelo vindo do ecrã. Lança 400 com a razão. */
function normalizar(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw erro(400, 'Modelo inválido');
  const titulo = texto(m.titulo || 'Folha de Caixa', 60) || 'Folha de Caixa';
  if (!Array.isArray(m.grupos)) throw erro(400, 'Indique os grupos de vendas');
  const recebidos = Object.fromEntries(m.grupos.filter(g => g && ORDEM.includes(g.grupo)).map(g => [g.grupo, g]));
  let total = 0;
  const grupos = ORDEM.map(g => {
    const x = recebidos[g] || {};
    const itens = Array.isArray(x.itens) ? x.itens : [];
    if (itens.length > LIMITES.itensGrupo) throw erro(400, `${NOMES[g]}: no máximo ${LIMITES.itensGrupo} itens`);
    const limpos = itens.map((i, n) => {
      const nome = texto(i && i.nome, 40);
      if (!nome) throw erro(400, `${NOMES[g]}: o item ${n + 1} não tem nome`);
      let preco = i.preco;
      if (preco === '' || preco === undefined || preco === null) preco = null;
      else {
        preco = Number(preco);
        if (!Number.isFinite(preco) || preco < 0 || preco > 10000000) throw erro(400, `${NOMES[g]}: preço inválido em «${nome}»`);
        preco = Math.round(preco * 100) / 100;
      }
      return { nome, preco };
    });
    total += limpos.length;
    const brancos = Number.isInteger(Number(x.brancos)) ? Number(x.brancos) : 3;
    if (brancos < 0 || brancos > LIMITES.brancos) throw erro(400, `${NOMES[g]}: linhas em branco de 0 a ${LIMITES.brancos}`);
    return { grupo: g, letra: LETRA[g], nome: texto(x.nome, 40) || NOMES[g], itens: limpos, brancos, oculto: x.oculto === true };
  });
  if (total > LIMITES.itensTotal) throw erro(400, `No máximo ${LIMITES.itensTotal} itens na folha`);
  const ab = m.areas_brancos === undefined ? 2 : Number(m.areas_brancos);
  if (!Number.isInteger(ab) || ab < 1 || ab > LIMITES.areasBrancos) throw erro(400, `Linhas por área de 1 a ${LIMITES.areasBrancos}`);
  const assin = m.assinaturas === undefined ? [...ASSINATURAS] : m.assinaturas;
  if (!Array.isArray(assin) || assin.length > LIMITES.assinaturas) throw erro(400, `No máximo ${LIMITES.assinaturas} assinaturas`);
  const assinaturas = assin.map(a => texto(a, 20)).filter(Boolean);
  return { titulo, grupos, areas_brancos: ab, controlo: m.controlo !== false, assinaturas };
}

async function guardar({ tenantId, modelo, repor }) {
  if (repor === true) {
    await pool.query(`DELETE FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
    return ler(tenantId);
  }
  const m = normalizar(modelo);
  await pool.query(
    `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = $3, atualizado_em = NOW()`, [tenantId, CHAVE, JSON.stringify(m)]);
  return { ...m, configurado: true };
}

/** Áreas activas da lista AREA_SAIDA do estabelecimento (para as linhas das saídas). */
async function areasActivas(tenantId) {
  const listas = require('./listas.service');
  const l = await listas.listar({ tenantId, lista: 'AREA_SAIDA', incluirInactivos: false });
  const activas = (Array.isArray(l) ? l : []).filter(o => o.ativo).map(o => o.valor);
  return activas.length ? activas : listas.DEFAULTS.AREA_SAIDA;
}

module.exports = { ler, guardar, daEmenta, normalizar, areasActivas, ORDEM, LIMITES };
