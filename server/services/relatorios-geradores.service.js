'use strict';
/**
 * Geradores dos relatórios automáticos (21/11/2026, pedido do dono). Cada gerador recebe um período (dias de Luanda)
 * e devolve o mesmo formato, que o ecrã e o PDF desenham sem saber de que relatório se trata:
 *   { tipo, titulo, de, ate, resumo: [{ rotulo, valor, formato }], seccoes: [{ titulo, colunas: [{ rotulo, chave,
 *     formato, alinhar }], linhas, total }], alertas: [texto], sem_dados }
 * `sem_dados = true` quando não houve movimento: o agendador não guarda relatórios vazios.
 * Só leitura; nada aqui escreve na base de dados.
 */
const { pool } = require('../db');
const { erro } = require('./shared');

const N = v => Number(v || 0);
const arred = v => Math.round(N(v) * 100) / 100;
const NO_PERIODO = col => `(${col} AT TIME ZONE 'Africa/Luanda')::date BETWEEN $2::date AND $3::date`;
const dias = (de, ate) => Math.round((new Date(ate + 'T00:00:00Z') - new Date(de + 'T00:00:00Z')) / 86400000) + 1;
const col = (rotulo, chave, formato = 'txt', alinhar) => ({ rotulo, chave, formato, alinhar: alinhar || (formato === 'txt' ? 'esq' : 'dir') });
const AREAS = { ESPLANADA_BAR: 'Esplanada / Bar', COZINHA: 'Cozinha', PISCINA: 'Piscina', HOTEL: 'Hotel', TECNICA: 'Técnica', DIVERSOS: 'Diversos' };
const FRACAO = { DUAS_HORAS: 'Horas', PERNOITE: 'Noite', DIARIA: 'Diária' };
const FORMAS = { CASH: 'Dinheiro', TPA: 'TPA', TRANSFERENCIA: 'Transferência', EXPRESS: 'Express', NUKCOIN: 'Nuk-Coin', CARTAO: 'Cartão de consumo', CONTA: 'Conta corrente' };

// ── Folha de Caixa (um dia) ──
async function folhaCaixa(tenantId, de) {
  const f = await require('./folha-caixa.service').gerar({ tenantId, dia: de });
  const linhasVendas = [];
  for (const [g, letra] of [['BEBIDAS', 'F'], ['COMIDAS', 'G'], ['PISCINA', 'H'], ['QUARTOS', 'I'], ['OUTROS', 'E']]) {
    for (const l of f.vendas.grupos[g].linhas) linhasVendas.push({ grupo: `(${letra}) ${g[0]}${g.slice(1).toLowerCase()}`, produto: l.produto, quantidade: l.quantidade, preco: l.preco, valor: l.valor });
  }
  const semDados = !f.abertura.sessoes && !f.vendas.pedidos && !f.saidas.linhas.length && !f.entradas.J && !f.entradas.K;
  return {
    titulo: 'Folha de Caixa', sem_dados: semDados, pdf: 'FOLHA_CAIXA',
    resumo: [
      { rotulo: 'Abertura (A)', valor: f.abertura.A, formato: 'kz' }, { rotulo: 'Total vendas (E+F+G+H+I)', valor: f.vendas.total, formato: 'kz' },
      { rotulo: 'Venda caixa (J)', valor: f.entradas.J, formato: 'kz' }, { rotulo: 'Venda banco (K)', valor: f.entradas.K, formato: 'kz' },
      { rotulo: 'Saídas (B)', valor: f.saidas.B, formato: 'kz' }, { rotulo: 'Fecho calculado (A+J-D)', valor: f.fecho.calculado, formato: 'kz' },
      { rotulo: 'Contado no fecho', valor: f.fecho.declarado, formato: 'kz' }, { rotulo: 'Diferença', valor: f.fecho.diferenca, formato: 'kz' },
    ],
    seccoes: [
      { titulo: 'Compras / saídas', colunas: [col('Área', 'area'), col('Descrição', 'descricao'), col('Pago por', 'pago'), col('Valor', 'valor', 'kz')],
        linhas: f.saidas.linhas.map(s => ({ ...s, area: AREAS[s.area] || s.area, pago: s.pago === 'BANCO' ? 'Banco' : 'Caixa' })), total: { area: 'Total', valor: f.saidas.B } },
      { titulo: 'Vendas por grupo', colunas: [col('Grupo', 'grupo'), col('Produto', 'produto'), col('Qtd', 'quantidade', 'num'), col('Preço', 'preco', 'kz'), col('Valor', 'valor', 'kz')],
        linhas: linhasVendas, total: { grupo: 'Total', valor: f.vendas.total } },
      { titulo: 'Quebras (ao custo)', colunas: [col('Artigo', 'item'), col('Qtd', 'quantidade', 'num'), col('Motivo', 'motivo'), col('Valor', 'valor', 'kz')], linhas: f.quebras.linhas, total: f.quebras.linhas.length ? { item: 'Total', valor: f.quebras.total } : null },
    ],
    alertas: f.alertas,
  };
}

