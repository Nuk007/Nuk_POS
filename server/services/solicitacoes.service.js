'use strict';
/**
 * Solicitações do portal do cliente (hospedagem, serviços e eventos) — lógica de negócio.
 *
 * O cliente pede no portal; a equipa vê a solicitação em tempo real no POS e confirma ou cancela.
 * Não há dinheiro envolvido (os preços mostrados no portal são só indicativos), por isso não se grava preço.
 */
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { buildWhere, erro, withTx } = require('./shared');

const TIPOS = ['HOSPEDAGEM', 'SERVICO', 'EVENTO'];
const ESTADOS = ['PENDENTE', 'CONFIRMADA', 'CANCELADA'];
const TEL_RE = /^9[0-9]{8}$/;

/** Criada pelo cliente no portal (rota pública). */
async function criar({ tenantId, tipo, nome_servico, nome, telefone, observacoes }) {
  if (!TIPOS.includes(tipo)) throw erro(400, `Tipo inválido. Valores aceites: ${TIPOS.join(', ')}`);
  const servico = String(nome_servico || '').trim();
  if (servico.length < 2 || servico.length > 120) throw erro(400, 'Indique o serviço pretendido (2 a 120 caracteres)');
  const contacto = String(nome || '').trim();
  if (contacto.length < 2 || contacto.length > 200) throw erro(400, 'Nome obrigatório (mínimo 2 caracteres)');
  const tel = String(telefone || '').replace(/\s/g, '');
  if (!TEL_RE.test(tel)) throw erro(400, 'Número de telefone inválido (formato 9XXXXXXXX)');
  const obs = observacoes ? String(observacoes).trim().slice(0, 500) : null;

  const id = uuidv4();
  const r = await pool.query(
    `INSERT INTO solicitacoes_portal (id, tenant_id, tipo, nome_servico, nome_contacto, telefone_contacto, observacoes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tipo, nome_servico, nome_contacto, telefone_contacto, status, criado_em`,
    [id, tenantId, tipo, servico, contacto, tel, obs]);
  broadcast('nova_solicitacao_portal', { id, tipo, nome_servico: servico, nome_contacto: contacto, telefone_contacto: tel }, tenantId);
  return { solicitacao: r.rows[0], mensagem: 'Pedido enviado! A nossa equipa entrará em contacto consigo em breve.' };
}

