'use strict';
/**
 * Impressão directa em impressoras térmicas (ESC/POS). O servidor prepara o DOCUMENTO (linhas já formatadas para a
 * largura do papel); o navegador do dispositivo converte em ESC/POS e envia por USB, porta série ou Bluetooth.
 *  - Talões de cozinha/bar: `reclamar` devolve os pedidos ainda não impressos para o posto e marca-os como impressos
 *    na mesma transacção (INSERT … ON CONFLICT DO NOTHING) — com vários dispositivos, cada talão sai uma só vez.
 *  - Recibo do cliente (depois de receber no Caixa) e reimpressões.
 * Linha do documento: { t: texto, n?: negrito, g?: tamanho duplo, a?: 'c'|'d' (centro/direita), sep?: true }.
 */
const { pool } = require('../db');
const { withTx, erro } = require('./shared');
const cozinha = require('./cozinha.service');
const { tenantInfo } = require('./documentos.service');

const COLUNAS = [32, 42, 48];
const JANELA_MIN = 120; // só se imprimem talões de pedidos com menos de 2 h (não sai o histórico ao ligar a impressora)
const ORIGENS = { MESA: 'Mesa', BALCAO: 'Balcão', REMOTA: 'Remota (QR)', TAKEAWAY: 'Take Away', QUARTO: 'Quarto', LAZER: 'Lazer', LOJA: 'Loja' };
const METODOS = { CASH: 'Dinheiro', TPA: 'TPA', TRANSFERENCIA: 'Transferência', EXPRESS: 'Express', NUKCOIN: 'Nuk-Coin', CARTAO: 'Cartão de consumo', CONTA: 'Conta corrente', MISTO: 'Vários' };

const largura = c => (COLUNAS.includes(Number(c)) ? Number(c) : 48);
const kz = v => `${Number(v || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
const horaLuanda = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Texto à esquerda e valor à direita na mesma linha. */
function duas(esq, dir, w) {
  const d = String(dir); const e = String(esq);
  const espaco = w - d.length - 1;
  return (e.length > espaco ? e.slice(0, Math.max(0, espaco)) : e).padEnd(Math.max(0, espaco)) + ' ' + d;
}
/** Parte texto comprido em várias linhas. */
function partir(texto, w) {
  const out = []; let linha = '';
  for (const palavra of String(texto).split(/\s+/)) {
    if ((linha + ' ' + palavra).trim().length > w) { if (linha) out.push(linha); linha = palavra.slice(0, w); }
    else linha = (linha + ' ' + palavra).trim();
  }
  if (linha) out.push(linha);
  return out;
}
const ondeDe = p => (p.mesa ? `Mesa ${p.mesa}` : p.quarto ? `Quarto ${p.quarto}` : ORIGENS[p.origem] || p.origem);

function documentoPreparacao(p, posto, w, reimpressao = false) {
  const L = [];
  L.push({ t: posto === 'BAR' ? 'BAR' : 'COZINHA', a: 'c', n: true });
  L.push({ t: ondeDe(p), a: 'c', g: true });
  if (reimpressao) L.push({ t: '** REIMPRESSÃO **', a: 'c' });
  L.push({ t: duas(horaLuanda(p.criado_em), `#${String(p.id).slice(0, 6)}`, w) });
  if (p.funcionario || p.cliente) L.push({ t: [p.funcionario, p.cliente].filter(Boolean).join(' · ').slice(0, w) });
  L.push({ sep: true });
  for (const i of p.itens) {
    partir(`${i.quantidade}x ${i.produto}`, Math.floor(w / 2)).forEach(t => L.push({ t, g: true }));
    if (i.observacoes) partir(`> ${i.observacoes}`, w).forEach(t => L.push({ t, n: true }));
  }
  if (p.observacoes) { L.push({ sep: true }); partir(`Obs.: ${p.observacoes}`, w).forEach(t => L.push({ t, n: true })); }
  return { pedido_id: p.id, posto, colunas: w, linhas: L, cortar: true, gaveta: false };
}

