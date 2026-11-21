'use strict';
/**
 * Folha de Caixa diária (21/11/2026) — a folha em papel do Clube 3D Resort passada para o sistema, igual para todos
 * os estabelecimentos. Junta num só documento o dia de Luanda:
 *   A  abertura (fundo inicial da primeira sessão de caixa do dia)
 *   B  compras/saídas por área (compras pontuais + despesas do dia, não anuladas); C pagas por banco, D pagas pela gaveta
 *   E  outras vendas · F bebidas · G comidas · H piscina · I quartos (consumos SERVICO_QUARTO + alojamento do dia)
 *   J  entradas em dinheiro na gaveta · K entradas por banco (TPA, transferência, Express)
 *   Fecho calculado = A + J − D (é o esperado na gaveta); Fecho declarado = contagem da última sessão fechada do dia.
 * Vendas = pedidos pagos no dia (`vendaPaga`), como nas Finanças. Nada fixo no código: o grupo de cada categoria de
 * produto e a área de cada categoria de stock/despesa configuram-se (chave `folha_caixa` em `configuracoes`).
 */
const { pool } = require('../db');
const { erro, vendaPaga } = require('./shared');
const listas = require('./listas.service');

const N = v => Number(v || 0);
const arred = v => Math.round(v * 100) / 100;
const hojeLuanda = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
const NO_DIA = col => `(${col} AT TIME ZONE 'Africa/Luanda')::date = $2::date`;
const CHAVE = 'folha_caixa';

const GRUPOS = ['BEBIDAS', 'COMIDAS', 'PISCINA', 'QUARTOS', 'OUTROS'];
const LETRA = { OUTROS: 'E', BEBIDAS: 'F', COMIDAS: 'G', PISCINA: 'H', QUARTOS: 'I' };
const BANCO = ['TPA', 'TRANSFERENCIA', 'EXPRESS'];
const PADRAO = {
  // categoria de produto → grupo da folha (o que não estiver aqui conta como COMIDAS)
  grupos: { BEBIDA: 'BEBIDAS', COCKTAIL: 'BEBIDAS', PISCINA: 'PISCINA', LAZER: 'PISCINA', SERVICO_QUARTO: 'QUARTOS',
    SHISHA: 'OUTROS', CIGARROS: 'OUTROS', LOJA: 'OUTROS', OUTRO: 'OUTROS' },
  // categoria de stock → área (compras sem área escolhida); o resto → DIVERSOS
  areas_stock: { BEBIDA: 'ESPLANADA_BAR', CARNE: 'COZINHA', PEIXE: 'COZINHA', VEGETAL: 'COZINHA', TEMPERO: 'COZINHA', CARVAO: 'COZINHA', LIMPEZA: 'HOTEL' },
  // categoria de despesa → área (despesas sem área escolhida); o resto → DIVERSOS
  areas_despesa: { ENERGIA: 'TECNICA', AGUA: 'TECNICA', MANUTENCAO: 'TECNICA', COMBUSTIVEL: 'DIVERSOS' },
};

function validarDia(dia) {
  if (dia === undefined || dia === null || dia === '') return hojeLuanda();
  const s = String(dia);
  const d = new Date(s + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(d.getTime()) || !d.toISOString().startsWith(s)) throw erro(400, 'Dia inválido (use AAAA-MM-DD)');
  if (s > hojeLuanda()) throw erro(400, 'O dia não pode ser no futuro');
  return s;
}

