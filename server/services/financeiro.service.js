'use strict';
/**
 * Financeiro: resumo do dia, resultado do período (lucro real), margem por produto e despesas.
 *  - Receita = pedidos COBRADOS no período (`pago_em`: recebidos no Caixa ou lançados em conta corrente)
 *    + alojamento (reservas não canceladas, pela data de criação). O que está fechado e por receber aparece à parte.
 *  - Custo das vendas (CMV) = Σ quantidade vendida × custo da receita do produto (ingredientes × custo unitário actual
 *    do stock). Produtos sem receita ou sem custo ficam assinalados (o custo deles conta 0 e o ecrã avisa).
 *  - Despesas = registos de despesas não anulados (renda, salários, energia…). As compras pontuais NÃO são despesa
 *    do resultado (entram no stock e saem como CMV quando se vende); aparecem só nas saídas de caixa.
 *  - Despesa paga pela gaveta: exige caixa aberto e dinheiro suficiente; gera um movimento DESPESA negativo.
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { withTx, erro } = require('./shared');
const { periodo } = require('./relatorios.service');

const CATEGORIAS_DESPESA = { SALARIOS: 'Salários', RENDA: 'Renda', ENERGIA: 'Energia', AGUA: 'Água', COMBUSTIVEL: 'Combustível', MANUTENCAO: 'Manutenção', MARKETING: 'Publicidade', IMPOSTOS: 'Impostos e taxas', OUTRA: 'Outra' };
const N = v => Number(v || 0);
const arred = v => Math.round(v * 100) / 100;
const hojeLuanda = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
const NO_PERIODO = col => `(${col} AT TIME ZONE 'Africa/Luanda')::date BETWEEN $2::date AND $3::date`;

/** Resumo do dia (contrato antigo de GET /api/financeiro/resumo). */
async function resumoDia({ tenantId, data }) {
  let dataFiltro = hojeLuanda(); // dia civil em Luanda (UTC+1)
  if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    const d = new Date(data + 'T00:00:00Z');
    if (!isNaN(d.getTime()) && d.toISOString().startsWith(data)) dataFiltro = data;
  }
  const [vendas, porCategoria, porStatus, quartos] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE status <> 'CANCELADO') as total_pedidos,
             COALESCE(SUM(total) FILTER (WHERE status = 'FECHADO'),0) as receita_total,
             COUNT(*) FILTER (WHERE status = 'FECHADO') as pedidos_fechados,
             COUNT(*) FILTER (WHERE status = 'CANCELADO') as pedidos_cancelados
      FROM pedidos WHERE (criado_em AT TIME ZONE 'Africa/Luanda')::date = $1 AND ($2::uuid IS NULL OR tenant_id=$2)
    `, [dataFiltro, tenantId || null]),
    pool.query(`
      SELECT pr.categoria, COALESCE(SUM(ip.quantidade),0) as itens_vendidos, COALESCE(SUM(ip.quantidade * ip.preco_unitario),0) as total
      FROM itens_pedido ip
      JOIN produtos pr ON ip.produto_id = pr.id
      JOIN pedidos p ON ip.pedido_id = p.id
      WHERE (p.criado_em AT TIME ZONE 'Africa/Luanda')::date = $1 AND p.status = 'FECHADO'
        AND ($2::uuid IS NULL OR p.tenant_id=$2)
      GROUP BY pr.categoria ORDER BY total DESC
    `, [dataFiltro, tenantId || null]),
    pool.query(`
      SELECT status, COUNT(*) as total, COALESCE(SUM(total),0) as valor
      FROM pedidos WHERE (criado_em AT TIME ZONE 'Africa/Luanda')::date = $1 AND ($2::uuid IS NULL OR tenant_id=$2) GROUP BY status
    `, [dataFiltro, tenantId || null]),
    pool.query(`
      SELECT COUNT(*) as total_reservas, COALESCE(SUM(rv.valor_total),0) as receita_quartos
      FROM reservas rv JOIN quartos q ON rv.quarto_id=q.id
      WHERE (rv.criado_em AT TIME ZONE 'Africa/Luanda')::date = $1 AND rv.status != 'CANCELADA'
        AND ($2::uuid IS NULL OR q.tenant_id=$2)
    `, [dataFiltro, tenantId || null]),
  ]);
  return { data: dataFiltro, pedidos: vendas.rows[0], por_categoria: porCategoria.rows, por_status: porStatus.rows, quartos: quartos.rows[0] };
}

/** Custo unitário de cada produto pela receita de stock (ingredientes × custo actual). */
async function custosProdutos(db, tenantId) {
  const r = await db.query(`
    SELECT pr.id, COUNT(pi.id)::int AS ingredientes,
           COUNT(pi.id) FILTER (WHERE si.custo_unitario IS NULL)::int AS sem_custo,
           COALESCE(SUM(pi.quantidade * si.custo_unitario), 0) AS custo
      FROM produtos pr
      LEFT JOIN produto_ingredientes pi ON pi.produto_id = pr.id
      LEFT JOIN stock_items si ON si.id = pi.stock_item_id
     WHERE pr.tenant_id = $1 GROUP BY pr.id`, [tenantId]);
  return new Map(r.rows.map(x => [x.id, { custo: N(x.custo), sem_receita: x.ingredientes === 0, sem_custo: x.sem_custo > 0 }]));
}

/** Resultado do período: receita, custo das vendas, despesas, lucro e margem por produto. */
async function resultado({ tenantId, de, ate }) {
  const p = periodo(de, ate);
  const v = [tenantId, p.de, p.ate];
  const [vendas, porReceber, aloj, itens, desp, caixa, custos] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS valor, COALESCE(SUM(desconto),0) AS descontos
                  FROM pedidos WHERE tenant_id = $1 AND status <> 'CANCELADO' AND pago_em IS NOT NULL AND ${NO_PERIODO('pago_em')}`, v),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS valor FROM pedidos WHERE tenant_id = $1 AND status = 'FECHADO' AND pago_em IS NULL`, [tenantId]),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(rv.valor_total),0) AS valor FROM reservas rv JOIN quartos q ON q.id = rv.quarto_id
                 WHERE q.tenant_id = $1 AND rv.status <> 'CANCELADA' AND ${NO_PERIODO('rv.criado_em')}`, v),
    pool.query(`SELECT pr.id, pr.nome, pr.categoria, SUM(ip.quantidade) AS qtd, SUM(ip.quantidade * ip.preco_unitario) AS receita
                  FROM itens_pedido ip JOIN pedidos pd ON pd.id = ip.pedido_id JOIN produtos pr ON pr.id = ip.produto_id
                 WHERE pd.tenant_id = $1 AND pd.status <> 'CANCELADO' AND pd.pago_em IS NOT NULL AND ${NO_PERIODO('pd.pago_em')}
                 GROUP BY pr.id, pr.nome, pr.categoria`, v),
    pool.query(`SELECT categoria, COALESCE(SUM(valor),0) AS valor, COUNT(*)::int AS n FROM despesas
                 WHERE tenant_id = $1 AND anulada_em IS NULL AND data BETWEEN $2::date AND $3::date GROUP BY categoria ORDER BY valor DESC`, v),
    pool.query(`SELECT tipo, metodo, COALESCE(SUM(valor),0) AS valor FROM caixa_movimentos WHERE tenant_id = $1 AND ${NO_PERIODO('criado_em')} GROUP BY tipo, metodo`, v),
    custosProdutos(pool, tenantId),
  ]);

  let cmv = 0, semCusto = 0;
  const porProduto = itens.rows.map(x => {
    const c = custos.get(x.id) || { custo: 0, sem_receita: true, sem_custo: false };
    const qtd = N(x.qtd), receita = N(x.receita), custo = arred(qtd * c.custo);
    cmv += custo;
    if (c.sem_receita || c.sem_custo) semCusto += receita;
    return {
      id: x.id, nome: x.nome, categoria: x.categoria, quantidade: qtd, receita: arred(receita), custo_unitario: arred(c.custo), custo,
      margem: arred(receita - custo), margem_pct: receita > 0 ? Math.round((receita - custo) / receita * 1000) / 10 : 0,
      sem_receita: c.sem_receita, sem_custo: c.sem_custo,
    };
  }).sort((a, b) => b.receita - a.receita);

  const receitaVendas = N(vendas.rows[0].valor), receitaAloj = N(aloj.rows[0].valor);
  const receita = arred(receitaVendas + receitaAloj);
  const despesas = desp.rows.map(d => ({ categoria: d.categoria, rotulo: CATEGORIAS_DESPESA[d.categoria] || d.categoria, valor: N(d.valor), n: d.n }));
  const totalDespesas = arred(despesas.reduce((a, d) => a + d.valor, 0));
  cmv = arred(cmv);
  const entradas = {}, saidas = {};
  for (const m of caixa.rows) {
    const val = N(m.valor);
    if (val >= 0) entradas[m.tipo] = arred(N(entradas[m.tipo]) + val); else saidas[m.tipo] = arred(N(saidas[m.tipo]) - val);
  }
  return {
    periodo: p,
    receita: { vendas: arred(receitaVendas), alojamento: arred(receitaAloj), total: receita, pedidos: vendas.rows[0].n, reservas: aloj.rows[0].n, descontos: N(vendas.rows[0].descontos) },
    por_receber: { pedidos: porReceber.rows[0].n, valor: N(porReceber.rows[0].valor) },
    custo_vendas: cmv,
    margem_bruta: arred(receitaVendas - cmv),
    margem_bruta_pct: receitaVendas > 0 ? Math.round((receitaVendas - cmv) / receitaVendas * 1000) / 10 : 0,
    despesas, total_despesas: totalDespesas,
    resultado: arred(receita - cmv - totalDespesas),
    receita_sem_custo: arred(semCusto), // vendas de produtos sem receita/custo: o lucro real é menor do que o mostrado
    por_produto: porProduto.slice(0, 50),
    caixa: { entradas, saidas },
  };
}

