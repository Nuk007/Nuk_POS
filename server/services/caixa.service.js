'use strict';
/**
 * CaixaService — Caixa do dia (turno): abrir com fundo, receber valores, carregar Nuk-Coin, vender cartões de consumo
 * (gerados na hora ou pré-impressos por lotes)
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
      `SELECT m.id, m.numero, m.tipo, m.metodo, m.valor, m.descricao, m.criado_em, c.nome AS cliente_nome, f.nome AS operador, p.origem, ms.numero AS mesa_numero
       FROM caixa_movimentos m
       LEFT JOIN clientes c ON c.id = m.cliente_id LEFT JOIN funcionarios f ON f.id = m.criado_por
       LEFT JOIN pedidos p ON p.id = m.pedido_id LEFT JOIN mesas ms ON ms.id = p.mesa_id
       WHERE m.sessao_id = $1 ORDER BY m.numero DESC LIMIT 100`, [sessao.id]),
  ]);
  return { aberta: true, sessao, resumo, movimentos: mov.rows, pendencias: await contasPorPagar(pool, tenantId) };
}

/**
 * Contas por pagar do estabelecimento (regra do dono, 20/11/2026: o caixa nunca fecha enquanto existirem).
 * Conta por pagar = pedido não cancelado sem `pago_em` — a mesma definição que mantém a mesa/quarto em uso
 * (ocupacao.service), excepto contas de 0 Kz (não há nada a cobrar e o Caixa não as recebe: bloqueariam o fecho para sempre).
 * Entram os que ainda estão na cozinha e os remotos por validar: todos têm de ser recebidos, terminados ou recusados antes do fecho.
 */
async function contasPorPagar(db, tenantId) {
  const r = await db.query(
    `SELECT p.id, p.origem, p.status, p.total, p.criado_em, (p.origem = 'REMOTA' AND p.validado_em IS NULL) AS por_validar,
            ms.numero AS mesa_numero, qt.numero AS quarto_numero, c.nome AS cliente_nome
       FROM pedidos p
       LEFT JOIN mesas ms ON ms.id = p.mesa_id LEFT JOIN quartos qt ON qt.id = p.quarto_id LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.tenant_id = $1 AND p.status <> 'CANCELADO' AND p.pago_em IS NULL AND p.perda_em IS NULL AND p.total > 0
      ORDER BY p.criado_em ASC LIMIT 200`, [tenantId]);
  const contas = r.rows;
  return { n: contas.length, total: arred(contas.reduce((a, x) => a + parseFloat(x.total || 0), 0)), contas };
}

/**
 * Fechar o caixa (regras do dono, 20/11/2026):
 *  1. nunca com contas por pagar (409 CONTAS_POR_PAGAR, com a lista);
 *  2. se o dinheiro contado não bater certo com o esperado (ao cêntimo), só com justificação escrita
 *     (409 DIFERENCA_POR_JUSTIFICAR, com esperado/contado/diferença). A justificação fica selada com o fecho.
 */
const JUSTIFICACAO_MIN = 10, JUSTIFICACAO_MAX = 500;
async function fechar({ tenantId, userId, contado, observacoes, justificacao }) {
  const c = Number(contado);
  if (contado === undefined || contado === '' || !Number.isFinite(c) || c < 0) throw erro(400, 'Indique o dinheiro contado na gaveta');
  const just = String(justificacao || '').trim();
  const out = await withTx(async db => {
    const s = await sessaoAberta(db, tenantId, true);
    if (!s) throw erro(409, 'O caixa já está fechado.');
    const pend = await contasPorPagar(db, tenantId);
    if (pend.n) {
      throw erro(409, `Não pode fechar o caixa: ${pend.n === 1 ? 'existe 1 conta' : `existem ${pend.n} contas`} por pagar (${pend.total.toLocaleString('pt-PT')} Kz). ${pend.n === 1 ? 'Receba-a ou termine-a' : 'Receba-as ou termine-as'} primeiro.`,
        { codigo: 'CONTAS_POR_PAGAR', dados: { pendencias: pend } });
    }
    const resumo = await resumoDe(db, s);
    const diferenca = arred(c - resumo.dinheiro_esperado);
    if (diferenca !== 0 && just.length < JUSTIFICACAO_MIN) {
      throw erro(409, `A contagem não bate certo: ${diferenca > 0 ? 'sobram' : 'faltam'} ${Math.abs(diferenca).toLocaleString('pt-PT')} Kz. Escreva a justificação da diferença (pelo menos ${JUSTIFICACAO_MIN} caracteres) para fechar.`,
        { codigo: 'DIFERENCA_POR_JUSTIFICAR', dados: { esperado: resumo.dinheiro_esperado, contado: arred(c), diferenca } });
    }
    const r = await db.query(
      `UPDATE caixa_sessoes SET fechada_por = $1, fechada_em = NOW(), esperado = $2, contado = $3, diferenca = $4, observacoes = $5, justificacao = $6 WHERE id = $7 RETURNING *`,
      [userId || null, resumo.dinheiro_esperado, arred(c), diferenca, observacoes ? String(observacoes).slice(0, 500) : null,
        diferenca !== 0 ? just.slice(0, JUSTIFICACAO_MAX) : null, s.id]);
    return { sessao: r.rows[0], resumo };
  });
  broadcast('caixa_atualizada', { aberta: false }, tenantId);
  return out;
}

