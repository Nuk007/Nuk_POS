'use strict';
/**
 * CaixaService — Caixa do dia (turno): abrir com fundo, receber valores, carregar Nuk-Coin, vender cartões de consumo
 * e fechar com contagem. Tudo o que mexe em dinheiro exige o caixa aberto e fica no livro-razão `caixa_movimentos`.
 * Dinheiro esperado na gaveta = fundo + Σ movimentos em CASH (TPA, transferência, Nuk-Coin e cartão não entram na gaveta).
 */
const crypto = require('crypto');
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { withTx, erro } = require('./shared');
const portal = require('./portal.service');
const ocupacao = require('./ocupacao.service');
const contaCorrente = require('./conta-corrente.service');

const METODOS_BALCAO = ['CASH', 'TPA', 'TRANSFERENCIA', 'EXPRESS'];
const METODOS_RECEBIMENTO = [...METODOS_BALCAO, 'NUKCOIN', 'CARTAO', 'CONTA']; // CONTA = conta corrente do cliente (crédito)
const CARTAO_MIN = 1000, CARTAO_MAX = 500000;
const MAX_PARCELAS = 4; // pagamento misto: até 4 formas numa só conta
const arred = n => Math.round(n * 100) / 100;
const T = tenantId => tenantId || null;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para não haver enganos ao ler o cartão

