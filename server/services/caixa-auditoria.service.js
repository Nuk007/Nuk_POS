'use strict';
/**
 * Rastreio do caixa (20/11/2026, regra do dono: todos os movimentos do caixa ficam registados e rastreáveis).
 * Só leitura. O livro `caixa_movimentos` é numerado por estabelecimento, encadeado por SHA-256 e imutável
 * (triggers em server/migrations-data/caixa-auditoria.js); aqui pesquisa-se, exporta-se e verifica-se.
 */
const { pool } = require('../db');
const { erro, buildWhere } = require('./shared');
const { periodo } = require('./relatorios.service');

const TIPOS = ['NUKCOIN_CARREGAMENTO', 'CARTAO_VENDA', 'RECEBIMENTO', 'COMPRA', 'CONTA_PAGAMENTO', 'DESPESA'];
const METODOS = ['CASH', 'TPA', 'TRANSFERENCIA', 'EXPRESS', 'NUKCOIN', 'CARTAO'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normCodigo = c => String(c || '').trim().toUpperCase().replace(/[\s-]/g, '');
const N = v => Number(v || 0);
const arred = n => Math.round(n * 100) / 100;

const SELECT_MOV = `
  SELECT m.id, m.numero, m.criado_em, m.tipo, m.metodo, m.valor, m.descricao, m.sessao_id, m.pedido_id, m.hash,
         f.nome AS operador, s.aberta_em AS sessao_aberta_em,
         cl.nome AS cliente_nome, cc.codigo AS cartao_codigo,
         p.origem, ms.numero AS mesa_numero, q.numero AS quarto_numero,
         si.nome AS compra_item, d.categoria AS despesa_categoria
    FROM caixa_movimentos m
    LEFT JOIN funcionarios f ON f.id = m.criado_por
    LEFT JOIN caixa_sessoes s ON s.id = m.sessao_id
    LEFT JOIN clientes cl ON cl.id = m.cliente_id
    LEFT JOIN cartoes_consumo cc ON cc.id = m.cartao_id
    LEFT JOIN pedidos p ON p.id = m.pedido_id
    LEFT JOIN mesas ms ON ms.id = p.mesa_id
    LEFT JOIN quartos q ON q.id = p.quarto_id
    LEFT JOIN compras_pontuais cp ON cp.id = m.compra_id
    LEFT JOIN stock_items si ON si.id = cp.stock_item_id
    LEFT JOIN despesas d ON d.id = m.despesa_id`;

/** Filtros validados → WHERE parametrizado (período em dias de Luanda; o resto por igualdade via buildWhere). */
async function filtros({ tenantId, de, ate, tipo, metodo, funcionario_id, sessao_id, pedido_id, cartao, numero }) {
  const filtroEq = {};
  if (tipo) { if (!TIPOS.includes(tipo)) throw erro(400, 'Tipo de movimento inválido'); filtroEq.tipo = tipo; }
  if (metodo) { if (!METODOS.includes(metodo)) throw erro(400, 'Forma de pagamento inválida'); filtroEq.metodo = metodo; }
  for (const [k, col] of [['funcionario_id', 'criado_por'], ['sessao_id', 'sessao_id'], ['pedido_id', 'pedido_id']]) {
    const v = { funcionario_id, sessao_id, pedido_id }[k];
    if (v) { if (!UUID_RE.test(v)) throw erro(400, `${k} inválido`); filtroEq[col] = v; }
  }
  if (numero !== undefined && numero !== '') {
    const n = Number(numero);
    if (!Number.isInteger(n) || n < 1) throw erro(400, 'Número de movimento inválido');
    filtroEq.numero = n;
  }
  if (cartao) {
    const c = await pool.query(`SELECT id FROM cartoes_consumo WHERE tenant_id = $1 AND codigo = $2`, [tenantId, normCodigo(cartao)]);
    if (!c.rows[0]) throw erro(404, 'Cartão não encontrado');
    filtroEq.cartao_id = c.rows[0].id;
  }
  const base = ['m.tenant_id = $1'];
  const vals = [tenantId];
  // Pesquisa por número, sessão, pedido ou cartão dispensa o período (o rasto todo)
  const semPeriodo = filtroEq.numero || filtroEq.sessao_id || filtroEq.pedido_id || filtroEq.cartao_id;
  if (!semPeriodo || de || ate) {
    const p = periodo(de, ate);
    vals.push(p.de, p.ate);
    base.push(`(m.criado_em AT TIME ZONE 'Africa/Luanda')::date BETWEEN $2::date AND $3::date`);
  }
  return buildWhere(base, vals, filtroEq, 'm');
}

const referencia = r => [
  r.mesa_numero ? `Mesa ${r.mesa_numero}` : r.quarto_numero ? `Quarto ${r.quarto_numero}` : r.origem ? ({ BALCAO: 'Balcão', TAKEAWAY: 'Take Away', REMOTA: 'Remota', LAZER: 'Lazer', LOJA: 'Loja' }[r.origem] || r.origem) : null,
  r.pedido_id ? `Pedido ${String(r.pedido_id).slice(0, 8)}` : null,
  r.cliente_nome, r.cartao_codigo ? `Cartão ${r.cartao_codigo}` : null,
  r.compra_item ? `Compra: ${r.compra_item}` : null, r.despesa_categoria ? `Despesa: ${r.despesa_categoria}` : null,
].filter(Boolean).join(' · ');

/** Pesquisa paginada com totais do mesmo filtro. */
async function movimentos(q) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const { where, vals } = await filtros(q);
  const [dados, tot, porMetodo] = await Promise.all([
    pool.query(`${SELECT_MOV} ${where} ORDER BY m.numero DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`, [...vals, limit, (page - 1) * limit]),
    pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(m.valor) FILTER (WHERE m.valor > 0), 0) AS entradas,
                       COALESCE(SUM(m.valor) FILTER (WHERE m.valor < 0), 0) AS saidas FROM caixa_movimentos m ${where}`, vals),
    pool.query(`SELECT m.metodo, COALESCE(SUM(m.valor), 0) AS valor, COUNT(*)::int AS n FROM caixa_movimentos m ${where} GROUP BY m.metodo ORDER BY m.metodo`, vals),
  ]);
  const t = tot.rows[0];
  return {
    data: dados.rows.map(r => ({ ...r, referencia: referencia(r) })),
    page, limit, total: t.total,
    totais: { entradas: N(t.entradas), saidas: N(t.saidas), liquido: arred(N(t.entradas) + N(t.saidas)), por_metodo: porMetodo.rows.map(x => ({ metodo: x.metodo, valor: N(x.valor), n: x.n })) },
  };
}

/** Exportação CSV (separador «;» e BOM, para abrir directamente no Excel em português). */
const MAX_CSV = 20000;
async function movimentosCsv(q) {
  const { where, vals } = await filtros(q);
  const r = await pool.query(`${SELECT_MOV} ${where} ORDER BY m.numero LIMIT ${MAX_CSV + 1}`, vals);
  if (r.rows.length > MAX_CSV) throw erro(400, `Demasiados movimentos (mais de ${MAX_CSV}): reduza o período`);
  const cel = v => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const hora = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' });
  const linhas = [['N.º', 'Data e hora', 'Tipo', 'Forma', 'Valor (Kz)', 'Descrição', 'Referência', 'Funcionário', 'Sessão aberta em', 'Hash']];
  for (const m of r.rows) linhas.push([m.numero, hora(m.criado_em), m.tipo, m.metodo, N(m.valor).toFixed(2).replace('.', ','), m.descricao, referencia(m), m.operador, m.sessao_aberta_em ? hora(m.sessao_aberta_em) : '', m.hash]);
  return '﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n') + '\r\n';
}

/**
 * Verificação da integridade: recalcula a cadeia SHA-256 e a numeração, o saldo de cada cartão (= Σ movimentos)
 * e o dinheiro esperado de cada sessão fechada (= fundo + Σ dinheiro). Qualquer falha indica uma alteração feita
 * fora do sistema.
 */
async function verificar({ tenantId }) {
  const [cadeia, n, cartoes, sessoes] = await Promise.all([
    pool.query(`
      WITH m AS (
        SELECT numero, hash, hash_anterior,
               nukpos_caixa_mov_hash(hash_anterior, numero, tenant_id, sessao_id, tipo, metodo, valor, descricao, criado_por, criado_em) AS calc,
               LAG(hash) OVER (ORDER BY numero) AS ant, LAG(numero) OVER (ORDER BY numero) AS num_ant
          FROM caixa_movimentos WHERE tenant_id = $1)
      SELECT numero, CASE WHEN hash IS DISTINCT FROM calc THEN 'ALTERADO'
                          WHEN numero <> COALESCE(num_ant, 0) + 1 THEN 'FALTA_MOVIMENTO'
                          WHEN hash_anterior IS DISTINCT FROM ant THEN 'CADEIA_PARTIDA' END AS motivo
        FROM m
       WHERE hash IS DISTINCT FROM calc OR numero <> COALESCE(num_ant, 0) + 1 OR hash_anterior IS DISTINCT FROM ant
       ORDER BY numero LIMIT 50`, [tenantId]),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(MAX(numero), 0) AS ultimo FROM caixa_movimentos WHERE tenant_id = $1`, [tenantId]),
    pool.query(`
      SELECT c.codigo, c.saldo, COALESCE(SUM(CASE WHEN mc.tipo = 'CONSUMO' THEN -mc.valor ELSE mc.valor END), 0) AS calculado
        FROM cartoes_consumo c LEFT JOIN movimentos_cartao mc ON mc.cartao_id = c.id
       WHERE c.tenant_id = $1 GROUP BY c.id
      HAVING c.saldo <> COALESCE(SUM(CASE WHEN mc.tipo = 'CONSUMO' THEN -mc.valor ELSE mc.valor END), 0) LIMIT 50`, [tenantId]),
    pool.query(`
      SELECT s.id, s.aberta_em, s.esperado, s.fundo_inicial + COALESCE(SUM(m.valor) FILTER (WHERE m.metodo = 'CASH'), 0) AS calculado
        FROM caixa_sessoes s LEFT JOIN caixa_movimentos m ON m.sessao_id = s.id
       WHERE s.tenant_id = $1 AND s.fechada_em IS NOT NULL GROUP BY s.id
      HAVING s.esperado <> s.fundo_inicial + COALESCE(SUM(m.valor) FILTER (WHERE m.metodo = 'CASH'), 0) LIMIT 50`, [tenantId]),
  ]);
  const MOTIVOS = { ALTERADO: 'o conteúdo do movimento foi alterado', FALTA_MOVIMENTO: 'falta o movimento anterior (apagado)', CADEIA_PARTIDA: 'a ligação ao movimento anterior não confere' };
  const problemas = [
    ...cadeia.rows.map(r => ({ tipo: 'MOVIMENTO', numero: Number(r.numero), motivo: r.motivo, texto: `Movimento n.º ${r.numero}: ${MOTIVOS[r.motivo]}` })),
    ...cartoes.rows.map(r => ({ tipo: 'CARTAO', codigo: r.codigo, texto: `Cartão ${r.codigo}: saldo ${N(r.saldo)} Kz, mas os movimentos dão ${N(r.calculado)} Kz` })),
    ...sessoes.rows.map(r => ({ tipo: 'SESSAO', sessao_id: r.id, texto: `Sessão aberta em ${new Date(r.aberta_em).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })}: esperado ${N(r.esperado)} Kz, mas os movimentos dão ${N(r.calculado)} Kz` })),
  ];
  return { ok: problemas.length === 0, verificado_em: new Date().toISOString(), movimentos: n.rows[0].n, ultimo_numero: Number(n.rows[0].ultimo), problemas };
}