/** Configuração em vigor (a gravada sobre o padrão; JSON estragado → padrão). */
async function lerConfig(tenantId) {
  const r = await pool.query(`SELECT valor FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
  let g = {};
  try { g = r.rows[0] ? JSON.parse(r.rows[0].valor) || {} : {}; } catch { g = {}; }
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  return {
    grupos: obj(g.grupos) || PADRAO.grupos,
    areas_stock: obj(g.areas_stock) || PADRAO.areas_stock,
    areas_despesa: obj(g.areas_despesa) || PADRAO.areas_despesa,
    configurado: !!r.rows[0],
  };
}

/** Só ADMIN (a rota garante). `null` repõe o padrão. Valida grupos e áreas contra as listas do estabelecimento. */
async function guardarConfig({ tenantId, grupos, areas_stock, areas_despesa, repor }) {
  if (repor === true) {
    await pool.query(`DELETE FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
    return { ...(await lerConfig(tenantId)), padrao: PADRAO };
  }
  const actual = await lerConfig(tenantId);
  const mapa = (v, nome) => {
    if (v === undefined) return undefined;
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 100) throw erro(400, `${nome}: indique um objecto categoria → valor`);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [String(k).toUpperCase().slice(0, 30), String(x).toUpperCase().slice(0, 30)]));
  };
  const g = mapa(grupos, 'Grupos'), as = mapa(areas_stock, 'Áreas do stock'), ad = mapa(areas_despesa, 'Áreas das despesas');
  if (g) for (const v of Object.values(g)) if (!GRUPOS.includes(v)) throw erro(400, `Grupo inválido: "${v}" (use ${GRUPOS.join(', ')})`);
  for (const m of [as, ad]) if (m) for (const v of Object.values(m)) await listas.exigirValor(tenantId, 'AREA_SAIDA', v, 'Área');
  const novo = { grupos: g || actual.grupos, areas_stock: as || actual.areas_stock, areas_despesa: ad || actual.areas_despesa };
  await pool.query(
    `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = $3, atualizado_em = NOW()`, [tenantId, CHAVE, JSON.stringify(novo)]);
  return { ...novo, configurado: true, padrao: PADRAO };
}