// ── Vendas ──
async function vendas(tenantId, de, ate) {
  const r = await require('./relatorios.service').vendas({ tenantId, de, ate });
  const t = r.totais;
  return {
    titulo: 'Vendas', sem_dados: !t.pedidos && !t.cancelados,
    resumo: [
      { rotulo: 'Vendas pagas', valor: t.valor, formato: 'kz' }, { rotulo: 'Pedidos pagos', valor: t.pedidos, formato: 'num' },
      { rotulo: 'Ticket médio', valor: t.ticket_medio, formato: 'kz' }, { rotulo: 'Descontos', valor: t.descontos, formato: 'kz' },
      { rotulo: 'Cancelados', valor: t.cancelados, formato: 'num' }, { rotulo: 'Contas não pagas', valor: r.valor_perdas, formato: 'kz' },
    ],
    seccoes: [
      { titulo: 'Recebido por forma de pagamento', colunas: [col('Forma', 'forma'), col('Valor', 'valor', 'kz')],
        linhas: Object.entries(r.recebido_por_forma).map(([k, v]) => ({ forma: FORMAS[k] || k, valor: v })) },
      { titulo: 'Por funcionário', colunas: [col('Funcionário', 'nome'), col('Pedidos', 'pedidos', 'num'), col('Valor', 'valor', 'kz'), col('Cancelamentos', 'cancelamentos', 'num'), col('Comissão', 'comissao', 'kz')], linhas: r.por_funcionario },
      { titulo: 'Produtos mais vendidos', colunas: [col('Produto', 'nome'), col('Qtd', 'quantidade', 'num'), col('Valor', 'valor', 'kz')], linhas: r.por_produto },
      { titulo: 'Cancelamentos', colunas: [col('Origem', 'origem'), col('Mesa', 'mesa'), col('Quem cancelou', 'cancelado_por_nome'), col('Motivo', 'motivo_cancelamento'), col('Valor', 'total', 'kz')], linhas: r.cancelamentos },
    ],
    alertas: [
      ...(t.cancelados ? [`${t.cancelados} pedido(s) cancelado(s) no período (${t.valor_cancelado} Kz).`] : []),
      ...(r.perdas.length ? [`${r.perdas.length} conta(s) registada(s) como não paga(s) (${r.valor_perdas} Kz).`] : []),
    ],
  };
}