/**
 * Conta não paga — o cliente saiu sem pagar (decisão do dono, 20/11/2026). Só a chefia (a rota garante ADMIN/GERENTE),
 * com motivo escrito. A conta deixa de estar por pagar (o caixa pode fechar, a mesa/quarto ficam livres), não é receita
 * e fica selada: não se recebe, não se cancela, não se desfaz. O stock já servido não volta.
 */
const MOTIVO_PERDA_MIN = 10, MOTIVO_PERDA_MAX = 300;
async function registarPerda({ tenantId, userId, pedido_ids, motivo }) {
  if (!Array.isArray(pedido_ids) || !pedido_ids.length || pedido_ids.length > 50) throw erro(400, 'Escolha as contas (até 50)');
  const m = String(motivo || '').trim();
  if (m.length < MOTIVO_PERDA_MIN) throw erro(400, `Escreva o motivo (pelo menos ${MOTIVO_PERDA_MIN} caracteres): o que aconteceu e quem era o cliente, se se souber`);
  const ids = [...new Set(pedido_ids)];
  let libertas = { mesas: [], quartos: [] };
  const out = await withTx(async db => {
    const r = await db.query(`SELECT * FROM pedidos WHERE id = ANY($1::uuid[]) AND tenant_id = $2 ORDER BY id FOR UPDATE`, [ids, tenantId]);
    if (r.rows.length !== ids.length) throw erro(404, 'Alguma das contas não foi encontrada');
    for (const p of r.rows) {
      if (p.status === 'CANCELADO') throw erro(409, 'Uma das contas está cancelada');
      if (p.pago_em) throw erro(409, 'Uma das contas já foi recebida');
      if (p.perda_em) throw erro(409, 'Uma das contas já foi registada como não paga');
      if (!(parseFloat(p.total) > 0)) throw erro(409, 'Uma das contas não tem valor a cobrar');
    }
    const u = await db.query(
      `UPDATE pedidos SET perda_em = NOW(), perda_por = $1, perda_motivo = $2,
              status = CASE WHEN status = 'CANCELADO' THEN status ELSE 'FECHADO' END, atualizado_em = NOW()
        WHERE id = ANY($3::uuid[]) RETURNING id, total, mesa_id, quarto_id, perda_em`, [userId || null, m.slice(0, MOTIVO_PERDA_MAX), ids]);
    libertas = await ocupacao.libertarAposPagamento(db, tenantId, u.rows);
    return { contas: u.rows.length, total: arred(u.rows.reduce((a, x) => a + parseFloat(x.total), 0)) };
  });
  ocupacao.avisarLibertadas(tenantId, libertas);
  broadcast('caixa_atualizada', {}, tenantId);
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

// Regra do dono (20/11/2026): nenhum código de cartão se gera fora da via do Administrador — só por lotes
// (criarLote). A venda «com código gerado na hora» deixou de existir; um trigger na BD recusa cartões sem lote.

async function consultarCartao({ tenantId, codigo }) {
  const r = await pool.query(
    `SELECT c.id, c.codigo, c.valor_inicial, c.saldo, c.estado, c.criado_em, c.vendido_em, l.numero AS lote_numero
       FROM cartoes_consumo c LEFT JOIN cartoes_lotes l ON l.id = c.lote_id
      WHERE c.tenant_id = $1 AND c.codigo = $2`, [tenantId, normCodigo(codigo)]);
  if (!r.rows[0]) throw erro(404, 'Cartão não encontrado');
  return r.rows[0];
}
/** Últimos cartões vendidos (os pré-impressos por vender não aparecem aqui: estão nos lotes). */
async function listarCartoes({ tenantId }) {
  const r = await pool.query(
    `SELECT id, codigo, valor_inicial, saldo, COALESCE(vendido_em, criado_em) AS criado_em FROM cartoes_consumo
      WHERE tenant_id = $1 AND estado = 'ACTIVO' ORDER BY COALESCE(vendido_em, criado_em) DESC LIMIT 50`, [tenantId]);
  return r.rows;
}

// ── Cartões pré-impressos (lotes) ───────────────────────────
// O lote só cria códigos: nenhum dinheiro entra e nenhum cartão tem saldo até ser vendido no caixa.
// Por isso um cartão perdido ou roubado antes da venda não vale nada, e gerar um lote não exige o caixa aberto.
const LOTE_MAX = 200;

async function criarLote({ tenantId, userId, valor, quantidade }) {
  // Só o Administrador gera códigos (verificado também aqui, não só na rota)
  const adm = userId ? await pool.query(`SELECT 1 FROM funcionarios WHERE id = $1 AND tenant_id = $2 AND nivel_acesso = 'ADMIN' AND ativo`, [userId, tenantId]) : { rows: [] };
  if (!adm.rows[0]) throw erro(403, 'Só o Administrador gera códigos de cartão');
  const v = Number(valor), q = Number(quantidade);
  if (!Number.isInteger(v) || v < CARTAO_MIN || v > CARTAO_MAX) throw erro(400, `Valor do cartão inválido (${CARTAO_MIN} a ${CARTAO_MAX} Kz, sem cêntimos)`);
  if (!Number.isInteger(q) || q < 1 || q > LOTE_MAX) throw erro(400, `Quantidade inválida (1 a ${LOTE_MAX} cartões por lote)`);
  const lote = await withTx(async db => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cartoes_lote:${tenantId}`]);
    const n = await db.query(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM cartoes_lotes WHERE tenant_id = $1`, [tenantId]);
    const l = (await db.query(
      `INSERT INTO cartoes_lotes (tenant_id, numero, valor, quantidade, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id, numero, valor, quantidade, criado_em`,
      [tenantId, n.rows[0].n, v, q, userId || null])).rows[0];
    let feitos = 0;
    for (let volta = 0; feitos < q && volta < 10; volta++) { // código repetido (raríssimo): ON CONFLICT ignora e gera outro
      const codigos = Array.from({ length: q - feitos }, gerarCodigo);
      const r = await db.query(
        `INSERT INTO cartoes_consumo (tenant_id, codigo, valor_inicial, saldo, estado, lote_id)
         SELECT $1, x, $2, 0, 'POR_VENDER', $3 FROM unnest($4::text[]) AS x
         ON CONFLICT (tenant_id, codigo) DO NOTHING`, [tenantId, v, l.id, codigos]);
      feitos += r.rowCount;
    }
    if (feitos < q) throw erro(500, 'Não foi possível gerar os códigos do lote');
    return l;
  });
  return { ...lote, vendidos: 0, por_vender: lote.quantidade };
}