/** Folha de Caixa de um dia de Luanda. */
async function gerar({ tenantId, dia }) {
  const d = validarDia(dia);
  const v = [tenantId, d];
  const cfg = await lerConfig(tenantId);
  const [sessoes, compras, despesas, itens, pedidos, aloj, movs, quebras, credito, porReceber] = await Promise.all([
    pool.query(`SELECT id, aberta_em, fundo_inicial, fechada_em, esperado, contado, diferenca FROM caixa_sessoes
                 WHERE tenant_id = $1 AND ${NO_DIA('aberta_em')} ORDER BY aberta_em`, v),
    pool.query(`SELECT c.criado_em, c.quantidade, c.valor_total, c.area, c.fornecedor, c.fornecedor_nif, c.documento, s.nome, s.unidade, s.categoria
                  FROM compras_pontuais c JOIN stock_items s ON s.id = c.stock_item_id
                 WHERE c.tenant_id = $1 AND c.anulada_em IS NULL AND ${NO_DIA('c.criado_em')} ORDER BY c.criado_em`, v),
    pool.query(`SELECT categoria, descricao, valor, area, pela_gaveta FROM despesas
                 WHERE tenant_id = $1 AND anulada_em IS NULL AND data = $2::date ORDER BY criado_em`, v),
    pool.query(`SELECT pr.nome, pr.categoria, ip.preco_unitario AS preco, SUM(ip.quantidade) AS qtd, SUM(ip.quantidade * ip.preco_unitario) AS valor
                  FROM itens_pedido ip JOIN pedidos pd ON pd.id = ip.pedido_id JOIN produtos pr ON pr.id = ip.produto_id
                 WHERE pd.tenant_id = $1 AND ${vendaPaga('pd')} AND ${NO_DIA('pd.pago_em')}
                 GROUP BY pr.nome, pr.categoria, ip.preco_unitario ORDER BY pr.categoria, pr.nome`, v),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS total FROM pedidos WHERE tenant_id = $1 AND ${vendaPaga()} AND ${NO_DIA('pago_em')}`, v),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(rv.valor_total),0) AS valor FROM reservas rv JOIN quartos q ON q.id = rv.quarto_id
                 WHERE q.tenant_id = $1 AND rv.status <> 'CANCELADA' AND ${NO_DIA('rv.criado_em')}`, v),
    pool.query(`SELECT tipo, metodo, COALESCE(SUM(valor),0) AS valor FROM caixa_movimentos
                 WHERE tenant_id = $1 AND ${NO_DIA('criado_em')} GROUP BY tipo, metodo`, v),
    pool.query(`SELECT s.nome, s.unidade, SUM(ABS(m.quantidade)) AS qtd, COALESCE(SUM(ABS(m.quantidade) * s.custo_unitario),0) AS valor,
                       BOOL_OR(s.custo_unitario IS NULL) AS sem_custo, STRING_AGG(DISTINCT m.motivo, '; ') AS motivos
                  FROM movimentos_stock m JOIN stock_items s ON s.id = m.stock_item_id
                 WHERE s.tenant_id = $1 AND m.tipo = 'DESPERDICIO' AND ${NO_DIA('m.criado_em')} GROUP BY s.nome, s.unidade ORDER BY s.nome`, v),
    pool.query(`SELECT COALESCE(SUM(valor),0) AS valor FROM conta_corrente_movimentos
                 WHERE tenant_id = $1 AND tipo = 'DEBITO' AND ${NO_DIA('criado_em')}`, v),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS valor FROM pedidos
                 WHERE tenant_id = $1 AND status <> 'CANCELADO' AND pago_em IS NULL AND perda_em IS NULL AND total > 0 AND ${NO_DIA('criado_em')}`, v),
  ]);

  // ── Compras / saídas (B, C, D) ──────────────────────────────
  const saidas = [];
  for (const c of compras.rows) {
    saidas.push({ origem: 'COMPRA', area: c.area || cfg.areas_stock[c.categoria] || 'DIVERSOS',
      descricao: `${c.nome} (${N(c.quantidade)} ${c.unidade})${c.fornecedor ? ` — ${c.fornecedor}` : ''}${c.documento ? ` · ${c.documento}` : ''}`,
      fornecedor: c.fornecedor, fornecedor_nif: c.fornecedor_nif, documento: c.documento, valor: arred(N(c.valor_total)), pago: 'CAIXA' });
  }
  for (const x of despesas.rows) {
    saidas.push({ origem: 'DESPESA', area: x.area || cfg.areas_despesa[x.categoria] || 'DIVERSOS', descricao: x.descricao,
      valor: arred(N(x.valor)), pago: x.pela_gaveta ? 'CAIXA' : 'BANCO' });
  }
  const porArea = {};
  for (const s of saidas) porArea[s.area] = arred(N(porArea[s.area]) + s.valor);
  const B = arred(saidas.reduce((a, s) => a + s.valor, 0));
  const D = arred(saidas.filter(s => s.pago === 'CAIXA').reduce((a, s) => a + s.valor, 0));
  const C = arred(B - D);

  // ── Vendas por grupo (E..I) ─────────────────────────────────
  const grupos = Object.fromEntries(GRUPOS.map(g => [g, { letra: LETRA[g], linhas: [], total: 0 }]));
  let somaItens = 0;
  for (const x of itens.rows) {
    const g = grupos[cfg.grupos[x.categoria] || 'COMIDAS'] || grupos.COMIDAS;
    const valor = arred(N(x.valor));
    g.linhas.push({ produto: x.nome, categoria: x.categoria, preco: N(x.preco), quantidade: N(x.qtd), valor });
    g.total = arred(g.total + valor);
    somaItens += valor;
  }
  const alojamento = arred(N(aloj.rows[0].valor));
  if (alojamento > 0) {
    grupos.QUARTOS.linhas.push({ produto: `Alojamento (${aloj.rows[0].n} reserva/s)`, categoria: 'ALOJAMENTO', preco: null, quantidade: aloj.rows[0].n, valor: alojamento });
    grupos.QUARTOS.total = arred(grupos.QUARTOS.total + alojamento);
  }
  const descontos = arred(somaItens - N(pedidos.rows[0].total)); // descontos/campanhas aplicados nas contas
  const totalVendas = arred(N(pedidos.rows[0].total) + alojamento);

  // ── Entradas (J dinheiro, K banco) ─────────────────────────
  const entradas = { dinheiro: {}, banco: {}, prepagos: {} };
  let J = 0, K = 0, saidasGaveta = 0;
  for (const m of movs.rows) {
    const val = N(m.valor);
    if (val < 0) { if (m.metodo === 'CASH') saidasGaveta += -val; continue; }
    const alvo = m.metodo === 'CASH' ? 'dinheiro' : BANCO.includes(m.metodo) ? 'banco' : 'prepagos';
    entradas[alvo][m.tipo] = arred(N(entradas[alvo][m.tipo]) + val);
    if (alvo === 'dinheiro') J += val; else if (alvo === 'banco') K += val;
  }
  J = arred(J); K = arred(K);

  const primeira = sessoes.rows[0];
  const fechadas = sessoes.rows.filter(s => s.fechada_em);
  const ultimaFechada = fechadas[fechadas.length - 1];
  const A = primeira ? arred(N(primeira.fundo_inicial)) : 0;
  const fechoCalculado = arred(A + J - arred(saidasGaveta));
  const fechoDeclarado = ultimaFechada && ultimaFechada.contado !== null ? arred(N(ultimaFechada.contado)) : null;

  const alertas = [];
  if (!primeira) alertas.push('Não houve abertura de caixa neste dia (A = 0).');
  if (sessoes.rows.length > 1) alertas.push(`Houve ${sessoes.rows.length} sessões de caixa no dia: A é o fundo da primeira e o fecho declarado a contagem da última.`);
  if (sessoes.rows.some(s => !s.fechada_em)) alertas.push('O caixa ainda está aberto: a folha é provisória.');
  if (fechoDeclarado !== null && Math.abs(fechoDeclarado - fechoCalculado) >= 0.01) alertas.push(`O dinheiro contado (${fechoDeclarado}) difere do calculado (${fechoCalculado}).`);
  if (porReceber.rows[0].n) alertas.push(`${porReceber.rows[0].n} conta(s) do dia ainda por receber (${N(porReceber.rows[0].valor)} Kz) não entram nas vendas.`);
  if (saidasGaveta - D > 0.009) alertas.push('Há saídas da gaveta sem compra/despesa do dia associada (anulações ou movimentos de outros dias).');
  const quebrasSemCusto = quebras.rows.filter(q => q.sem_custo).map(q => q.nome);
  if (quebrasSemCusto.length) alertas.push(`Quebras sem custo de stock: ${quebrasSemCusto.join(', ')}.`);

  return {
    dia: d,
    numero: Number(d.replace(/-/g, '')),
    abertura: { A, sessoes: sessoes.rows.length },
    saidas: { linhas: saidas, por_area: porArea, B, C, D, total: arred(C + D) },
    vendas: {
      grupos,
      E: grupos.OUTROS.total, F: grupos.BEBIDAS.total, G: grupos.COMIDAS.total, H: grupos.PISCINA.total, I: grupos.QUARTOS.total,
      descontos, total: totalVendas, pedidos: pedidos.rows[0].n, a_credito: arred(N(credito.rows[0].valor)),
    },
    entradas: { ...entradas, J, K },
    quebras: { linhas: quebras.rows.map(q => ({ item: q.nome, unidade: q.unidade, quantidade: N(q.qtd), valor: arred(N(q.valor)), motivo: q.motivos })),
      total: arred(quebras.rows.reduce((a, q) => a + N(q.valor), 0)) },
    fecho: { calculado: fechoCalculado, declarado: fechoDeclarado, diferenca: fechoDeclarado === null ? null : arred(fechoDeclarado - fechoCalculado) },
    por_receber: { n: porReceber.rows[0].n, valor: arred(N(porReceber.rows[0].valor)) },
    alertas,
  };
}

module.exports = { gerar, lerConfig, guardarConfig, validarDia, PADRAO, GRUPOS };