// ── Compras por fornecedor e área ──
async function compras(tenantId, de, ate) {
  const v = [tenantId, de, ate];
  const cfg = await require('./folha-caixa.service').lerConfig(tenantId);
  const [c, d] = await Promise.all([
    pool.query(`SELECT c.valor_total, c.area, c.fornecedor, c.fornecedor_nif, c.documento, s.categoria
                  FROM compras_pontuais c JOIN stock_items s ON s.id = c.stock_item_id
                 WHERE c.tenant_id = $1 AND c.anulada_em IS NULL AND ${NO_PERIODO('c.criado_em')}`, v),
    pool.query(`SELECT categoria, valor, area, pela_gaveta FROM despesas WHERE tenant_id = $1 AND anulada_em IS NULL AND data BETWEEN $2::date AND $3::date`, v),
  ]);
  const forn = new Map(), areas = {};
  let total = 0, semDoc = 0, semNif = 0;
  for (const x of c.rows) {
    const nome = (x.fornecedor || '').trim() || '(sem fornecedor)';
    const k = nome.toLowerCase();
    const f = forn.get(k) || { fornecedor: nome, nif: x.fornecedor_nif || '', compras: 0, com_documento: 0, valor: 0 };
    f.compras++; f.valor = arred(f.valor + N(x.valor_total));
    if (x.documento) f.com_documento++; else semDoc += N(x.valor_total);
    if (!x.fornecedor_nif) semNif += N(x.valor_total); else f.nif = x.fornecedor_nif;
    forn.set(k, f);
    const a = x.area || cfg.areas_stock[x.categoria] || 'DIVERSOS';
    areas[a] = arred(N(areas[a]) + N(x.valor_total));
    total += N(x.valor_total);
  }
  let totalDesp = 0;
  for (const x of d.rows) { const a = x.area || cfg.areas_despesa[x.categoria] || 'DIVERSOS'; areas[a] = arred(N(areas[a]) + N(x.valor)); totalDesp += N(x.valor); }
  total = arred(total); totalDesp = arred(totalDesp);
  return {
    titulo: 'Compras e despesas por fornecedor e área', sem_dados: !c.rows.length && !d.rows.length,
    resumo: [
      { rotulo: 'Compras', valor: total, formato: 'kz' }, { rotulo: 'Despesas', valor: totalDesp, formato: 'kz' },
      { rotulo: 'Compras sem n.º de factura', valor: arred(semDoc), formato: 'kz' }, { rotulo: 'Compras sem NIF do fornecedor', valor: arred(semNif), formato: 'kz' },
    ],
    seccoes: [
      { titulo: 'Por fornecedor', colunas: [col('Fornecedor', 'fornecedor'), col('NIF', 'nif'), col('Compras', 'compras', 'num'), col('Com factura', 'com_documento', 'num'), col('Valor', 'valor', 'kz')],
        linhas: [...forn.values()].sort((a, b) => b.valor - a.valor), total: { fornecedor: 'Total', valor: total } },
      { titulo: 'Por área (compras + despesas)', colunas: [col('Área', 'area'), col('Valor', 'valor', 'kz')],
        linhas: Object.entries(areas).sort((a, b) => b[1] - a[1]).map(([k, val]) => ({ area: AREAS[k] || k, valor: val })), total: { area: 'Total', valor: arred(total + totalDesp) } },
    ],
    alertas: [
      ...(semDoc > 0 ? [`${arred(semDoc)} Kz de compras sem n.º de factura/recibo do fornecedor.`] : []),
      ...(total > 0 && semDoc / total > 0.3 ? ['Mais de 30 % das compras sem documento: peça sempre factura em nome do estabelecimento.'] : []),
    ],
  };
}