async function listarLotes({ tenantId }) {
  const r = await pool.query(
    `SELECT l.id, l.numero, l.valor, l.quantidade, l.criado_em, f.nome AS criado_por_nome,
            COUNT(c.id) FILTER (WHERE c.estado = 'ACTIVO')::int AS vendidos,
            COUNT(c.id) FILTER (WHERE c.estado = 'POR_VENDER')::int AS por_vender
       FROM cartoes_lotes l
       LEFT JOIN cartoes_consumo c ON c.lote_id = l.id
       LEFT JOIN funcionarios f ON f.id = l.criado_por
      WHERE l.tenant_id = $1
      GROUP BY l.id, f.nome ORDER BY l.numero DESC LIMIT 30`, [tenantId]);
  return r.rows;
}

/** Lote com os seus códigos, para imprimir em cartolina. */
async function loteParaImprimir({ tenantId, loteId }) {
  const l = await pool.query(`SELECT id, numero, valor, quantidade, criado_em FROM cartoes_lotes WHERE id = $1 AND tenant_id = $2`, [loteId, tenantId]);
  if (!l.rows[0]) throw erro(404, 'Lote não encontrado');
  const c = await pool.query(`SELECT codigo, estado FROM cartoes_consumo WHERE lote_id = $1 ORDER BY codigo`, [loteId]);
  return { ...l.rows[0], cartoes: c.rows };
}

