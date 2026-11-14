'use strict';
/**
 * Relatórios de gestão (benchmarking WinREST, 14/11/2026): vendas, formas de pagamento, funcionários, produtos,
 * horas, descontos e cancelamentos num período (dias de Luanda), e o relatório de fecho de uma sessão de caixa.
 * Só leitura. Vendas = pedidos FECHADOS (criado_em no período); recebimentos = livro-razão do caixa no período.
 */
const { pool } = require('../db');
const { erro } = require('./shared');

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const hojeLuanda = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
const N = v => Number(v || 0);

function periodo(de, ate) {
  const d = de || hojeLuanda(), a = ate || d;
  for (const x of [d, a]) {
    if (!DIA_RE.test(x) || isNaN(new Date(x + 'T00:00:00Z'))) throw erro(400, 'Datas inválidas (AAAA-MM-DD)');
  }
  const dias = (new Date(a + 'T00:00:00Z') - new Date(d + 'T00:00:00Z')) / 86400000;
  if (dias < 0) throw erro(400, 'A data inicial é posterior à final');
  if (dias > 366) throw erro(400, 'Período máximo: um ano');
  return { de: d, ate: a };
}
// Dia civil de Luanda
const NO_PERIODO = col => `(${col} AT TIME ZONE 'Africa/Luanda')::date BETWEEN $2::date AND $3::date`;