// ── Stock: movimento e valor ──
async function stock(tenantId, de, ate) {
  const r = await pool.query(`
    SELECT s.nome, s.unidade, s.stock_atual, s.stock_minimo, s.custo_unitario,
           COALESCE(SUM(m.quantidade) FILTER (WHERE m.tipo = 'COMPRA'), 0) AS entradas,
           COALESCE(SUM(ABS(m.quantidade)) FILTER (WHERE m.tipo = 'VENDA'), 0) AS vendas,
           COALESCE(SUM(ABS(m.quantidade)) FILTER (WHERE m.tipo = 'DESPERDICIO'), 0) AS quebras,
           COALESCE(SUM(m.quantidade) FILTER (WHERE m.tipo IN ('AJUSTE','INVENTARIO')), 0) AS ajustes
      FROM stock_items s LEFT JOIN movimentos_stock m ON m.stock_item_id = s.id AND ${NO_PERIODO('m.criado_em')}
     WHERE s.tenant_id = $1 AND COALESCE(s.ativo, true)
     GROUP BY s.id ORDER BY s.nome`, [tenantId, de, ate]);
  const linhas = r.rows.map(x => ({
    item: x.nome, unidade: x.unidade, entradas: N(x.entradas), vendas: N(x.vendas), quebras: N(x.quebras), ajustes: N(x.ajustes),
    stock: N(x.stock_atual), minimo: N(x.stock_minimo), valor: x.custo_unitario === null ? null : arred(N(x.stock_atual) * N(x.custo_unitario)),
  }));
  const abaixo = linhas.filter(l => l.minimo > 0 && l.stock <= l.minimo);
  const ajustesNeg = linhas.filter(l => l.ajustes < 0);
  return {
    titulo: 'Stock: movimento e valor', sem_dados: !linhas.some(l => l.entradas || l.vendas || l.quebras || l.ajustes),
    resumo: [
      { rotulo: 'Artigos', valor: linhas.length, formato: 'num' }, { rotulo: 'Valor do stock (ao custo)', valor: arred(linhas.reduce((a, l) => a + N(l.valor), 0)), formato: 'kz' },
      { rotulo: 'No mínimo ou abaixo', valor: abaixo.length, formato: 'num' }, { rotulo: 'Sem custo', valor: linhas.filter(l => l.valor === null).length, formato: 'num' },
    ],
    seccoes: [{ titulo: 'Artigos (entradas, saídas e acertos no período; stock actual)', colunas: [col('Artigo', 'item'), col('Un.', 'unidade'), col('Entradas', 'entradas', 'num'), col('Vendas', 'vendas', 'num'),
      col('Quebras', 'quebras', 'num'), col('Acertos', 'ajustes', 'num'), col('Stock', 'stock', 'num'), col('Mínimo', 'minimo', 'num'), col('Valor', 'valor', 'kz')], linhas }],
    alertas: [
      ...(abaixo.length ? [`No mínimo ou abaixo: ${abaixo.slice(0, 10).map(l => l.item).join(', ')}${abaixo.length > 10 ? '…' : ''}.`] : []),
      ...(ajustesNeg.length ? [`Acertos negativos (falta na contagem): ${ajustesNeg.slice(0, 10).map(l => `${l.item} ${l.ajustes}`).join(', ')}.`] : []),
    ],
  };
}

// ── Quebras e desperdício ──
async function quebras(tenantId, de, ate) {
  const r = await pool.query(`
    SELECT (m.criado_em AT TIME ZONE 'Africa/Luanda')::date AS dia, s.nome, s.unidade, ABS(m.quantidade) AS qtd, m.motivo, f.nome AS quem,
           ABS(m.quantidade) * s.custo_unitario AS valor
      FROM movimentos_stock m JOIN stock_items s ON s.id = m.stock_item_id LEFT JOIN funcionarios f ON f.id = m.operador_id
     WHERE s.tenant_id = $1 AND m.tipo = 'DESPERDICIO' AND ${NO_PERIODO('m.criado_em')} ORDER BY m.criado_em`, [tenantId, de, ate]);
  const linhas = r.rows.map(x => ({ dia: String(x.dia instanceof Date ? x.dia.toISOString().slice(0, 10) : x.dia), item: x.nome, quantidade: N(x.qtd), unidade: x.unidade, motivo: x.motivo || '', quem: x.quem || '', valor: x.valor === null ? null : arred(x.valor) }));
  // a mesma quebra (artigo e quantidade) em dias diferentes pode ser um registo repetido
  const vistos = new Map(), repetidas = new Set();
  for (const l of linhas) { const k = `${l.item}|${l.quantidade}`; if (vistos.has(k) && vistos.get(k) !== l.dia) repetidas.add(`${l.item} (${l.quantidade} ${l.unidade})`); vistos.set(k, l.dia); }
  return {
    titulo: 'Quebras e desperdício', sem_dados: !linhas.length,
    resumo: [{ rotulo: 'Registos', valor: linhas.length, formato: 'num' }, { rotulo: 'Valor ao custo', valor: arred(linhas.reduce((a, l) => a + N(l.valor), 0)), formato: 'kz' }],
    seccoes: [{ titulo: 'Registos', colunas: [col('Dia', 'dia'), col('Artigo', 'item'), col('Qtd', 'quantidade', 'num'), col('Motivo', 'motivo'), col('Quem', 'quem'), col('Valor', 'valor', 'kz')], linhas }],
    alertas: [
      ...(repetidas.size ? [`Quebras iguais em dias diferentes (confirmar se não são registos repetidos): ${[...repetidas].join(', ')}.`] : []),
      ...(linhas.some(l => l.valor === null) ? ['Há quebras de artigos sem custo: o valor real é maior do que o mostrado.'] : []),
    ],
  };
}