async function listarDespesas({ tenantId, de, ate }) {
  const p = periodo(de, ate);
  const r = await pool.query(`
    SELECT d.*, f.nome AS criado_por_nome, fa.nome AS anulada_por_nome FROM despesas d
      LEFT JOIN funcionarios f ON f.id = d.criado_por LEFT JOIN funcionarios fa ON fa.id = d.anulada_por
     WHERE d.tenant_id = $1 AND d.data BETWEEN $2::date AND $3::date ORDER BY d.data DESC, d.criado_em DESC LIMIT 500`, [tenantId, p.de, p.ate]);
  return r.rows.map(x => ({ ...x, valor: N(x.valor), rotulo: CATEGORIAS_DESPESA[x.categoria] || x.categoria }));
}

async function criarDespesa({ tenantId, userId, categoria, descricao, valor, data, pela_gaveta }) {
  const cat = String(categoria || '').toUpperCase();
  if (!CATEGORIAS_DESPESA[cat]) throw erro(400, `Categoria inválida. Aceites: ${Object.keys(CATEGORIAS_DESPESA).join(', ')}`);
  const desc = String(descricao || '').trim();
  if (desc.length < 3 || desc.length > 200) throw erro(400, 'Descrição: 3 a 200 caracteres');
  const v = Math.round(Number(valor) * 100) / 100;
  if (!Number.isFinite(v) || v <= 0 || v > 1e11) throw erro(400, 'Valor inválido');
  const dia = data || hojeLuanda();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || isNaN(new Date(dia + 'T00:00:00Z'))) throw erro(400, 'Data inválida (AAAA-MM-DD)');
  if (dia > hojeLuanda()) throw erro(400, 'A data não pode ser no futuro');
  const gaveta = pela_gaveta === true;
  const out = await withTx(async db => {
    let sessaoId = null;
    if (gaveta) {
      const s = await db.query(`SELECT id, fundo_inicial FROM caixa_sessoes WHERE tenant_id = $1 AND fechada_em IS NULL FOR UPDATE`, [tenantId]);
      if (!s.rows[0]) throw erro(409, 'O caixa está fechado. Abra o caixa do dia para pagar pela gaveta.', { codigo: 'CAIXA_FECHADO' });
      const cash = await db.query(`SELECT COALESCE(SUM(valor),0) AS v FROM caixa_movimentos WHERE sessao_id = $1 AND metodo = 'CASH'`, [s.rows[0].id]);
      const disponivel = arred(N(s.rows[0].fundo_inicial) + N(cash.rows[0].v));
      if (v > disponivel) throw erro(409, `Não há dinheiro suficiente na gaveta (disponível ${disponivel.toFixed(2)} Kz)`, { disponivel });
      sessaoId = s.rows[0].id;
    }
    const d = (await db.query(
      `INSERT INTO despesas (tenant_id, categoria, descricao, valor, data, pela_gaveta, sessao_id, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tenantId, cat, desc, v, dia, gaveta, sessaoId, userId || null])).rows[0];
    if (gaveta) {
      await db.query(`INSERT INTO caixa_movimentos (tenant_id, sessao_id, tipo, metodo, valor, descricao, despesa_id, criado_por) VALUES ($1,$2,'DESPESA','CASH',$3,$4,$5,$6)`,
        [tenantId, sessaoId, -v, `Despesa · ${desc}`, d.id, userId || null]);
    }
    return { ...d, valor: N(d.valor) };
  });
  if (gaveta) broadcast('caixa_atualizada', {}, tenantId);
  return out;
}

/** Anular (nunca apagar): motivo obrigatório; se saiu da gaveta, só no caixa em curso e o dinheiro volta. */
async function anularDespesa({ tenantId, userId, id, motivo }) {
  const m = String(motivo || '').trim();
  if (m.length < 3 || m.length > 200) throw erro(400, 'Indique o motivo (3 a 200 caracteres)');
  const out = await withTx(async db => {
    const r = await db.query(`SELECT * FROM despesas WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
    const d = r.rows[0];
    if (!d) throw erro(404, 'Despesa não encontrada');
    if (d.anulada_em) throw erro(409, 'Esta despesa já foi anulada');
    if (d.pela_gaveta) {
      const s = await db.query(`SELECT id FROM caixa_sessoes WHERE id = $1 AND fechada_em IS NULL`, [d.sessao_id]);
      if (!s.rows[0]) throw erro(409, 'Saiu da gaveta num caixa já fechado: não se anula (corrija com uma nota nas observações do fecho)');
      await db.query(`INSERT INTO caixa_movimentos (tenant_id, sessao_id, tipo, metodo, valor, descricao, despesa_id, criado_por) VALUES ($1,$2,'DESPESA','CASH',$3,$4,$5,$6)`,
        [tenantId, d.sessao_id, N(d.valor), `Anulação de despesa · ${d.descricao}`, d.id, userId || null]);
    }
    const u = await db.query(`UPDATE despesas SET anulada_em = NOW(), anulada_por = $3, motivo_anulacao = $4 WHERE id = $1 AND tenant_id = $2 RETURNING *`, [id, tenantId, userId || null, m]);
    return { ...u.rows[0], valor: N(u.rows[0].valor), gaveta: d.pela_gaveta };
  });
  if (out.gaveta) broadcast('caixa_atualizada', {}, tenantId);
  return out;
}

module.exports = { resumoDia, resultado, custosProdutos, listarDespesas, criarDespesa, anularDespesa, CATEGORIAS_DESPESA };