async function pedidosComItens(db, tenantId, { pedidoIds = null, posto, desde = null }) {
  const r = await db.query(`
    SELECT p.id, p.origem, p.criado_em, p.observacoes, m.numero AS mesa, q.numero AS quarto, c.nome AS cliente, f.nome AS funcionario,
           ip.quantidade, ip.observacoes AS item_obs, pr.nome AS produto, pr.categoria
      FROM pedidos p
      JOIN itens_pedido ip ON ip.pedido_id = p.id JOIN produtos pr ON pr.id = ip.produto_id
      LEFT JOIN mesas m ON m.id = p.mesa_id LEFT JOIN quartos q ON q.id = p.quarto_id
      LEFT JOIN clientes c ON c.id = p.cliente_id LEFT JOIN funcionarios f ON f.id = p.funcionario_id
     WHERE p.tenant_id = $1 AND p.status <> 'CANCELADO' AND p.origem NOT IN ('LAZER','LOJA')
       AND NOT (p.origem = 'REMOTA' AND p.validado_em IS NULL)
       AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
       AND ($3::timestamptz IS NULL OR p.criado_em > $3)
     ORDER BY p.criado_em, pr.nome`, [tenantId, pedidoIds, desde]);
  const mapa = await cozinha.postos(db, tenantId);
  const porPedido = new Map();
  for (const x of r.rows) {
    if (cozinha.postoDe(mapa, x.categoria) !== posto) continue;
    const p = porPedido.get(x.id) || { id: x.id, origem: x.origem, criado_em: x.criado_em, observacoes: x.observacoes, mesa: x.mesa, quarto: x.quarto, cliente: x.cliente, funcionario: x.funcionario, itens: [] };
    p.itens.push({ produto: x.produto, quantidade: Number(x.quantidade), observacoes: x.item_obs });
    porPedido.set(x.id, p);
  }
  return [...porPedido.values()];
}

/** Talões novos do posto, já marcados como impressos por este dispositivo (cada um sai uma só vez). */
async function reclamar({ tenantId, userId, posto, colunas, limite = 10 }) {
  if (!['COZINHA', 'BAR'].includes(posto)) throw erro(400, 'Posto inválido (COZINHA ou BAR)');
  const w = largura(colunas);
  return withTx(async db => {
    const candidatos = await pedidosComItens(db, tenantId, { posto, desde: new Date(Date.now() - JANELA_MIN * 60000) });
    const ja = candidatos.length
      ? new Set((await db.query(`SELECT pedido_id FROM impressoes_preparacao WHERE posto = $1 AND pedido_id = ANY($2::uuid[])`, [posto, candidatos.map(p => p.id)])).rows.map(x => x.pedido_id))
      : new Set();
    const docs = [];
    for (const p of candidatos.filter(c => !ja.has(c.id)).slice(0, Math.min(25, Math.max(1, Number(limite) || 10)))) {
      const r = await db.query(
        `INSERT INTO impressoes_preparacao (pedido_id, posto, tenant_id, impresso_por) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING pedido_id`,
        [p.id, posto, tenantId, userId || null]);
      if (r.rows[0]) docs.push(documentoPreparacao(p, posto, w));
    }
    return docs;
  });
}

/** Reimprimir o talão de cozinha/bar de um pedido. */
async function talaoPreparacao({ tenantId, pedidoId, posto, colunas }) {
  if (!['COZINHA', 'BAR'].includes(posto)) throw erro(400, 'Posto inválido (COZINHA ou BAR)');
  const [p] = await pedidosComItens(pool, tenantId, { posto, pedidoIds: [pedidoId] });
  if (!p) throw erro(404, 'Nada deste posto neste pedido');
  return documentoPreparacao(p, posto, largura(colunas), true);
}