// ── Margem por produto ──
async function margem(tenantId, de, ate) {
  const r = await require('./financeiro.service').resultado({ tenantId, de, ate });
  const linhas = r.por_produto.map(p => ({ produto: p.nome, quantidade: p.quantidade, receita: p.receita, custo: p.sem_receita ? null : p.custo, margem: p.sem_receita ? null : p.margem, margem_pct: p.sem_receita ? null : p.margem_pct }));
  const baixas = linhas.filter(l => l.margem_pct !== null && l.margem_pct < 30);
  return {
    titulo: 'Margem por produto', sem_dados: !linhas.length,
    resumo: [
      { rotulo: 'Receita de vendas', valor: r.receita.vendas, formato: 'kz' }, { rotulo: 'Custo das vendas', valor: r.custo_vendas, formato: 'kz' },
      { rotulo: 'Margem bruta', valor: r.margem_bruta, formato: 'kz' }, { rotulo: 'Margem bruta %', valor: r.margem_bruta_pct, formato: 'pct' },
      { rotulo: 'Vendas sem custo conhecido', valor: r.receita_sem_custo, formato: 'kz' },
    ],
    seccoes: [{ titulo: 'Produtos (até 50, por receita)', colunas: [col('Produto', 'produto'), col('Qtd', 'quantidade', 'num'), col('Receita', 'receita', 'kz'), col('Custo', 'custo', 'kz'), col('Margem', 'margem', 'kz'), col('Margem %', 'margem_pct', 'pct')], linhas }],
    alertas: [
      ...(r.receita_sem_custo > 0 ? [`${r.receita_sem_custo} Kz vendidos em produtos sem receita de stock ou sem custo: preencha-os para a margem ser real.`] : []),
      ...(baixas.length ? [`Margem abaixo de 30 %: ${baixas.slice(0, 8).map(l => l.produto).join(', ')}.`] : []),
    ],
  };
}