/** Caixa de entrada do estabelecimento (paginada, por estado e/ou tipo). */
async function listar({ tenantId, status, tipo, page = 1, limit = 50 }) {
  if (status && !ESTADOS.includes(status)) throw erro(400, 'Estado inválido');
  if (tipo && !TIPOS.includes(tipo)) throw erro(400, 'Tipo inválido');
  const pg = Math.max(1, parseInt(page) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const { where, vals } = buildWhere(['tenant_id = $1'], [tenantId], { status, tipo });
  const [dados, total] = await Promise.all([
    pool.query(`SELECT * FROM solicitacoes_portal ${where} ORDER BY criado_em DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`, [...vals, lim, (pg - 1) * lim]),
    pool.query(`SELECT COUNT(*) FROM solicitacoes_portal ${where}`, vals),
  ]);
  return { data: dados.rows, page: pg, limit: lim, total: parseInt(total.rows[0].count) };
}

async function contarPendentes({ tenantId }) {
  const r = await pool.query(`SELECT COUNT(*) FROM solicitacoes_portal WHERE tenant_id = $1 AND status = 'PENDENTE'`, [tenantId]);
  return { pendentes: parseInt(r.rows[0].count) };
}

async function actualizarStatus({ tenantId, id, status }) {
  if (!ESTADOS.includes(status)) throw erro(400, 'Estado inválido');
  const r = await pool.query(
    `UPDATE solicitacoes_portal SET status = $1, atualizado_em = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *`,
    [status, id, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Solicitação não encontrada');
  return r.rows[0];
}

// ── Reserva de quarto pelo portal, com o preço real do estabelecimento (14/11/2026) ──
// O cliente vê os tipos de quarto e os preços de Hora/Noite/Diária deste estabelecimento e pede um período;
// o servidor calcula o valor (o quarto livre mais barato desse tipo) e cria a solicitação. A reserva só existe
// quando um funcionário com o perfil «vender quartos» a confirma no POS, escolhendo o quarto.
const FRACOES = { DUAS_HORAS: 'Hora (2 h)', PERNOITE: 'Noite (12 h)', DIARIA: 'Diária (24 h)' };
const qv = () => require('./quartos-vendas.service');

async function exigirHospedagem(db, tenantId) {
  const r = await db.query(`SELECT modulos FROM tenants WHERE id = $1`, [tenantId]);
  const { licenciados } = require('./acessos');
  if (!r.rows[0] || !licenciados(r.rows[0].modulos).includes('hospedagem')) throw erro(404, 'Este estabelecimento não tem alojamento no portal');
}

/** Tipos de quarto com os preços mais baixos de cada serviço e quantos estão livres agora (público). */
async function tarifasHospedagem({ tenantId }) {
  await exigirHospedagem(pool, tenantId);
  const r = await pool.query(
    `SELECT tipo, COUNT(*)::int AS quartos,
            COUNT(*) FILTER (WHERE status = 'DISPONIVEL')::int AS livres_agora,
            MIN(NULLIF(preco_2h, 0)) AS preco_2h, MIN(NULLIF(preco_pernoite, 0)) AS preco_pernoite, MIN(NULLIF(preco_diaria, 0)) AS preco_diaria
       FROM quartos WHERE tenant_id = $1 AND status NOT IN ('MANUTENCAO','BLOQUEADO')
      GROUP BY tipo ORDER BY MIN(preco_pernoite), tipo`, [tenantId]);
  const n = v => (v == null ? null : Number(v));
  return { fracoes: FRACOES, tipos: r.rows.map(x => ({ tipo: x.tipo, quartos: x.quartos, livres_agora: x.livres_agora, precos: { DUAS_HORAS: n(x.preco_2h), PERNOITE: n(x.preco_pernoite), DIARIA: n(x.preco_diaria) } })) };
}

const dataHora = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Pedido de reserva do portal (público): valida, calcula o valor no servidor e avisa o POS. */
async function pedirReservaQuarto({ tenantId, tipo_quarto, fracao, inicio, nome, telefone, observacoes }) {
  await exigirHospedagem(pool, tenantId);
  const tipo = String(tipo_quarto || '').trim().slice(0, 40);
  if (!tipo) throw erro(400, 'Escolha o tipo de quarto');
  if (!FRACOES[fracao]) throw erro(400, 'Escolha o serviço: Hora, Noite ou Diária');
  const ini = qv().validarInicioReserva(inicio);
  const contacto = String(nome || '').trim();
  if (contacto.length < 2 || contacto.length > 200) throw erro(400, 'Nome obrigatório (mínimo 2 caracteres)');
  const tel = String(telefone || '').replace(/\s/g, '');
  if (!TEL_RE.test(tel)) throw erro(400, 'Número de telefone inválido (formato 9XXXXXXXX)');
  const livres = await qv().quartosLivres(pool, { tenantId, tipo, fracao, inicio: ini });
  if (!livres.length) throw erro(409, 'Não há quartos deste tipo livres nesse período. Escolha outra hora ou outro tipo.', { codigo: 'SEM_QUARTOS_LIVRES' });
  const valor = livres[0].preco;
  const servico = `Quarto ${tipo} · ${FRACOES[fracao]} · ${dataHora(ini)}`.slice(0, 120);
  const id = uuidv4();
  const r = await pool.query(
    `INSERT INTO solicitacoes_portal (id, tenant_id, tipo, nome_servico, nome_contacto, telefone_contacto, observacoes, tipo_quarto, fracao, inicio, valor_estimado)
     VALUES ($1,$2,'HOSPEDAGEM',$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, tipo, nome_servico, nome_contacto, telefone_contacto, status, tipo_quarto, fracao, inicio, valor_estimado, criado_em`,
    [id, tenantId, servico, contacto, tel, observacoes ? String(observacoes).trim().slice(0, 500) : null, tipo, fracao, ini, valor]);
  broadcast('nova_solicitacao_portal', { id, tipo: 'HOSPEDAGEM', nome_servico: servico, nome_contacto: contacto, telefone_contacto: tel }, tenantId);
  return { solicitacao: r.rows[0], valor, mensagem: `Pedido enviado: ${servico}, ${Number(valor).toLocaleString('pt-PT')} Kz. A equipa confirma a reserva consigo.` };
}

async function solicitacaoDeReserva(db, tenantId, id, bloquear) {
  const r = await db.query(`SELECT * FROM solicitacoes_portal WHERE id = $1 AND tenant_id = $2 ${bloquear ? 'FOR UPDATE' : ''}`, [id, tenantId]);
  const s = r.rows[0];
  if (!s) throw erro(404, 'Solicitação não encontrada');
  if (s.tipo !== 'HOSPEDAGEM' || !s.fracao || !s.inicio) throw erro(409, 'Esta solicitação não é um pedido de reserva com data (trate-a por telefone)');
  return s;
}

/** Quartos livres para confirmar um pedido de reserva (POS). */
async function quartosParaSolicitacao({ tenantId, id }) {
  const s = await solicitacaoDeReserva(pool, tenantId, id, false);
  return { solicitacao: s, quartos: await qv().quartosLivres(pool, { tenantId, tipo: s.tipo_quarto, fracao: s.fracao, inicio: s.inicio }) };
}

/**
 * Confirma o pedido criando a reserva no quarto escolhido — na mesma transacção, com a solicitação bloqueada
 * (dois cliques não criam duas reservas). Só quem tem o perfil «vender quartos». Devolve também a mensagem
 * de confirmação pronta para o WhatsApp do cliente.
 */
async function confirmarComReserva({ tenantId, userId, id, quarto_id }) {
  await qv().exigirVendedor(tenantId, userId);
  const res = await withTx(async c => {
    const s = await solicitacaoDeReserva(c, tenantId, id, true);
    if (s.status !== 'PENDENTE') throw erro(409, 'Este pedido já foi tratado');
    const q = await c.query(`SELECT tipo FROM quartos WHERE id = $1 AND tenant_id = $2`, [quarto_id, tenantId]);
    if (!q.rows[0]) throw erro(404, 'Quarto não encontrado');
    if (q.rows[0].tipo !== s.tipo_quarto) throw erro(409, `O cliente pediu um quarto ${s.tipo_quarto}`);
    const reserva = await qv().reservarEm(c, {
      tenantId, userId, quartoId: quarto_id, fracao: s.fracao, inicio: s.inicio,
      nome_hospede: s.nome_contacto, observacoes: `Pedido do portal · tel. ${s.telefone_contacto}`,
    });
    const u = await c.query(`UPDATE solicitacoes_portal SET status = 'CONFIRMADA', reserva_id = $2, atualizado_em = NOW() WHERE id = $1 RETURNING *`, [id, reserva.id]);
    return { solicitacao: u.rows[0], reserva };
  });
  const num = (await pool.query(`SELECT numero FROM quartos WHERE id = $1`, [quarto_id])).rows[0].numero;
  const nomeT = (await pool.query(`SELECT nome FROM tenants WHERE id = $1`, [tenantId])).rows[0].nome;
  const texto = `Olá ${res.solicitacao.nome_contacto.split(' ')[0]}, a sua reserva em ${nomeT} está confirmada: quarto ${num} (${res.solicitacao.tipo_quarto}), ${FRACOES[res.solicitacao.fracao]}, a partir de ${dataHora(res.reserva.checkin)}. Valor: ${Number(res.reserva.valor_total).toLocaleString('pt-PT')} Kz. Até breve!`;
  broadcast('quarto_atualizado', { quarto_id, reservado: true }, tenantId);
  return { ...res, quarto_numero: num, link_whatsapp: require('./whatsapp.service').linkWaMe(res.solicitacao.telefone_contacto, texto) };
}

module.exports = { criar, listar, contarPendentes, actualizarStatus, tarifasHospedagem, pedirReservaQuarto, quartosParaSolicitacao, confirmarComReserva, TIPOS, ESTADOS, FRACOES };