/** Rasto completo de um cartão de consumo: lote, venda (quem, como) e cada consumo com o pedido. */
async function rastoCartao({ tenantId, codigo }) {
  const c = await pool.query(
    `SELECT c.id, c.codigo, c.valor_inicial, c.saldo, c.estado, c.criado_em, c.vendido_em, f.nome AS vendido_por_nome, l.numero AS lote_numero
       FROM cartoes_consumo c LEFT JOIN funcionarios f ON f.id = c.vendido_por LEFT JOIN cartoes_lotes l ON l.id = c.lote_id
      WHERE c.tenant_id = $1 AND c.codigo = $2`, [tenantId, normCodigo(codigo)]);
  if (!c.rows[0]) throw erro(404, 'Cartão não encontrado');
  const cartao = c.rows[0];
  const [mov, caixa] = await Promise.all([
    pool.query(
      `SELECT mc.tipo, mc.valor, mc.saldo_antes, mc.saldo_depois, mc.criado_em, mc.pedido_id, p.origem, ms.numero AS mesa_numero, q.numero AS quarto_numero
         FROM movimentos_cartao mc LEFT JOIN pedidos p ON p.id = mc.pedido_id
         LEFT JOIN mesas ms ON ms.id = p.mesa_id LEFT JOIN quartos q ON q.id = p.quarto_id
        WHERE mc.cartao_id = $1 ORDER BY mc.criado_em, mc.id`, [cartao.id]),
    pool.query(`${SELECT_MOV} WHERE m.tenant_id = $1 AND m.cartao_id = $2 ORDER BY m.numero`, [tenantId, cartao.id]),
  ]);
  return { cartao, movimentos: mov.rows, caixa: caixa.rows.map(r => ({ ...r, referencia: referencia(r) })) };
}

module.exports = { movimentos, movimentosCsv, verificar, rastoCartao, TIPOS, METODOS };