/**
 * Vende cartões já impressos (1 a 50 de uma vez): o caixa indica os códigos dos cartões que entrega; cada um é cobrado
 * pelo valor impresso, sem desconto, e só então ganha saldo. Com `valor`, todos têm de ser desse valor (o botão
 * escolhido no Caixa). Tudo ou nada: um código errado, já vendido ou de outro valor não vende nenhum.
 */
const VENDA_CARTOES_MAX = 50;
async function venderCartoesImpressos({ tenantId, userId, codigos, valor, metodo }) {
  const m = validarMetodo(metodo, METODOS_BALCAO);
  if (!Array.isArray(codigos) || !codigos.length || codigos.length > VENDA_CARTOES_MAX) throw erro(400, `Indique de 1 a ${VENDA_CARTOES_MAX} códigos de cartão`);
  const cods = codigos.map(normCodigo);
  const maus = cods.filter(c => !/^CC[A-Z0-9]{8}$/.test(c));
  if (maus.length) throw erro(400, `Código inválido: ${maus.join(', ')} (CC + 8 caracteres)`);
  const repetidos = cods.filter((c, i) => cods.indexOf(c) !== i);
  if (repetidos.length) throw erro(400, `Código repetido: ${[...new Set(repetidos)].join(', ')}`);
  const v = valor === undefined || valor === null || valor === '' ? null : Number(valor);
  if (v !== null && !(v > 0)) throw erro(400, 'Valor do cartão inválido');
  const vendidos = await withTx(async db => {
    const s = await exigirSessao(db, tenantId);
    const r = await db.query(`SELECT id, codigo, valor_inicial, estado FROM cartoes_consumo WHERE tenant_id = $1 AND codigo = ANY($2::text[]) ORDER BY id FOR UPDATE`, [tenantId, cods]);
    const faltam = cods.filter(c => !r.rows.some(x => x.codigo === c));
    if (faltam.length) throw erro(404, `Cartão não encontrado: ${faltam.join(', ')}`);
    const jaVendidos = r.rows.filter(x => x.estado !== 'POR_VENDER').map(x => x.codigo);
    if (jaVendidos.length) throw erro(409, jaVendidos.length === 1 ? `Este cartão já foi vendido: ${jaVendidos[0]}` : `Estes cartões já foram vendidos: ${jaVendidos.join(', ')}`, { codigo: 'CARTAO_JA_VENDIDO', codigos: jaVendidos });
    const outros = v === null ? [] : r.rows.filter(x => Math.round(parseFloat(x.valor_inicial) * 100) !== Math.round(v * 100));
    if (outros.length) throw erro(409, outros.map(x => `O cartão ${x.codigo} é de ${parseFloat(x.valor_inicial)} Kz`).join('; ') + `, não de ${v} Kz`, { codigo: 'CARTAO_OUTRO_VALOR', codigos: outros.map(x => x.codigo) });
    const saida = [];
    for (const cod of cods) { // pela ordem em que o caixa os leu
      const c = r.rows.find(x => x.codigo === cod);
      const val = parseFloat(c.valor_inicial);
      const u = await db.query(
        `UPDATE cartoes_consumo SET estado = 'ACTIVO', saldo = valor_inicial, vendido_por = $2, vendido_em = NOW() WHERE id = $1
         RETURNING id, codigo, valor_inicial, saldo, estado, vendido_em`, [c.id, userId || null]);
      await db.query(`INSERT INTO movimentos_cartao (cartao_id, tipo, valor, saldo_antes, saldo_depois) VALUES ($1,'VENDA',$2,0,$2)`, [c.id, val]);
      await registar(db, { tenantId, sessaoId: s.id, tipo: 'CARTAO_VENDA', metodo: m, valor: val, descricao: `Cartão de consumo ${c.codigo}`, cartaoId: c.id, userId });
      saida.push(u.rows[0]);
    }
    return saida;
  });
  broadcast('caixa_atualizada', {}, tenantId);
  const total = Math.round(vendidos.reduce((t, c) => t + parseFloat(c.valor_inicial) * 100, 0)) / 100;
  return { cartoes: vendidos, quantidade: vendidos.length, total, metodo: m };
}

