'use strict';
/**
 * Ecrã de cozinha e bar (KDS). Cada categoria de produto vai para um posto: COZINHA, BAR ou NENHUM (não se prepara,
 * ex.: loja, cigarros). O ADMIN ajusta em Configurações (configuracoes.postos_preparacao, JSON categoria → posto).
 *  - Lista: pedidos activos validados (não cancelados, remotos já aceites, sem Lazer/Loja) com itens do posto
 *    ainda não entregues, os mais antigos primeiro.
 *  - Avançar: AGUARDANDO → PREPARANDO → PRONTO → ENTREGUE (por item ou todos os itens do posto no pedido).
 *  - O estado do pedido acompanha a cozinha: algo em preparação → EM_PREPARO; tudo pronto → PRONTO (só a partir de
 *    ABERTO/EM_PREPARO; FECHADO/CANCELADO nunca mudam aqui). Quando um posto fica pronto avisa a sala (`pedido_pronto`).
 */
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { withTx, erro } = require('./shared');

const POSTOS = ['COZINHA', 'BAR', 'NENHUM'];
const PADRAO = { BEBIDA: 'BAR', COCKTAIL: 'BAR', SHISHA: 'BAR', CIGARROS: 'NENHUM', LOJA: 'NENHUM', LAZER: 'NENHUM', SERVICO_QUARTO: 'NENHUM', OUTRO: 'NENHUM' };
const SEGUINTE = { AGUARDANDO: 'PREPARANDO', PREPARANDO: 'PRONTO', PRONTO: 'ENTREGUE' };
const JANELA_H = 24;

async function postos(db, tenantId) {
  const r = await db.query(`SELECT valor FROM configuracoes WHERE tenant_id = $1 AND chave = 'postos_preparacao'`, [tenantId]);
  let cfg = {};
  try { cfg = r.rows[0] ? JSON.parse(r.rows[0].valor) : {}; } catch { cfg = {}; }
  return { ...PADRAO, ...cfg };
}
const postoDe = (mapa, categoria) => mapa[String(categoria || '').toUpperCase()] || 'COZINHA';

async function obterPostos({ tenantId }) {
  return { postos: await postos(pool, tenantId), padrao_restantes: 'COZINHA' };
}

async function definirPostos({ tenantId, mapa }) {
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) throw erro(400, 'Indique o posto de cada categoria');
  const limpo = {};
  for (const [cat, posto] of Object.entries(mapa)) {
    const c = String(cat).trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,30}$/.test(c)) throw erro(400, `Categoria inválida: ${cat}`);
    if (!POSTOS.includes(posto)) throw erro(400, `Posto inválido para ${c} (COZINHA, BAR ou NENHUM)`);
    limpo[c] = posto;
  }
  await pool.query(
    `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1, 'postos_preparacao', $2)
     ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW()`, [tenantId, JSON.stringify(limpo)]);
  return { postos: { ...PADRAO, ...limpo } };
}

/** Pedidos com itens por preparar/entregar no posto. */
async function listar({ tenantId, posto = 'COZINHA' }) {
  if (!['COZINHA', 'BAR'].includes(posto)) throw erro(400, 'Posto inválido (COZINHA ou BAR)');
  const mapa = await postos(pool, tenantId);
  const r = await pool.query(`
    SELECT p.id, p.origem, p.status, p.criado_em, p.observacoes, m.numero AS mesa, q.numero AS quarto, c.nome AS cliente, f.nome AS funcionario,
           ip.id AS item_id, ip.quantidade, ip.status_cozinha, ip.observacoes AS item_obs, pr.nome AS produto, pr.categoria
      FROM pedidos p
      JOIN itens_pedido ip ON ip.pedido_id = p.id JOIN produtos pr ON pr.id = ip.produto_id
      LEFT JOIN mesas m ON m.id = p.mesa_id LEFT JOIN quartos q ON q.id = p.quarto_id
      LEFT JOIN clientes c ON c.id = p.cliente_id LEFT JOIN funcionarios f ON f.id = p.funcionario_id
     WHERE p.tenant_id = $1 AND p.status <> 'CANCELADO' AND p.origem NOT IN ('LAZER','LOJA')
       AND NOT (p.origem = 'REMOTA' AND p.validado_em IS NULL)
       AND ip.status_cozinha <> 'ENTREGUE' AND p.criado_em > NOW() - INTERVAL '${JANELA_H} hours'
     ORDER BY p.criado_em, pr.nome`, [tenantId]);
  const porPedido = new Map();
  for (const x of r.rows) {
    if (postoDe(mapa, x.categoria) !== posto) continue;
    const p = porPedido.get(x.id) || { id: x.id, origem: x.origem, status: x.status, criado_em: x.criado_em, observacoes: x.observacoes, mesa: x.mesa, quarto: x.quarto, cliente: x.cliente, funcionario: x.funcionario, itens: [] };
    p.itens.push({ id: x.item_id, produto: x.produto, quantidade: Number(x.quantidade), status: x.status_cozinha, observacoes: x.item_obs });
    porPedido.set(x.id, p);
  }
  return [...porPedido.values()].map(p => ({
    ...p,
    minutos: Math.floor((Date.now() - new Date(p.criado_em).getTime()) / 60000),
    estado: p.itens.every(i => i.status === 'PRONTO') ? 'PRONTO' : p.itens.some(i => i.status !== 'AGUARDANDO') ? 'PREPARANDO' : 'AGUARDANDO',
  }));
}