async function sessaoAberta(db, tenantId, bloquear = false) {
  const r = await db.query(`SELECT * FROM caixa_sessoes WHERE tenant_id = $1 AND fechada_em IS NULL ${bloquear ? 'FOR UPDATE' : ''}`, [tenantId]);
  return r.rows[0] || null;
}
async function exigirSessao(db, tenantId) {
  const s = await sessaoAberta(db, tenantId);
  if (!s) throw erro(409, 'O caixa está fechado. Abra o caixa do dia primeiro.', { codigo: 'CAIXA_FECHADO' });
  return s;
}
async function registar(db, { tenantId, sessaoId, tipo, metodo, valor, descricao, pedidoId, clienteId, cartaoId, userId }) {
  await db.query(
    `INSERT INTO caixa_movimentos (tenant_id, sessao_id, tipo, metodo, valor, descricao, pedido_id, cliente_id, cartao_id, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [tenantId, sessaoId, tipo, metodo, valor, descricao || null, pedidoId || null, clienteId || null, cartaoId || null, userId || null]);
}
function validarMetodo(metodo, lista) {
  const m = String(metodo || 'CASH').toUpperCase();
  if (!lista.includes(m)) throw erro(400, `Forma de pagamento inválida. Aceites: ${lista.join(', ')}`);
  return m;
}

// ── Abrir / estado / fechar ─────────────────────────────────
async function abrir({ tenantId, userId, fundo_inicial }) {
  const fundo = fundo_inicial === undefined || fundo_inicial === '' ? 0 : Number(fundo_inicial);
  if (!Number.isFinite(fundo) || fundo < 0 || fundo > 100000000) throw erro(400, 'Fundo de caixa inválido');
  try {
    const r = await pool.query(`INSERT INTO caixa_sessoes (tenant_id, aberta_por, fundo_inicial) VALUES ($1,$2,$3) RETURNING *`, [tenantId, userId || null, arred(fundo)]);
    broadcast('caixa_atualizada', { aberta: true }, tenantId);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw erro(409, 'O caixa já está aberto.');
    throw e;
  }
}

async function resumoDe(db, sessao) {
  const r = await db.query(`SELECT tipo, metodo, COALESCE(SUM(valor),0) AS total, COUNT(*)::int AS n FROM caixa_movimentos WHERE sessao_id = $1 GROUP BY tipo, metodo`, [sessao.id]);
  const porMetodo = {}, porTipo = {};
  let cash = 0;
  for (const l of r.rows) {
    const v = parseFloat(l.total);
    porMetodo[l.metodo] = arred((porMetodo[l.metodo] || 0) + v);
    porTipo[l.tipo] = arred((porTipo[l.tipo] || 0) + v);
    if (l.metodo === 'CASH') cash = arred(cash + v);
  }
  const fundo = parseFloat(sessao.fundo_inicial);
  return { fundo_inicial: fundo, por_metodo: porMetodo, por_tipo: porTipo, dinheiro_recebido: cash, dinheiro_esperado: arred(fundo + cash) };
}

async function estado({ tenantId }) {
  const sessao = await sessaoAberta(pool, tenantId);
  if (!sessao) return { aberta: false, sessao: null };
  const [resumo, mov] = await Promise.all([
    resumoDe(pool, sessao),
    pool.query(
      `SELECT m.id, m.tipo, m.metodo, m.valor, m.descricao, m.criado_em, c.nome AS cliente_nome, f.nome AS operador, p.origem, ms.numero AS mesa_numero
       FROM caixa_movimentos m
       LEFT JOIN clientes c ON c.id = m.cliente_id LEFT JOIN funcionarios f ON f.id = m.criado_por
       LEFT JOIN pedidos p ON p.id = m.pedido_id LEFT JOIN mesas ms ON ms.id = p.mesa_id
       WHERE m.sessao_id = $1 ORDER BY m.criado_em DESC LIMIT 100`, [sessao.id]),
  ]);
  return { aberta: true, sessao, resumo, movimentos: mov.rows };
}

async function fechar({ tenantId, userId, contado, observacoes }) {
  const c = Number(contado);
  if (contado === undefined || contado === '' || !Number.isFinite(c) || c < 0) throw erro(400, 'Indique o dinheiro contado na gaveta');
  const out = await withTx(async db => {
    const s = await sessaoAberta(db, tenantId, true);
    if (!s) throw erro(409, 'O caixa já está fechado.');
    const resumo = await resumoDe(db, s);
    const diferenca = arred(c - resumo.dinheiro_esperado);
    const r = await db.query(
      `UPDATE caixa_sessoes SET fechada_por = $1, fechada_em = NOW(), esperado = $2, contado = $3, diferenca = $4, observacoes = $5 WHERE id = $6 RETURNING *`,
      [userId || null, resumo.dinheiro_esperado, arred(c), diferenca, observacoes ? String(observacoes).slice(0, 500) : null, s.id]);
    return { sessao: r.rows[0], resumo };
  });
  broadcast('caixa_atualizada', { aberta: false }, tenantId);
  return out;
}

async function sessoes({ tenantId }) {
  const r = await pool.query(
    `SELECT s.*, fa.nome AS aberta_por_nome, ff.nome AS fechada_por_nome FROM caixa_sessoes s
     LEFT JOIN funcionarios fa ON fa.id = s.aberta_por LEFT JOIN funcionarios ff ON ff.id = s.fechada_por
     WHERE s.tenant_id = $1 ORDER BY s.aberta_em DESC LIMIT 30`, [tenantId]);
  return r.rows;
}

// ── Nuk-Coin ────────────────────────────────────────────────
async function carregarNukcoin({ tenantId, userId, clienteId, valor, metodo }) {
  const m = validarMetodo(metodo, METODOS_BALCAO);
  return portal.carregar({
    tenantId, clienteId, valor, operadorId: userId,
    aoCarregar: async (db, { valor: v }) => {
      const s = await exigirSessao(db, tenantId);
      await registar(db, { tenantId, sessaoId: s.id, tipo: 'NUKCOIN_CARREGAMENTO', metodo: m, valor: v, descricao: 'Carregamento Nuk-Coin', clienteId, userId });
    },
  }).then(r => { broadcast('caixa_atualizada', {}, tenantId); return { ...r, metodo: m }; });
}

// ── Cartões de consumo ──────────────────────────────────────
const gerarCodigo = () => 'CC' + Array.from(crypto.randomBytes(8), b => ALFABETO[b % ALFABETO.length]).join('');
const normCodigo = c => String(c || '').trim().toUpperCase().replace(/[\s-]/g, '');

async function venderCartao({ tenantId, userId, valor, metodo }) {
  const v = Number(valor);
  if (!Number.isInteger(v) || v < CARTAO_MIN || v > CARTAO_MAX) throw erro(400, `Valor do cartão inválido (${CARTAO_MIN} a ${CARTAO_MAX} Kz, sem cêntimos)`);
  const m = validarMetodo(metodo, METODOS_BALCAO);
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      const cartao = await withTx(async db => {
        const s = await exigirSessao(db, tenantId);
        const c = await db.query(
          `INSERT INTO cartoes_consumo (tenant_id, codigo, valor_inicial, saldo, vendido_por) VALUES ($1,$2,$3,$3,$4) RETURNING id, codigo, valor_inicial, saldo, criado_em`,
          [tenantId, gerarCodigo(), v, userId || null]);
        await db.query(`INSERT INTO movimentos_cartao (cartao_id, tipo, valor, saldo_antes, saldo_depois) VALUES ($1,'VENDA',$2,0,$2)`, [c.rows[0].id, v]);
        await registar(db, { tenantId, sessaoId: s.id, tipo: 'CARTAO_VENDA', metodo: m, valor: v, descricao: `Cartão de consumo ${c.rows[0].codigo}`, cartaoId: c.rows[0].id, userId });
        return c.rows[0];
      });
      broadcast('caixa_atualizada', {}, tenantId);
      return cartao;
    } catch (e) { if (e.code !== '23505') throw e; } // código repetido (raríssimo): tenta outro
  }
  throw erro(500, 'Não foi possível gerar o código do cartão');
}

async function consultarCartao({ tenantId, codigo }) {
  const r = await pool.query(`SELECT id, codigo, valor_inicial, saldo, criado_em FROM cartoes_consumo WHERE tenant_id = $1 AND codigo = $2`, [tenantId, normCodigo(codigo)]);
  if (!r.rows[0]) throw erro(404, 'Cartão não encontrado');
  return r.rows[0];
}
async function listarCartoes({ tenantId }) {
  const r = await pool.query(`SELECT id, codigo, valor_inicial, saldo, criado_em FROM cartoes_consumo WHERE tenant_id = $1 ORDER BY criado_em DESC LIMIT 50`, [tenantId]);
  return r.rows;
}

// ── Recebimento dos pedidos fechados ────────────────────────
async function porReceber({ tenantId }) {
  const r = await pool.query(`
    SELECT p.id, p.origem, p.total, p.criado_em, p.atualizado_em, p.cliente_id, ms.numero AS mesa_numero, qt.numero AS quarto_numero, c.nome AS cliente_nome,
           json_agg(json_build_object('produto_nome', pr.nome, 'quantidade', ip.quantidade, 'preco_unitario', ip.preco_unitario)) FILTER (WHERE ip.id IS NOT NULL) AS itens
    FROM pedidos p
    LEFT JOIN mesas ms ON ms.id = p.mesa_id LEFT JOIN quartos qt ON qt.id = p.quarto_id LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN itens_pedido ip ON ip.pedido_id = p.id LEFT JOIN produtos pr ON pr.id = ip.produto_id
    WHERE p.tenant_id = $1 AND p.status = 'FECHADO' AND p.pago_em IS NULL
    GROUP BY p.id, ms.numero, qt.numero, c.nome ORDER BY p.atualizado_em ASC`, [tenantId]);
  return r.rows;
}

/**
 * Converte o pedido de recebimento em parcelas. Formato novo: `pagamentos: [{ metodo, valor, ... }]` (pagamento misto,
 * ex.: parte em dinheiro e o resto no TPA). Formato antigo (um só `metodo`) continua aceite: uma parcela pelo total.
 */
function parcelasDe({ pagamentos, metodo, pin, cliente_id, codigo_cartao, valor_entregue }, totalCent) {
  if (pagamentos === undefined || pagamentos === null) {
    return [{ metodo: validarMetodo(metodo, METODOS_RECEBIMENTO), cent: totalCent, pin, cliente_id, codigo_cartao, valor_entregue }];
  }
  if (!Array.isArray(pagamentos) || !pagamentos.length || pagamentos.length > MAX_PARCELAS) throw erro(400, `Indique de 1 a ${MAX_PARCELAS} formas de pagamento`);
  const parcelas = pagamentos.map(x => {
    const m = validarMetodo(x && x.metodo, METODOS_RECEBIMENTO);
    const c = Math.round(Number(x.valor) * 100);
    if (!Number.isFinite(c) || c <= 0) throw erro(400, 'Cada forma de pagamento precisa de um valor positivo');
    return { metodo: m, cent: c, pin: x.pin, cliente_id: x.cliente_id, codigo_cartao: x.codigo_cartao, valor_entregue: x.valor_entregue };
  });
  for (const m of ['CASH', 'NUKCOIN', 'CARTAO', 'CONTA']) {
    if (parcelas.filter(x => x.metodo === m).length > 1) throw erro(400, 'Cada forma de pagamento só pode aparecer uma vez');
  }
  const soma = parcelas.reduce((a, x) => a + x.cent, 0);
  if (soma !== totalCent) throw erro(400, `A soma das formas de pagamento (${(soma / 100).toFixed(2)} Kz) tem de ser igual ao total (${(totalCent / 100).toFixed(2)} Kz)`, { total: totalCent / 100, soma: soma / 100 });
  return parcelas;
}

/** Reparte as parcelas pelos pedidos, por ordem (em cêntimos): devolve [{ pedido, parcela, cent }]. */
function repartir(pedidos, parcelas) {
  const out = [];
  const resto = parcelas.map(x => x.cent);
  let k = 0;
  for (const p of pedidos) {
    let falta = Math.round(parseFloat(p.total) * 100);
    while (falta > 0 && k < parcelas.length) {
      const v = Math.min(falta, resto[k]);
      if (v > 0) out.push({ pedido: p, parcela: parcelas[k], cent: v });
      falta -= v; resto[k] -= v;
      if (resto[k] === 0) k++;
    }
  }
  return out;
}

async function receber({ tenantId, userId, pedido_ids, ...dados }) {
  if (!Array.isArray(pedido_ids) || !pedido_ids.length || pedido_ids.length > 50) throw erro(400, 'Escolha os pedidos a receber (até 50)');
  const ids = [...new Set(pedido_ids)];
  // Validação do formato antes de abrir a transacção
  if (dados.pagamentos === undefined || dados.pagamentos === null) validarMetodo(dados.metodo, METODOS_RECEBIMENTO);

  let libertas = { mesas: [], quartos: [] };
  let nukcoinCliente = null;
  const out = await withTx(async db => {
    const s = await exigirSessao(db, tenantId);
    const r = await db.query(`SELECT * FROM pedidos WHERE id = ANY($1::uuid[]) AND tenant_id = $2 ORDER BY id FOR UPDATE`, [ids, tenantId]);
    if (r.rows.length !== ids.length) throw erro(404, 'Algum dos pedidos não foi encontrado');
    for (const p of r.rows) {
      if (p.status !== 'FECHADO') throw erro(409, 'Só se recebe depois de a mesa ou o pedido estar fechado');
      if (p.pago_em) throw erro(409, 'Algum dos pedidos já foi recebido');
    }
    const pedidos = r.rows;
    const totalCent = pedidos.reduce((a, p) => a + Math.round(parseFloat(p.total) * 100), 0);
    const parcelas = parcelasDe(dados, totalCent);
    let troco = null, saldo = null, cliId = null;

    for (const x of parcelas) {
      const valor = x.cent / 100;
      if (x.metodo === 'CASH' && x.valor_entregue !== undefined && x.valor_entregue !== null && x.valor_entregue !== '') {
        const e = Number(x.valor_entregue);
        if (!Number.isFinite(e) || e < valor) throw erro(400, parcelas.length > 1 ? 'O valor entregue é inferior à parte em dinheiro' : 'O valor entregue é inferior ao total');
        troco = arred(e - valor);
      }
      if (x.metodo === 'NUKCOIN') {
        cliId = x.cliente_id || (pedidos.every(p => p.cliente_id && p.cliente_id === pedidos[0].cliente_id) ? pedidos[0].cliente_id : null);
        if (!cliId) throw erro(400, 'Indique o cliente que paga com Nuk-Coin');
        try { await portal.exigirPin(db, tenantId, cliId, x.pin); }
        catch (e) { throw erro(403, e.statusCode === 401 ? 'PIN inválido' : e.message); } // 403 e não 401: o POS faria logout
        const c = await db.query(`SELECT nukcoin_saldo FROM clientes WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [cliId, tenantId]);
        const atual = parseFloat(c.rows[0].nukcoin_saldo);
        if (atual < valor) throw erro(400, 'Saldo Nuk-Coin insuficiente', { saldo_atual: atual, total_necessario: valor });
        x.saldo = atual; x.clienteId = cliId;
      }
      if (x.metodo === 'CONTA') {
        const cid = x.cliente_id || (pedidos.every(p => p.cliente_id && p.cliente_id === pedidos[0].cliente_id) ? pedidos[0].cliente_id : null);
        if (!cid) throw erro(400, 'Indique o cliente com conta corrente');
        await contaCorrente.verificarCredito(db, { tenantId, clienteId: cid, valorCent: x.cent });
        x.clienteId = cid;
      }
      if (x.metodo === 'CARTAO') {
        const c = await db.query(`SELECT id, saldo FROM cartoes_consumo WHERE tenant_id = $1 AND codigo = $2 FOR UPDATE`, [tenantId, normCodigo(x.codigo_cartao)]);
        if (!c.rows[0]) throw erro(404, 'Cartão não encontrado');
        const atual = parseFloat(c.rows[0].saldo);
        if (atual < valor) throw erro(400, 'Saldo do cartão insuficiente', { saldo_atual: atual, total_necessario: valor });
        x.saldo = atual; x.cartaoId = c.rows[0].id;
      }
    }

    // Cada fatia (pedido × forma de pagamento) gera o seu movimento no livro-razão do caixa
    for (const { pedido: p, parcela: x, cent } of repartir(pedidos, parcelas)) {
      const v = cent / 100;
      if (x.metodo === 'NUKCOIN') {
        const depois = arred(x.saldo - v);
        await db.query(`INSERT INTO movimentos_nukcoin (cliente_id, tipo, valor, saldo_antes, saldo_depois, descricao, pedido_id) VALUES ($1,'CONSUMO',$2,$3,$4,'Pagamento no caixa',$5)`, [x.clienteId, v, x.saldo, depois, p.id]);
        await db.query(`UPDATE pedidos SET nukcoin_pago = nukcoin_pago + $1 WHERE id = $2`, [v, p.id]);
        x.saldo = depois;
      }
      if (x.metodo === 'CARTAO') {
        const depois = arred(x.saldo - v);
        await db.query(`INSERT INTO movimentos_cartao (cartao_id, tipo, valor, saldo_antes, saldo_depois, pedido_id) VALUES ($1,'CONSUMO',$2,$3,$4,$5)`, [x.cartaoId, v, x.saldo, depois, p.id]);
        x.saldo = depois;
      }
      if (x.metodo === 'CONTA') {
        // Não entra dinheiro no caixa: a dívida fica na conta corrente do cliente
        await contaCorrente.lancarDebito(db, { tenantId, clienteId: x.clienteId, valor: v, pedidoId: p.id, sessaoId: s.id, userId });
        continue;
      }
      await registar(db, { tenantId, sessaoId: s.id, tipo: 'RECEBIMENTO', metodo: x.metodo, valor: v, descricao: parcelas.length > 1 ? 'Recebimento de pedido (pagamento misto)' : 'Recebimento de pedido', pedidoId: p.id, clienteId: x.clienteId || p.cliente_id, cartaoId: x.cartaoId, userId });
    }
    for (const x of parcelas) {
      if (x.metodo === 'NUKCOIN') { await db.query(`UPDATE clientes SET nukcoin_saldo = $1 WHERE id = $2`, [x.saldo, x.clienteId]); nukcoinCliente = x.clienteId; saldo = x.saldo; }
      if (x.metodo === 'CARTAO') { await db.query(`UPDATE cartoes_consumo SET saldo = $1 WHERE id = $2`, [x.saldo, x.cartaoId]); if (saldo === null) saldo = x.saldo; }
    }
    const metodoFinal = parcelas.length > 1 ? 'MISTO' : parcelas[0].metodo;
    await db.query(`UPDATE pedidos SET pago_em = NOW(), pago_metodo = $1, pago_por = $2 WHERE id = ANY($3::uuid[])`, [metodoFinal, userId || null, ids]);
    // Pago: a mesa/quarto deixa de estar «em uso» se já não tem outras contas por pagar
    libertas = await ocupacao.libertarAposPagamento(db, tenantId, pedidos);
    return {
      total: totalCent / 100, metodo: metodoFinal, pedidos: ids.length, troco, saldo_restante: saldo, cliente_id: cliId,
      pagamentos: parcelas.map(x => ({ metodo: x.metodo, valor: x.cent / 100 })),
    };
  });
  ocupacao.avisarLibertadas(tenantId, libertas);
  broadcast('caixa_atualizada', {}, tenantId);
  if (nukcoinCliente) broadcast('nukcoin_carregado', { cliente_id: nukcoinCliente }, tenantId);
  return out;
}

module.exports = { abrir, estado, fechar, sessoes, carregarNukcoin, venderCartao, consultarCartao, listarCartoes, porReceber, receber, sessaoAberta, METODOS_BALCAO, METODOS_RECEBIMENTO };