/** Vende um cartão já impresso pelo código (o valor é o impresso). */
async function venderCartaoImpresso({ tenantId, userId, codigo, metodo }) {
  const cod = normCodigo(codigo);
  if (!/^CC[A-Z0-9]{8}$/.test(cod)) throw erro(400, 'Código do cartão inválido (CC + 8 caracteres)');
  return (await venderCartoesImpressos({ tenantId, userId, codigos: [cod], metodo })).cartoes[0];
}

// ── Tipos de cartão (botões do Caixa; configuração só ADMIN) ──
const CARTAO_VALORES_PADRAO = [2000, 3000, 5000, 6000, 12000, 15000, 20000, 25000]; // decisão do dono de 20/11/2026

async function listarTiposCartao({ tenantId, todos = false }) {
  const existe = await pool.query(`SELECT 1 FROM cartoes_tipos WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  if (!existe.rows[0]) { // 1.ª leitura: semeia os valores padrão
    await pool.query(`INSERT INTO cartoes_tipos (tenant_id, valor) SELECT $1, x FROM unnest($2::numeric[]) AS x ON CONFLICT (tenant_id, valor) DO NOTHING`, [tenantId, CARTAO_VALORES_PADRAO]);
  }
  const r = await pool.query(
    `SELECT t.id, t.valor, t.nome, t.ativo,
            (SELECT COUNT(*) FROM cartoes_consumo c WHERE c.tenant_id = t.tenant_id AND c.estado = 'POR_VENDER' AND c.valor_inicial = t.valor)::int AS por_vender
       FROM cartoes_tipos t WHERE t.tenant_id = $1 ${todos ? '' : 'AND t.ativo'} ORDER BY t.valor`, [tenantId]);
  return r.rows;
}
async function criarTipoCartao({ tenantId, valor, nome }) {
  const v = Number(valor);
  if (!Number.isInteger(v) || v < CARTAO_MIN || v > CARTAO_MAX) throw erro(400, `Valor do cartão inválido (${CARTAO_MIN} a ${CARTAO_MAX} Kz, sem cêntimos)`);
  const n = nome === undefined || nome === null ? null : String(nome).trim().slice(0, 60) || null;
  try {
    const r = await pool.query(`INSERT INTO cartoes_tipos (tenant_id, valor, nome) VALUES ($1,$2,$3) RETURNING id, valor, nome, ativo`, [tenantId, v, n]);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw erro(409, 'Já existe um cartão com esse valor (se estiver desactivado, active-o)');
    throw e;
  }
}
async function actualizarTipoCartao({ tenantId, id, nome, ativo }) {
  const sets = [], vals = [id, tenantId];
  if (nome !== undefined) { vals.push(nome === null ? null : String(nome).trim().slice(0, 60) || null); sets.push(`nome = $${vals.length}`); }
  if (ativo !== undefined) { if (typeof ativo !== 'boolean') throw erro(400, 'ativo deve ser verdadeiro ou falso'); vals.push(ativo); sets.push(`ativo = $${vals.length}`); }
  if (!sets.length) throw erro(400, 'Nada para alterar (o valor de um cartão não muda: crie outro)');
  const r = await pool.query(`UPDATE cartoes_tipos SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING id, valor, nome, ativo`, vals);
  if (!r.rows[0]) throw erro(404, 'Cartão não encontrado');
  return r.rows[0];
}

// ── Recebimento dos pedidos fechados ────────────────────────
async function porReceber({ tenantId }) {
  const r = await pool.query(`
    SELECT p.id, p.origem, p.total, p.criado_em, p.atualizado_em, p.cliente_id, ms.numero AS mesa_numero, qt.numero AS quarto_numero, c.nome AS cliente_nome,
           json_agg(json_build_object('id', ip.id, 'produto_nome', pr.nome, 'quantidade', ip.quantidade, 'preco_unitario', ip.preco_unitario) ORDER BY pr.nome) FILTER (WHERE ip.id IS NOT NULL) AS itens,
           p.desconto, p.nukcoin_pago
    FROM pedidos p
    LEFT JOIN mesas ms ON ms.id = p.mesa_id LEFT JOIN quartos qt ON qt.id = p.quarto_id LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN itens_pedido ip ON ip.pedido_id = p.id LEFT JOIN produtos pr ON pr.id = ip.produto_id
    WHERE p.tenant_id = $1 AND p.status = 'FECHADO' AND p.pago_em IS NULL AND p.perda_em IS NULL
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
    // Regra do dono (20/11/2026): a conta das mesas não inclui os quartos — nunca se recebem juntas
    if (r.rows.some(p => p.mesa_id) && r.rows.some(p => p.quarto_id || p.origem === 'QUARTO')) {
      throw erro(409, 'A conta da mesa não pode incluir contas de quartos. Receba-as em separado.', { codigo: 'MESA_E_QUARTO' });
    }
    for (const p of r.rows) {
      if (p.status !== 'FECHADO') throw erro(409, 'Só se recebe depois de a mesa ou o pedido estar fechado');
      if (p.pago_em) throw erro(409, 'Algum dos pedidos já foi recebido');
      if (p.perda_em) throw erro(409, 'Esta conta foi registada como não paga e já não se recebe', { codigo: 'CONTA_NAO_PAGA' });
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
        // 403 e não 401: o POS faria logout. A falha do PIN regista-se depois da transacção (portal.tratarFalhaPin)
        catch (e) { throw erro(e.statusCode === 423 ? 423 : 403, e.statusCode === 401 ? 'PIN inválido' : e.message, { ...(e.pinFalhou ? { pinFalhou: e.pinFalhou } : {}), ...(e.codigo ? { codigo: e.codigo } : {}) }); }
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
        const c = await db.query(`SELECT id, saldo, estado FROM cartoes_consumo WHERE tenant_id = $1 AND codigo = $2 FOR UPDATE`, [tenantId, normCodigo(x.codigo_cartao)]);
        if (!c.rows[0]) throw erro(404, 'Cartão não encontrado');
        if (c.rows[0].estado !== 'ACTIVO') throw erro(409, 'Este cartão ainda não foi vendido no caixa', { codigo: 'CARTAO_POR_VENDER' });
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
  }).catch(portal.tratarFalhaPin);
  ocupacao.avisarLibertadas(tenantId, libertas);
  broadcast('caixa_atualizada', {}, tenantId);
  if (nukcoinCliente) broadcast('nukcoin_carregado', { cliente_id: nukcoinCliente }, tenantId);
  return out;
}