/** Acerta o estado do pedido depois de mexer nos itens e avisa a sala quando um posto fica pronto. */
async function sincronizarPedido(db, tenantId, pedidoId, mapa, postoMexido) {
  const it = await db.query(`SELECT ip.status_cozinha, pr.categoria FROM itens_pedido ip JOIN produtos pr ON pr.id = ip.produto_id WHERE ip.pedido_id = $1`, [pedidoId]);
  const preparar = it.rows.filter(x => postoDe(mapa, x.categoria) !== 'NENHUM');
  const pronto = s => s === 'PRONTO' || s === 'ENTREGUE';
  let novo = null;
  if (preparar.length && preparar.every(x => pronto(x.status_cozinha))) novo = 'PRONTO';
  else if (preparar.some(x => x.status_cozinha !== 'AGUARDANDO')) novo = 'EM_PREPARO';
  let pedido = null;
  if (novo) {
    const u = await db.query(
      `UPDATE pedidos SET status = $2, atualizado_em = NOW() WHERE id = $1 AND status IN ('ABERTO','EM_PREPARO') AND status <> $2 RETURNING id, status`, [pedidoId, novo]);
    pedido = u.rows[0] || null;
  }
  const doPosto = it.rows.filter(x => postoDe(mapa, x.categoria) === postoMexido);
  const postoPronto = doPosto.length && doPosto.every(x => pronto(x.status_cozinha)) && doPosto.some(x => x.status_cozinha === 'PRONTO');
  return { pedido, postoPronto };
}

async function avisar(tenantId, pedidoId, posto, res) {
  if (res.pedido) broadcast('pedido_atualizado', { id: pedidoId, status: res.pedido.status }, tenantId);
  if (res.postoPronto) {
    const p = await pool.query(`SELECT m.numero AS mesa, q.numero AS quarto, p.origem FROM pedidos p LEFT JOIN mesas m ON m.id = p.mesa_id LEFT JOIN quartos q ON q.id = p.quarto_id WHERE p.id = $1`, [pedidoId]);
    broadcast('pedido_pronto', { id: pedidoId, posto, ...(p.rows[0] || {}) }, tenantId);
  }
  broadcast('cozinha_atualizada', { id: pedidoId, posto }, tenantId);
}

/** Avança um item para o estado seguinte (ou para o estado indicado). */
async function avancarItem({ tenantId, pedidoId, itemId, status }) {
  if (status !== undefined && !SEGUINTE[status] && status !== 'ENTREGUE') throw erro(400, 'Estado inválido');
  let posto = 'COZINHA';
  const res = await withTx(async db => {
    const mapa = await postos(db, tenantId);
    const r = await db.query(`
      SELECT ip.id, ip.status_cozinha, pr.categoria, p.status AS pedido_status FROM itens_pedido ip
        JOIN pedidos p ON p.id = ip.pedido_id JOIN produtos pr ON pr.id = ip.produto_id
       WHERE ip.id = $1 AND ip.pedido_id = $2 AND p.tenant_id = $3 FOR UPDATE OF ip`, [itemId, pedidoId, tenantId]);
    const x = r.rows[0];
    if (!x) throw erro(404, 'Item não encontrado');
    if (x.pedido_status === 'CANCELADO') throw erro(409, 'Pedido cancelado');
    posto = postoDe(mapa, x.categoria);
    const alvo = status || SEGUINTE[x.status_cozinha];
    if (!alvo) throw erro(409, 'Este item já foi entregue');
    await db.query(`UPDATE itens_pedido SET status_cozinha = $2 WHERE id = $1`, [itemId, alvo]);
    return { ...(await sincronizarPedido(db, tenantId, pedidoId, mapa, posto)), item: { id: itemId, status: alvo } };
  });
  await avisar(tenantId, pedidoId, posto, res);
  return { item: res.item, pedido: res.pedido };
}

/** Avança TODOS os itens do posto no pedido para o estado seguinte ao do menos adiantado. */
async function avancarPedido({ tenantId, pedidoId, posto }) {
  if (!['COZINHA', 'BAR'].includes(posto)) throw erro(400, 'Posto inválido (COZINHA ou BAR)');
  const res = await withTx(async db => {
    const mapa = await postos(db, tenantId);
    const p = await db.query(`SELECT status FROM pedidos WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [pedidoId, tenantId]);
    if (!p.rows[0]) throw erro(404, 'Pedido não encontrado');
    if (p.rows[0].status === 'CANCELADO') throw erro(409, 'Pedido cancelado');
    const it = await db.query(`SELECT ip.id, ip.status_cozinha, pr.categoria FROM itens_pedido ip JOIN produtos pr ON pr.id = ip.produto_id WHERE ip.pedido_id = $1`, [pedidoId]);
    const meus = it.rows.filter(x => postoDe(mapa, x.categoria) === posto && x.status_cozinha !== 'ENTREGUE');
    if (!meus.length) throw erro(409, 'Nada por preparar neste posto');
    const ordem = ['AGUARDANDO', 'PREPARANDO', 'PRONTO'];
    const atraso = meus.map(x => ordem.indexOf(x.status_cozinha)).reduce((a, b) => Math.min(a, b));
    const alvo = SEGUINTE[ordem[atraso]];
    const ids = meus.filter(x => ordem.indexOf(x.status_cozinha) <= atraso).map(x => x.id);
    await db.query(`UPDATE itens_pedido SET status_cozinha = $2 WHERE id = ANY($1::uuid[])`, [ids, alvo]);
    return { ...(await sincronizarPedido(db, tenantId, pedidoId, mapa, posto)), alvo, itens: ids.length };
  });
  await avisar(tenantId, pedidoId, posto, res);
  return { estado: res.alvo, itens: res.itens, pedido: res.pedido };
}

module.exports = { postos, postoDe, listar, avancarItem, avancarPedido, obterPostos, definirPostos, POSTOS, PADRAO, _interno: { postoDe } };