// ── Dívidas de clientes por antiguidade (no fim do período) ──
async function dividas(tenantId, de, ate) {
  const r = await pool.query(`
    SELECT c.id, c.nome, c.telefone, m.tipo, m.valor, (m.criado_em AT TIME ZONE 'Africa/Luanda')::date AS dia
      FROM conta_corrente_movimentos m JOIN clientes c ON c.id = m.cliente_id
     WHERE m.tenant_id = $1 AND (m.criado_em AT TIME ZONE 'Africa/Luanda')::date <= $2::date ORDER BY m.criado_em`, [tenantId, ate]);
  const fim = new Date(ate + 'T00:00:00Z');
  const porCliente = new Map();
  for (const x of r.rows) {
    const c = porCliente.get(x.id) || { cliente: x.nome, telefone: x.telefone || '', debitos: [], pago: 0 };
    if (x.tipo === 'DEBITO') c.debitos.push({ valor: N(x.valor), dia: new Date(x.dia) }); else c.pago += N(x.valor);
    porCliente.set(x.id, c);
  }
  const linhas = [];
  for (const c of porCliente.values()) {
    let pago = c.pago; const l = { cliente: c.cliente, telefone: c.telefone, ate7: 0, ate30: 0, mais30: 0, total: 0 };
    for (const d of c.debitos) { // os pagamentos abatem as dívidas mais antigas primeiro
      const resto = Math.max(0, d.valor - pago); pago = Math.max(0, pago - d.valor);
      if (!resto) continue;
      const idade = Math.round((fim - d.dia) / 86400000);
      l[idade <= 7 ? 'ate7' : idade <= 30 ? 'ate30' : 'mais30'] += resto;
    }
    l.total = arred(l.ate7 + l.ate30 + l.mais30);
    if (l.total > 0) linhas.push({ ...l, ate7: arred(l.ate7), ate30: arred(l.ate30), mais30: arred(l.mais30) });
  }
  linhas.sort((a, b) => b.total - a.total);
  const soma = k => arred(linhas.reduce((a, l) => a + l[k], 0));
  return {
    titulo: `Dívidas de clientes (situação a ${ate.split('-').reverse().join('/')})`, sem_dados: !linhas.length,
    resumo: [{ rotulo: 'Clientes em dívida', valor: linhas.length, formato: 'num' }, { rotulo: 'Total em dívida', valor: soma('total'), formato: 'kz' }, { rotulo: 'Há mais de 30 dias', valor: soma('mais30'), formato: 'kz' }],
    seccoes: [{ titulo: 'Por cliente e antiguidade', colunas: [col('Cliente', 'cliente'), col('Telefone', 'telefone'), col('0–7 dias', 'ate7', 'kz'), col('8–30 dias', 'ate30', 'kz'), col('+30 dias', 'mais30', 'kz'), col('Total', 'total', 'kz')],
      linhas, total: { cliente: 'Total', ate7: soma('ate7'), ate30: soma('ate30'), mais30: soma('mais30'), total: soma('total') } }],
    alertas: soma('mais30') > 0 ? [`${soma('mais30')} Kz em dívidas com mais de 30 dias.`] : [],
  };
}

// ── Ocupação dos quartos ──
async function quartos(tenantId, de, ate) {
  const v = [tenantId, de, ate];
  const [q, r] = await Promise.all([
    pool.query(`SELECT id, numero, tipo FROM quartos WHERE tenant_id = $1 ORDER BY numero`, [tenantId]),
    pool.query(`SELECT rv.quarto_id, rv.fracao, rv.valor_total, rv.checkin, rv.checkout FROM reservas rv JOIN quartos q ON q.id = rv.quarto_id
                 WHERE q.tenant_id = $1 AND rv.status <> 'CANCELADA' AND ${NO_PERIODO('rv.checkin')}`, v),
  ]);
  const horasPeriodo = dias(de, ate) * 24;
  const por = new Map(q.rows.map(x => [x.id, { quarto: x.numero, tipo: x.tipo, horas_n: 0, noite_n: 0, diaria_n: 0, receita: 0, horas: 0 }]));
  for (const x of r.rows) {
    const l = por.get(x.quarto_id); if (!l) continue;
    l[{ DUAS_HORAS: 'horas_n', PERNOITE: 'noite_n', DIARIA: 'diaria_n' }[x.fracao] || 'horas_n']++;
    l.receita = arred(l.receita + N(x.valor_total));
    l.horas += Math.max(0, (new Date(x.checkout) - new Date(x.checkin)) / 3600000);
  }
  const linhas = [...por.values()].map(l => ({ ...l, horas: Math.round(l.horas * 10) / 10, ocupacao: Math.min(100, Math.round(l.horas / horasPeriodo * 1000) / 10) }));
  const receita = arred(linhas.reduce((a, l) => a + l.receita, 0));
  return {
    titulo: 'Ocupação dos quartos', sem_dados: !r.rows.length,
    resumo: [
      { rotulo: 'Vendas de quartos', valor: r.rows.length, formato: 'num' }, { rotulo: 'Receita', valor: receita, formato: 'kz' },
      { rotulo: 'Receita por quarto', valor: linhas.length ? arred(receita / linhas.length) : 0, formato: 'kz' },
      { rotulo: 'Ocupação média', valor: linhas.length ? Math.round(linhas.reduce((a, l) => a + l.ocupacao, 0) / linhas.length * 10) / 10 : 0, formato: 'pct' },
    ],
    seccoes: [{ titulo: 'Por quarto', colunas: [col('Quarto', 'quarto'), col('Tipo', 'tipo'), col(FRACAO.DUAS_HORAS, 'horas_n', 'num'), col(FRACAO.PERNOITE, 'noite_n', 'num'), col(FRACAO.DIARIA, 'diaria_n', 'num'),
      col('Horas ocupado', 'horas', 'num'), col('Ocupação %', 'ocupacao', 'pct'), col('Receita', 'receita', 'kz')], linhas, total: { quarto: 'Total', receita } }],
    alertas: linhas.filter(l => !l.receita).length ? [`Quartos sem vendas no período: ${linhas.filter(l => !l.receita).map(l => l.quarto).join(', ')}.`] : [],
  };
}