/**
 * Dividir a conta (benchmarking WinREST, 14/11/2026): passa itens (ou parte das quantidades) de um pedido FECHADO
 * e por receber para uma conta nova da mesma mesa/quarto, que se recebe à parte. O stock já foi abatido e não muda.
 * Recusa: pedido com desconto ou Nuk-Coin já aplicado, pedido já facturado, ou passar tudo (nada ficaria na original).
 */
async function dividirConta({ tenantId, userId, pedido_id, itens }) {
  if (!Array.isArray(itens) || !itens.length || itens.length > 100) throw erro(400, 'Escolha os itens a separar');
  const pedidos = await withTx(async db => {
    const r = await db.query(`SELECT * FROM pedidos WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [pedido_id, tenantId]);
    const p = r.rows[0];
    if (!p) throw erro(404, 'Pedido não encontrado');
    if (p.status !== 'FECHADO' || p.pago_em) throw erro(409, 'Só se divide uma conta fechada e ainda por receber');
    if (parseFloat(p.desconto) > 0 || parseFloat(p.nukcoin_pago) > 0) throw erro(409, 'Esta conta tem desconto ou Nuk-Coin aplicado: receba-a inteira');
    const fat = await require('./fiscal/faturas.service').documentoActivo(db, 'pedido_id', pedido_id);
    if (fat) throw erro(409, 'Esta conta já foi facturada: não se divide');
    const it = await db.query(`SELECT * FROM itens_pedido WHERE pedido_id = $1 ORDER BY id FOR UPDATE`, [pedido_id]);
    const porId = new Map(it.rows.map(x => [x.id, x]));
    const mover = new Map();
    for (const x of itens) {
      const linha = porId.get(x && x.item_id);
      if (!linha) throw erro(404, 'Algum dos itens não pertence a esta conta');
      const q = Number(x.quantidade);
      if (!Number.isFinite(q) || q <= 0 || q > Number(linha.quantidade) || Math.abs(Math.round(q * 1000) - q * 1000) > 1e-6) throw erro(400, 'Quantidade inválida'); // até ao grama (venda ao peso)
      mover.set(linha.id, (mover.get(linha.id) || 0) + q);
      if (mover.get(linha.id) > Number(linha.quantidade)) throw erro(400, 'Quantidade inválida');
    }
    const fica = it.rows.reduce((a, l) => a + Number(l.quantidade) - (mover.get(l.id) || 0), 0);
    if (fica <= 0) throw erro(400, 'Deixe pelo menos um item na conta original');

    const nova = (await db.query(`
      INSERT INTO pedidos (tenant_id, mesa_id, quarto_id, cliente_id, funcionario_id, status, total, observacoes, origem, validado_em, validado_por, tabela_preco_id, criado_em)
      VALUES ($1,$2,$3,$4,$5,'FECHADO',0,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [tenantId, p.mesa_id, p.quarto_id, p.cliente_id, p.funcionario_id, `Conta dividida (de ${String(p.id).slice(0, 8)})`, p.origem, p.validado_em || new Date(), p.validado_por, p.tabela_preco_id, p.criado_em])).rows[0].id;
    for (const [id, q] of mover) {
      const l = porId.get(id);
      if (q === Number(l.quantidade)) await db.query(`UPDATE itens_pedido SET pedido_id = $1 WHERE id = $2`, [nova, id]);
      else {
        await db.query(`UPDATE itens_pedido SET quantidade = quantidade - $1 WHERE id = $2`, [q, id]);
        await db.query(`INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario, status_cozinha, observacoes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [nova, l.produto_id, q, l.preco_unitario, l.status_cozinha, l.observacoes]);
      }
    }
    const tot = `UPDATE pedidos SET total = (SELECT COALESCE(ROUND(SUM(quantidade * preco_unitario), 2), 0) FROM itens_pedido WHERE pedido_id = $1), atualizado_em = NOW() WHERE id = $1 RETURNING id, total`;
    const a = (await db.query(tot, [pedido_id])).rows[0], b = (await db.query(tot, [nova])).rows[0];
    return { original: { id: a.id, total: Number(a.total) }, nova: { id: b.id, total: Number(b.total) } };
  });
  broadcast('caixa_atualizada', {}, tenantId);
  return pedidos;
}

/**
 * Factura-recibo (FR) da conta recebida no Caixa: um só documento para todos os pedidos recebidos juntos
 * (a conta inteira da mesa). As regras fiscais (pedidos FECHADOS, já recebidos, sem documento activo) são do serviço fiscal.
 */
async function faturar({ tenantId, userId, pedido_ids, nif_cliente, nome_cliente }) {
  return require('./fiscal/faturas.service').emitir({ tenantId, userId, tipo: 'FR', pedido_ids, nif_cliente, nome_cliente });
}

module.exports = { faturar, abrir, estado, fechar, contasPorPagar, registarPerda, sessoes, carregarNukcoin, consultarCartao, listarCartoes, criarLote, listarLotes, loteParaImprimir, venderCartaoImpresso, venderCartoesImpressos, listarTiposCartao, criarTipoCartao, actualizarTipoCartao, porReceber, receber, dividirConta, sessaoAberta, METODOS_BALCAO, METODOS_RECEBIMENTO };