/** Recibo do cliente de um ou mais pedidos (a conta da mesa). Abre a gaveta se houve dinheiro. */
async function recibo({ tenantId, pedidoIds, colunas }) {
  if (!Array.isArray(pedidoIds) || !pedidoIds.length || pedidoIds.length > 50) throw erro(400, 'Indique os pedidos (até 50)');
  const w = largura(colunas);
  const ps = await pool.query(`
    SELECT p.id, p.origem, p.total, p.desconto, p.criado_em, p.pago_em, p.pago_metodo, p.status, m.numero AS mesa, q.numero AS quarto, c.nome AS cliente
      FROM pedidos p LEFT JOIN mesas m ON m.id = p.mesa_id LEFT JOIN quartos q ON q.id = p.quarto_id LEFT JOIN clientes c ON c.id = p.cliente_id
     WHERE p.tenant_id = $1 AND p.id = ANY($2::uuid[]) ORDER BY p.criado_em`, [tenantId, pedidoIds]);
  if (ps.rows.length !== new Set(pedidoIds).size) throw erro(404, 'Algum dos pedidos não foi encontrado');
  if (ps.rows.some(p => p.status === 'CANCELADO')) throw erro(409, 'Pedido cancelado não tem recibo');
  const it = await pool.query(`
    SELECT pr.nome, SUM(ip.quantidade) AS qtd, ip.preco_unitario FROM itens_pedido ip JOIN produtos pr ON pr.id = ip.produto_id
     WHERE ip.pedido_id = ANY($1::uuid[]) GROUP BY pr.nome, ip.preco_unitario ORDER BY pr.nome`, [pedidoIds]);
  const mov = await pool.query(`SELECT metodo, SUM(valor) AS v FROM caixa_movimentos WHERE tenant_id = $1 AND pedido_id = ANY($2::uuid[]) AND tipo = 'RECEBIMENTO' GROUP BY metodo`, [tenantId, pedidoIds]);
  const conta = await pool.query(`SELECT COALESCE(SUM(valor),0) AS v FROM conta_corrente_movimentos WHERE tenant_id = $1 AND pedido_id = ANY($2::uuid[]) AND tipo = 'DEBITO'`, [tenantId, pedidoIds]);
  const t = await tenantInfo(tenantId);
  const L = [];
  L.push({ t: t.nome, a: 'c', n: true, g: true });
  if (t.nif) L.push({ t: `NIF ${t.nif}`, a: 'c' });
  if (t.morada) partir(t.morada, w).forEach(x => L.push({ t: x, a: 'c' }));
  if (t.telefone) L.push({ t: `Tel. ${t.telefone}`, a: 'c' });
  L.push({ sep: true });
  const p0 = ps.rows[0];
  L.push({ t: duas(ondeDe(p0), horaLuanda(p0.pago_em || new Date()), w) });
  if (p0.cliente) L.push({ t: `Cliente: ${p0.cliente}`.slice(0, w) });
  L.push({ sep: true });
  for (const i of it.rows) {
    const total = Number(i.qtd) * Number(i.preco_unitario);
    L.push({ t: duas(`${Number(i.qtd)}x ${i.nome}`, kz(total), w) });
  }
  L.push({ sep: true });
  const desconto = ps.rows.reduce((a, p) => a + Number(p.desconto || 0), 0);
  const total = ps.rows.reduce((a, p) => a + Number(p.total), 0);
  if (desconto > 0) L.push({ t: duas('Desconto', `-${kz(desconto)}`, w) });
  L.push({ t: duas('TOTAL', kz(total), Math.floor(w / 2)), n: true, g: true });
  const pagos = mov.rows.map(m => ({ metodo: m.metodo, v: Number(m.v) }));
  if (Number(conta.rows[0].v) > 0) pagos.push({ metodo: 'CONTA', v: Number(conta.rows[0].v) });
  if (pagos.length) { L.push({ t: '' }); pagos.forEach(m => L.push({ t: duas(METODOS[m.metodo] || m.metodo, kz(m.v), w) })); }
  else if (!ps.rows.every(p => p.pago_em)) L.push({ t: 'CONTA POR PAGAR', a: 'c', n: true });
  L.push({ sep: true });
  L.push({ t: process.env.AGT_CERTIFICADO === 'true' ? 'Obrigado pela preferência!' : 'Documento sem validade fiscal', a: 'c' });
  L.push({ t: 'Nuk_POS', a: 'c' });
  return { pedido_ids: pedidoIds, colunas: w, linhas: L, cortar: true, gaveta: pagos.some(m => m.metodo === 'CASH') };
}

module.exports = { reclamar, talaoPreparacao, recibo, COLUNAS, _interno: { duas, partir } };