// ── Diferenças de caixa ──
async function caixaDiferencas(tenantId, de, ate) {
  const r = await pool.query(`
    SELECT s.aberta_em, s.fechada_em, s.fundo_inicial, s.esperado, s.contado, s.diferenca, s.justificacao, fa.nome AS abriu, ff.nome AS fechou
      FROM caixa_sessoes s LEFT JOIN funcionarios fa ON fa.id = s.aberta_por LEFT JOIN funcionarios ff ON ff.id = s.fechada_por
     WHERE s.tenant_id = $1 AND s.fechada_em IS NOT NULL AND ${NO_PERIODO('s.fechada_em')} ORDER BY s.fechada_em`, [tenantId, de, ate]);
  const hora = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const linhas = r.rows.map(x => ({ sessao: `${hora(x.aberta_em)} → ${hora(x.fechada_em)}`, fechou: x.fechou || x.abriu || '', fundo: N(x.fundo_inicial), esperado: N(x.esperado), contado: N(x.contado), diferenca: N(x.diferenca), justificacao: x.justificacao || '' }));
  const comDif = linhas.filter(l => Math.abs(l.diferenca) >= 0.01);
  return {
    titulo: 'Diferenças de caixa', sem_dados: !linhas.length,
    resumo: [
      { rotulo: 'Sessões fechadas', valor: linhas.length, formato: 'num' }, { rotulo: 'Com diferença', valor: comDif.length, formato: 'num' },
      { rotulo: 'Faltas', valor: arred(comDif.filter(l => l.diferenca < 0).reduce((a, l) => a + l.diferenca, 0)), formato: 'kz' },
      { rotulo: 'Sobras', valor: arred(comDif.filter(l => l.diferenca > 0).reduce((a, l) => a + l.diferenca, 0)), formato: 'kz' },
    ],
    seccoes: [{ titulo: 'Sessões', colunas: [col('Sessão', 'sessao'), col('Fechou', 'fechou'), col('Fundo', 'fundo', 'kz'), col('Esperado', 'esperado', 'kz'), col('Contado', 'contado', 'kz'), col('Diferença', 'diferenca', 'kz'), col('Justificação', 'justificacao')], linhas }],
    alertas: comDif.length ? [`${comDif.length} sessão(ões) com diferença na contagem.`] : [],
  };
}