async function vendas({ tenantId, de, ate }) {
  const p = periodo(de, ate);
  const v = [tenantId, p.de, p.ate];
  const [tot, formas, conta, porFunc, cancPorFunc, porProd, porHora, canc] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'FECHADO')::int AS pedidos,
             COALESCE(SUM(total) FILTER (WHERE status = 'FECHADO'), 0) AS valor,
             COALESCE(SUM(desconto) FILTER (WHERE status = 'FECHADO'), 0) AS descontos,
             COUNT(*) FILTER (WHERE status = 'CANCELADO')::int AS cancelados,
             COALESCE(SUM(total) FILTER (WHERE status = 'CANCELADO'), 0) AS valor_cancelado,
             COALESCE(SUM(total) FILTER (WHERE status = 'FECHADO' AND pago_em IS NULL), 0) AS por_receber
        FROM pedidos WHERE tenant_id = $1 AND ${NO_PERIODO('criado_em')}`, v),
    pool.query(`
      SELECT metodo, tipo, COALESCE(SUM(valor), 0) AS valor, COUNT(*)::int AS n
        FROM caixa_movimentos WHERE tenant_id = $1 AND ${NO_PERIODO('criado_em')}
       GROUP BY metodo, tipo`, v),
    pool.query(`
      SELECT COALESCE(SUM(valor), 0) AS valor, COUNT(*)::int AS n FROM conta_corrente_movimentos
       WHERE tenant_id = $1 AND tipo = 'DEBITO' AND ${NO_PERIODO('criado_em')}`, v),
    pool.query(`
      SELECT f.id, COALESCE(f.nome, 'Portal / sem funcionário') AS nome, COUNT(*)::int AS pedidos, COALESCE(SUM(p.total), 0) AS valor
        FROM pedidos p LEFT JOIN funcionarios f ON f.id = p.funcionario_id
       WHERE p.tenant_id = $1 AND p.status = 'FECHADO' AND ${NO_PERIODO('p.criado_em')}
       GROUP BY f.id, f.nome ORDER BY valor DESC`, v),
    pool.query(`
      SELECT p.cancelado_por AS id, COUNT(*)::int AS n FROM pedidos p
       WHERE p.tenant_id = $1 AND p.status = 'CANCELADO' AND ${NO_PERIODO('p.criado_em')} GROUP BY p.cancelado_por`, v),
    pool.query(`
      SELECT pr.id, pr.nome, pr.categoria, COALESCE(SUM(i.quantidade), 0) AS quantidade, COALESCE(SUM(i.quantidade * i.preco_unitario), 0) AS valor
        FROM itens_pedido i JOIN pedidos p ON p.id = i.pedido_id JOIN produtos pr ON pr.id = i.produto_id
       WHERE p.tenant_id = $1 AND p.status = 'FECHADO' AND ${NO_PERIODO('p.criado_em')}
       GROUP BY pr.id, pr.nome, pr.categoria ORDER BY valor DESC LIMIT 30`, v),
    pool.query(`
      SELECT EXTRACT(HOUR FROM p.criado_em AT TIME ZONE 'Africa/Luanda')::int AS hora, COUNT(*)::int AS pedidos, COALESCE(SUM(p.total), 0) AS valor
        FROM pedidos p WHERE p.tenant_id = $1 AND p.status = 'FECHADO' AND ${NO_PERIODO('p.criado_em')}
       GROUP BY 1 ORDER BY 1`, v),
    pool.query(`
      SELECT p.id, p.criado_em, p.cancelado_em, p.origem, p.total, p.motivo_cancelamento, m.numero AS mesa,
             fc.nome AS cancelado_por_nome, fp.nome AS criado_por_nome
        FROM pedidos p LEFT JOIN mesas m ON m.id = p.mesa_id
        LEFT JOIN funcionarios fc ON fc.id = p.cancelado_por LEFT JOIN funcionarios fp ON fp.id = p.funcionario_id
       WHERE p.tenant_id = $1 AND p.status = 'CANCELADO' AND ${NO_PERIODO('p.criado_em')}
       ORDER BY COALESCE(p.cancelado_em, p.atualizado_em) DESC LIMIT 200`, v),
  ]);

  const t = tot.rows[0];
  const recebido = {}, entradas = {};
  for (const r of formas.rows) {
    if (r.tipo === 'RECEBIMENTO') recebido[r.metodo] = N(recebido[r.metodo]) + N(r.valor);
    entradas[r.metodo] = N(entradas[r.metodo]) + N(r.valor);
  }
  if (N(conta.rows[0].valor) > 0) recebido.CONTA = N(conta.rows[0].valor);
  const canc_por = Object.fromEntries(cancPorFunc.rows.map(r => [r.id, r.n]));
  return {
    periodo: p,
    totais: {
      pedidos: t.pedidos, valor: N(t.valor), ticket_medio: t.pedidos ? Math.round(N(t.valor) / t.pedidos * 100) / 100 : 0,
      descontos: N(t.descontos), cancelados: t.cancelados, valor_cancelado: N(t.valor_cancelado), por_receber: N(t.por_receber),
    },
    // Recebimentos de vendas por forma (CONTA = lançado em conta corrente) e todas as entradas/saídas do caixa por forma
    recebido_por_forma: recebido,
    caixa_por_forma: entradas,
    por_funcionario: porFunc.rows.map(r => ({ id: r.id, nome: r.nome, pedidos: r.pedidos, valor: N(r.valor), cancelamentos: canc_por[r.id] || 0 })),
    por_produto: porProd.rows.map(r => ({ ...r, quantidade: N(r.quantidade), valor: N(r.valor) })),
    por_hora: porHora.rows.map(r => ({ hora: r.hora, pedidos: r.pedidos, valor: N(r.valor) })),
    cancelamentos: canc.rows.map(r => ({ ...r, total: N(r.total) })),
  };
}

/** Relatório de fecho (talão Z) de uma sessão de caixa. */
async function sessaoCaixa({ tenantId, sessaoId }) {
  const s = await pool.query(`
    SELECT s.*, fa.nome AS aberta_por_nome, ff.nome AS fechada_por_nome FROM caixa_sessoes s
      LEFT JOIN funcionarios fa ON fa.id = s.aberta_por LEFT JOIN funcionarios ff ON ff.id = s.fechada_por
     WHERE s.id = $1 AND s.tenant_id = $2`, [sessaoId, tenantId]);
  if (!s.rows[0]) throw erro(404, 'Sessão de caixa não encontrada');
  const [porTipo, porFunc, conta] = await Promise.all([
    pool.query(`SELECT tipo, metodo, COALESCE(SUM(valor), 0) AS valor, COUNT(*)::int AS n FROM caixa_movimentos WHERE sessao_id = $1 GROUP BY tipo, metodo ORDER BY tipo, metodo`, [sessaoId]),
    pool.query(`
      SELECT COALESCE(f.nome, '—') AS nome, m.metodo, COALESCE(SUM(m.valor), 0) AS valor, COUNT(*)::int AS n
        FROM caixa_movimentos m LEFT JOIN funcionarios f ON f.id = m.criado_por
       WHERE m.sessao_id = $1 GROUP BY f.nome, m.metodo ORDER BY f.nome, m.metodo`, [sessaoId]),
    pool.query(`SELECT COALESCE(SUM(valor), 0) AS valor, COUNT(*)::int AS n FROM conta_corrente_movimentos WHERE sessao_id = $1 AND tipo = 'DEBITO'`, [sessaoId]),
  ]);
  const sessao = s.rows[0];
  const porMetodo = {};
  let dinheiro = 0;
  for (const r of porTipo.rows) {
    porMetodo[r.metodo] = N(porMetodo[r.metodo]) + N(r.valor);
    if (r.metodo === 'CASH') dinheiro += N(r.valor);
  }
  const fundo = N(sessao.fundo_inicial);
  return {
    sessao,
    fundo_inicial: fundo,
    movimentos_por_tipo: porTipo.rows.map(r => ({ ...r, valor: N(r.valor) })),
    por_metodo: porMetodo,
    por_funcionario: porFunc.rows.map(r => ({ ...r, valor: N(r.valor) })),
    lancado_em_conta: { valor: N(conta.rows[0].valor), n: conta.rows[0].n },
    dinheiro_esperado: sessao.esperado !== null ? N(sessao.esperado) : Math.round((fundo + dinheiro) * 100) / 100,
    contado: sessao.contado !== null ? N(sessao.contado) : null,
    diferenca: sessao.diferenca !== null ? N(sessao.diferenca) : null,
  };
}

module.exports = { vendas, sessaoCaixa, periodo };