// ── Resultado do período (com o período anterior) ──
async function resultado(tenantId, de, ate) {
  const fin = require('./financeiro.service');
  const n = dias(de, ate);
  const ant = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  const [a, b] = await Promise.all([fin.resultado({ tenantId, de, ate }), fin.resultado({ tenantId, de: ant(de), ate: ant(ate) })]);
  const var_ = (x, y) => (y ? Math.round((x - y) / Math.abs(y) * 1000) / 10 : null);
  const linha = (rotulo, x, y) => ({ rubrica: rotulo, actual: x, anterior: y, variacao: var_(x, y) });
  return {
    titulo: 'Resultado do período', sem_dados: !a.receita.total && !a.total_despesas,
    resumo: [{ rotulo: 'Receita', valor: a.receita.total, formato: 'kz' }, { rotulo: 'Resultado', valor: a.resultado, formato: 'kz' }, { rotulo: 'Margem bruta %', valor: a.margem_bruta_pct, formato: 'pct' }],
    seccoes: [
      { titulo: `Comparação com ${ant(de).split('-').reverse().join('/')} a ${ant(ate).split('-').reverse().join('/')}`, colunas: [col('Rubrica', 'rubrica'), col('Período', 'actual', 'kz'), col('Anterior', 'anterior', 'kz'), col('Variação %', 'variacao', 'pct')],
        linhas: [linha('Vendas', a.receita.vendas, b.receita.vendas), linha('Alojamento', a.receita.alojamento, b.receita.alojamento), linha('Receita total', a.receita.total, b.receita.total),
          linha('Custo das vendas', a.custo_vendas, b.custo_vendas), linha('Despesas', a.total_despesas, b.total_despesas), linha('Resultado', a.resultado, b.resultado)] },
      { titulo: 'Despesas por categoria', colunas: [col('Categoria', 'rotulo'), col('N.º', 'n', 'num'), col('Valor', 'valor', 'kz')], linhas: a.despesas, total: { rotulo: 'Total', valor: a.total_despesas } },
    ],
    alertas: [
      ...(a.receita_sem_custo > 0 ? [`${a.receita_sem_custo} Kz de vendas sem custo conhecido: o resultado real é menor.`] : []),
      ...(a.por_receber.valor > 0 ? [`${a.por_receber.valor} Kz em contas fechadas por receber.`] : []),
    ],
  };
}

const CATALOGO = {
  FOLHA_CAIXA: { nome: 'Folha de Caixa', frequencias: ['DIA'], gerar: (t, de) => folhaCaixa(t, de), licenca: 'caixa' },
  VENDAS: { nome: 'Vendas', frequencias: ['DIA', 'SEMANA', 'MES'], gerar: vendas },
  CAIXA_DIFERENCAS: { nome: 'Diferenças de caixa', frequencias: ['DIA', 'SEMANA', 'MES'], gerar: caixaDiferencas, licenca: 'caixa' },
  QUEBRAS: { nome: 'Quebras e desperdício', frequencias: ['DIA', 'SEMANA', 'MES'], gerar: quebras },
  COMPRAS: { nome: 'Compras por fornecedor e área', frequencias: ['DIA', 'SEMANA', 'MES'], gerar: compras },
  STOCK: { nome: 'Stock: movimento e valor', frequencias: ['SEMANA', 'MES'], gerar: stock },
  MARGEM: { nome: 'Margem por produto', frequencias: ['SEMANA', 'MES'], gerar: margem },
  QUARTOS: { nome: 'Ocupação dos quartos', frequencias: ['DIA', 'SEMANA', 'MES'], gerar: quartos, licenca: 'hospedagem' },
  DIVIDAS: { nome: 'Dívidas de clientes', frequencias: ['SEMANA', 'MES'], gerar: dividas, licenca: 'caixa' },
  RESULTADO: { nome: 'Resultado do período', frequencias: ['SEMANA', 'MES'], gerar: resultado },
};

/** Gera um relatório (não guarda). */
async function gerar(tenantId, tipo, de, ate) {
  const c = CATALOGO[tipo];
  if (!c) throw erro(400, 'Tipo de relatório desconhecido');
  const r = await c.gerar(tenantId, de, ate);
  return { tipo, de, ate, alertas: [], seccoes: [], resumo: [], ...r };
}

module.exports = { CATALOGO, gerar, dias };
