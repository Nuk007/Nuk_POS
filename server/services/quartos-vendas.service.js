'use strict';
/**
 * QuartosVendasService — vendas, reservas e arrumação dos quartos, feitas directamente pelos botões dos quartos.
 *
 * Regras (do dono do produto):
 *  - só vende/reserva/abre quem tem o perfil «Vender quartos» (funcionarios.pode_vender_quartos);
 *  - o quarto fica livre 30 min depois da hora limite (tempo de arrumação);
 *  - ★ amarela = há reserva futura; ★ vermelha = a reserva começa em menos de 1 h → vendas bloqueadas,
 *    só se aceitam novas reservas de períodos compatíveis;
 *  - ao abrir o quarto (cliente sai antes da hora) ou 5 min antes do fim, avisam-se os funcionários com o perfil
 *    «Arrumar quartos», que têm 30 min para o dar como limpo; passado o prazo avisa-se a chefia (ADMIN/GERENTE)
 *    e só ela o pode abrir; o atraso fica registado e pode ir ao dashboard.
 */
const { pool } = require('../db');
const { erro, withTx } = require('./shared');
const { temPerfil } = require('./funcionarios.service');
const { broadcast } = require('../middleware/broadcast');

const MIN = 60e3;
const DURACAO_H = { DUAS_HORAS: 2, PERNOITE: 12, DIARIA: 24 }; // Hora / Noite / Diária
const PRECO = { DUAS_HORAS: 'preco_2h', PERNOITE: 'preco_pernoite', DIARIA: 'preco_diaria' };
const LIMPEZA_MIN = 30;   // folga de arrumação depois da hora limite (e prazo para dar o quarto como limpo)
const AVISO_MIN = 5;      // aviso aos arrumadores antes do fim da ocupação
const ESTRELA_MIN = 60;   // reserva a começar em menos disto → estrela vermelha
const CHEFIA = ['ADMIN', 'GERENTE'];

const hora = d => new Date(new Date(d).getTime() + 3600e3).toISOString().slice(11, 16); // HH:MM em Luanda (UTC+1)
const mais = (d, min) => new Date(new Date(d).getTime() + min * MIN);

async function exigirVendedor(tenantId, userId) {
  if (!(await temPerfil(tenantId, userId, 'pode_vender_quartos'))) {
    throw erro(403, 'Só os funcionários com o perfil «Vender quartos» podem fazer esta operação. O Administrador activa-o na ficha do funcionário.');
  }
}

/** Bloqueia o quarto da linha (FOR UPDATE NOWAIT) — duas vendas em simultâneo não passam as duas. */
async function bloquearQuarto(c, tenantId, quartoId) {
  try {
    const r = await c.query(`SELECT id, numero, status, preco_2h, preco_pernoite, preco_diaria FROM quartos WHERE id = $1 AND tenant_id = $2 FOR UPDATE NOWAIT`, [quartoId, tenantId]);
    if (!r.rows[0]) throw erro(404, 'Quarto não encontrado');
    return r.rows[0];
  } catch (e) {
    if (e.code === '55P03') throw erro(409, 'O quarto está a ser tratado por outro funcionário. Tente novamente.');
    throw e;
  }
}

function validarFracao(fracao) {
  if (!DURACAO_H[fracao]) throw erro(400, 'Escolha o serviço: Hora, Noite ou Diária');
}

/** Período [inicio, fim) mais a folga de arrumação nas duas pontas não pode tocar noutra reserva activa. */
async function exigirPeriodoLivre(c, quartoId, inicio, fim, ignorarId) {
  const r = await c.query(
    `SELECT id, checkin, checkout FROM reservas
     WHERE quarto_id = $1 AND status IN ('CONFIRMADA','CHECKIN') AND ($4::uuid IS NULL OR id <> $4)
       AND NOT (checkout + make_interval(mins => $5::int) <= $2::timestamptz OR checkin >= $3::timestamptz + make_interval(mins => $5::int))
     ORDER BY checkin LIMIT 1`, [quartoId, inicio, fim, ignorarId || null, LIMPEZA_MIN]);
  if (r.rows[0]) throw erro(409, `O quarto já está ocupado ou reservado entre as ${hora(r.rows[0].checkin)} e as ${hora(r.rows[0].checkout)} (mais ${LIMPEZA_MIN} min de arrumação).`);
}

function estadoOcupacao(q) {
  return { OCUPADO: 'O quarto está ocupado', LIMPEZA: 'O quarto está a ser arrumado', MANUTENCAO: 'O quarto está em manutenção', BLOQUEADO: 'O quarto está bloqueado' }[q.status];
}

// ── listagem (com tudo o que o botão do quarto mostra) ───────────
async function listar({ tenantId, agora = new Date() }) {
  const [qs, rs, ls] = await Promise.all([
    pool.query(`SELECT * FROM quartos WHERE tenant_id = $1 ORDER BY tipo, numero`, [tenantId]),
    pool.query(
      `SELECT id, quarto_id, status, fracao, checkin, checkout, nome_hospede, valor_total FROM reservas
       WHERE tenant_id = $1 AND (status = 'CHECKIN' OR (status = 'CONFIRMADA' AND checkout > $2)) ORDER BY checkin`, [tenantId, agora]),
    pool.query(`SELECT id, quarto_id, origem, aviso_em, prazo_em, escalado_em FROM quarto_limpezas WHERE tenant_id = $1 AND limpo_em IS NULL`, [tenantId]),
  ]);
  return qs.rows.map(q => {
    const doQuarto = rs.rows.filter(r => r.quarto_id === q.id);
    const ocupacao = doQuarto.find(r => r.status === 'CHECKIN') || null;
    const futuras = doQuarto.filter(r => r.status === 'CONFIRMADA');
    const proxima = futuras[0] || null;
    const estrela = !proxima ? null : (new Date(proxima.checkin) - agora < ESTRELA_MIN * MIN ? 'VERMELHA' : 'AMARELA');
    const l = ls.rows.find(x => x.quarto_id === q.id);
    const limpeza = l ? { id: l.id, origem: l.origem, prazo_em: l.prazo_em, escalado: !!l.escalado_em || new Date(l.prazo_em) <= agora } : null;
    let livre_as = null;
    if (q.status === 'OCUPADO' && ocupacao) livre_as = mais(ocupacao.checkout, LIMPEZA_MIN);
    else if (q.status === 'LIMPEZA' && l) livre_as = new Date(l.prazo_em);
    return { ...q, ocupacao, reservas_futuras: futuras, proxima_reserva: proxima, estrela, limpeza, livre_as,
      venda_bloqueada: estrela === 'VERMELHA' ? `Reserva às ${hora(proxima.checkin)}: vendas bloqueadas, só reservas de períodos compatíveis` : null };
  });
}

// ── vender (entrada imediata) ────────────────────────────────────
async function vender({ tenantId, userId, quartoId, fracao, nome_hospede, cliente_id, observacoes }) {
  await exigirVendedor(tenantId, userId);
  validarFracao(fracao);
  const res = await withTx(async c => {
    const q = await bloquearQuarto(c, tenantId, quartoId);
    if (q.status !== 'DISPONIVEL') throw erro(409, estadoOcupacao(q));
    const agora = new Date(), fim = mais(agora, DURACAO_H[fracao] * 60);
    const prox = await c.query(`SELECT MIN(checkin) AS checkin FROM reservas WHERE quarto_id = $1 AND status = 'CONFIRMADA' AND checkout > $2`, [quartoId, agora]);
    if (prox.rows[0].checkin && new Date(prox.rows[0].checkin) - agora < ESTRELA_MIN * MIN) {
      throw erro(409, `Há uma reserva às ${hora(prox.rows[0].checkin)} (menos de 1 hora): vendas bloqueadas. Só é possível reservar períodos compatíveis.`, { codigo: 'ESTRELA_VERMELHA' });
    }
    await exigirPeriodoLivre(c, quartoId, agora, fim);
    const r = await c.query(
      `INSERT INTO reservas (tenant_id, quarto_id, cliente_id, nome_hospede, fracao, checkin, checkout, status, valor_total, observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'CHECKIN',$8,$9,$10) RETURNING *`,
      [tenantId, quartoId, cliente_id || null, nome_hospede || null, fracao, agora, fim, q[PRECO[fracao]], observacoes || null, userId]);
    await c.query(`UPDATE quartos SET status = 'OCUPADO', atualizado_em = NOW() WHERE id = $1`, [quartoId]);
    return r.rows[0];
  });
  broadcast('quarto_atualizado', { quarto_id: quartoId, status: 'OCUPADO' }, tenantId);
  return res;
}

// ── reservar (período futuro) ────────────────────────────────────
async function reservar({ tenantId, userId, quartoId, fracao, inicio, nome_hospede, cliente_id, observacoes }) {
  await exigirVendedor(tenantId, userId);
  validarFracao(fracao);
  const ini = new Date(inicio);
  if (!inicio || isNaN(ini)) throw erro(400, 'Indique a data e hora de início da reserva');
  const agora = new Date();
  if (ini < mais(agora, -2)) throw erro(400, 'A hora de início já passou');
  if (ini > mais(agora, 365 * 24 * 60)) throw erro(400, 'A reserva só pode ser feita até um ano de antecedência');
  const fim = mais(ini, DURACAO_H[fracao] * 60);
  const res = await withTx(async c => {
    const q = await bloquearQuarto(c, tenantId, quartoId);
    if (['MANUTENCAO', 'BLOQUEADO'].includes(q.status)) throw erro(409, estadoOcupacao(q));
    await exigirPeriodoLivre(c, quartoId, ini, fim);
    const r = await c.query(
      `INSERT INTO reservas (tenant_id, quarto_id, cliente_id, nome_hospede, fracao, checkin, checkout, status, valor_total, observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'CONFIRMADA',$8,$9,$10) RETURNING *`,
      [tenantId, quartoId, cliente_id || null, nome_hospede || null, fracao, ini, fim, q[PRECO[fracao]], observacoes || null, userId]);
    return r.rows[0];
  });
  broadcast('quarto_atualizado', { quarto_id: quartoId, reservado: true }, tenantId);
  return res;
}

// ── dar entrada a uma reserva ────────────────────────────────────
async function darEntrada({ tenantId, userId, reservaId }) {
  await exigirVendedor(tenantId, userId);
  const res = await withTx(async c => {
    const rv = (await c.query(`SELECT * FROM reservas WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [reservaId, tenantId])).rows[0];
    if (!rv) throw erro(404, 'Reserva não encontrada');
    if (rv.status !== 'CONFIRMADA') throw erro(409, 'Esta reserva já não está por iniciar');
    const q = await bloquearQuarto(c, tenantId, rv.quarto_id);
    const agora = new Date();
    if (new Date(rv.checkin) - agora > ESTRELA_MIN * MIN) throw erro(409, `Só se pode dar entrada na última hora antes do início (${hora(rv.checkin)}).`);
    if (new Date(rv.checkout) <= agora) throw erro(409, 'O período desta reserva já terminou. Cancele-a.');
    if (q.status !== 'DISPONIVEL') throw erro(409, estadoOcupacao(q));
    const fim = mais(agora, (new Date(rv.checkout) - new Date(rv.checkin)) / MIN); // mantém a duração contratada
    await exigirPeriodoLivre(c, rv.quarto_id, agora, fim, rv.id);
    const r = await c.query(`UPDATE reservas SET status = 'CHECKIN', checkin = $2, checkout = $3, aviso_fim_em = NULL, atualizado_em = NOW() WHERE id = $1 RETURNING *`, [rv.id, agora, fim]);
    await c.query(`UPDATE quartos SET status = 'OCUPADO', atualizado_em = NOW() WHERE id = $1`, [rv.quarto_id]);
    return r.rows[0];
  });
  broadcast('quarto_atualizado', { quarto_id: res.quarto_id, status: 'OCUPADO' }, tenantId);
  return res;
}

async function cancelarReserva({ tenantId, userId, reservaId }) {
  await exigirVendedor(tenantId, userId);
  const r = await pool.query(`UPDATE reservas SET status = 'CANCELADA', atualizado_em = NOW() WHERE id = $1 AND tenant_id = $2 AND status = 'CONFIRMADA' RETURNING *`, [reservaId, tenantId]);
  if (!r.rows[0]) {
    const ex = await pool.query(`SELECT status FROM reservas WHERE id = $1 AND tenant_id = $2`, [reservaId, tenantId]);
    throw ex.rows[0] ? erro(409, 'Só se cancelam reservas por iniciar. Para libertar um quarto ocupado use «Abrir quarto».') : erro(404, 'Reserva não encontrada');
  }
  broadcast('quarto_atualizado', { quarto_id: r.rows[0].quarto_id, reservado: false }, tenantId);
  return r.rows[0];
}

// ── arrumação ────────────────────────────────────────────────────
/** Abre (ou renova) a tarefa de arrumação do quarto e avisa os arrumadores. */
async function abrirArrumacao(c, { tenantId, quartoId, numero, reservaId, origem, prazo, agora }) {
  const r = await c.query(
    `INSERT INTO quarto_limpezas (tenant_id, quarto_id, reserva_id, origem, aviso_em, prazo_em)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (quarto_id) WHERE limpo_em IS NULL
     DO UPDATE SET origem = EXCLUDED.origem, aviso_em = EXCLUDED.aviso_em, prazo_em = EXCLUDED.prazo_em, escalado_em = NULL, reserva_id = EXCLUDED.reserva_id
     RETURNING id`, [tenantId, quartoId, reservaId || null, origem, agora, prazo]);
  return { tenantId, evento: { quarto_id: quartoId, numero, motivo: origem, prazo_em: prazo, tarefa_id: r.rows[0].id } };
}
const avisarArrumar = a => broadcast('quarto_arrumar', a.evento, a.tenantId);

/** «Abrir quarto»: o cliente sai antes da hora. Liberta a ocupação e manda arrumar. */
async function abrirQuarto({ tenantId, userId, quartoId }) {
  await exigirVendedor(tenantId, userId);
  const aviso = await withTx(async c => {
    const q = await bloquearQuarto(c, tenantId, quartoId);
    const rv = (await c.query(`SELECT id FROM reservas WHERE quarto_id = $1 AND status = 'CHECKIN' ORDER BY checkin DESC LIMIT 1 FOR UPDATE`, [quartoId])).rows[0];
    if (q.status !== 'OCUPADO') throw erro(409, 'Só se abre um quarto que está ocupado.');
    const agora = new Date();
    // quarto marcado OCUPADO sem ocupação registada (dados antigos): também se pode abrir
    if (rv) await c.query(`UPDATE reservas SET status = 'CHECKOUT', saida_em = $2, atualizado_em = NOW() WHERE id = $1`, [rv.id, agora]);
    await c.query(`UPDATE quartos SET status = 'LIMPEZA', atualizado_em = NOW() WHERE id = $1`, [quartoId]);
    return abrirArrumacao(c, { tenantId, quartoId, numero: q.numero, reservaId: rv ? rv.id : null, origem: 'ABERTO', prazo: mais(agora, LIMPEZA_MIN), agora });
  });
  broadcast('quarto_atualizado', { quarto_id: quartoId, status: 'LIMPEZA' }, tenantId);
  avisarArrumar(aviso);
  return { ok: true, prazo_em: aviso.evento.prazo_em };
}

/** Dá o quarto como limpo e disponível. Dentro do prazo: arrumadores. Depois do prazo: só a chefia. */
async function marcarLimpo({ tenantId, userId, quartoId, concluirManual = false }) {
  const f = (await pool.query(`SELECT nivel_acesso, arruma_quartos FROM funcionarios WHERE id = $1 AND tenant_id = $2 AND ativo = true`, [userId, tenantId])).rows[0];
  if (!f) throw erro(403, 'Utilizador sem acesso');
  const chefia = CHEFIA.includes(f.nivel_acesso);
  const res = await withTx(async c => {
    const q = await bloquearQuarto(c, tenantId, quartoId);
    if (q.status !== 'LIMPEZA') throw erro(409, q.status === 'OCUPADO' ? 'O quarto ainda está ocupado.' : 'O quarto não está em arrumação.');
    const t = (await c.query(`SELECT id, prazo_em, escalado_em FROM quarto_limpezas WHERE quarto_id = $1 AND limpo_em IS NULL FOR UPDATE`, [quartoId])).rows[0];
    const agora = new Date();
    if (t) {
      const escalada = !!t.escalado_em || new Date(t.prazo_em) <= agora;
      if (escalada && !chefia) throw erro(403, 'O prazo de arrumação terminou: só um gerente ou supervisor pode abrir este quarto.');
      if (!escalada && !f.arruma_quartos) throw erro(403, 'Só os funcionários com o perfil «Arrumar quartos» podem dar o quarto como limpo (a chefia só depois do prazo).');
    } else if (!f.arruma_quartos && !chefia) {
      throw erro(403, 'Sem permissão para dar o quarto como limpo.');
    }
    const atraso = t ? Math.max(0, Math.ceil((agora - new Date(t.prazo_em)) / MIN)) : 0;
    if (t) await c.query(`UPDATE quarto_limpezas SET limpo_em = $2, limpo_por = $3, atraso_min = $4 WHERE id = $1`, [t.id, agora, userId, atraso]);
    await c.query(`UPDATE quartos SET status = 'DISPONIVEL', atualizado_em = NOW() WHERE id = $1`, [quartoId]);
    return { ok: true, atraso_min: atraso };
  });
  broadcast('quarto_atualizado', { quarto_id: quartoId, status: 'DISPONIVEL' }, tenantId);
  return res;
}

/** Estado manual pela chefia (manutenção, bloqueio, …). LIMPEZA→DISPONIVEL segue as regras da arrumação. */
async function mudarEstado({ tenantId, userId, quartoId, status }) {
  const cur = (await pool.query(`SELECT status FROM quartos WHERE id = $1 AND tenant_id = $2`, [quartoId, tenantId])).rows[0];
  if (!cur) throw erro(404, 'Quarto não encontrado');
  if (cur.status === 'LIMPEZA' && status === 'DISPONIVEL') {
    await marcarLimpo({ tenantId, userId, quartoId });
    return (await pool.query(`SELECT * FROM quartos WHERE id = $1`, [quartoId])).rows[0];
  }
  const out = await withTx(async c => {
    const q = await bloquearQuarto(c, tenantId, quartoId);
    const r = await c.query(`UPDATE quartos SET status = $2, atualizado_em = NOW() WHERE id = $1 RETURNING *`, [quartoId, status]);
    if (status === 'LIMPEZA' && cur.status !== 'LIMPEZA') {
      const agora = new Date();
      return { quarto: r.rows[0], aviso: await abrirArrumacao(c, { tenantId, quartoId, numero: q.numero, origem: 'ABERTO', prazo: mais(agora, LIMPEZA_MIN), agora }) };
    }
    if (status !== 'LIMPEZA' && status !== cur.status) await c.query(`UPDATE quarto_limpezas SET limpo_em = NOW(), limpo_por = NULL WHERE quarto_id = $1 AND limpo_em IS NULL`, [quartoId]);
    return { quarto: r.rows[0] };
  });
  broadcast('quarto_atualizado', { quarto_id: quartoId, status }, tenantId);
  if (out.aviso) avisarArrumar(out.aviso);
  return out.quarto;
}

// ── agendador (chamado de 30 em 30 s por jobs/quartos-scheduler.js) ──
async function processarTick(agora = new Date()) {
  const avisos = [];
  // 1) faltam ≤5 min para o fim → manda arrumar (prazo = hora limite + 30 min)
  const fim5 = await pool.query(
    `UPDATE reservas r SET aviso_fim_em = $1
     FROM quartos q
     WHERE q.id = r.quarto_id AND r.status = 'CHECKIN' AND r.aviso_fim_em IS NULL AND r.checkout <= $2
     RETURNING r.id, r.tenant_id, r.quarto_id, r.checkout, q.numero`, [agora, mais(agora, AVISO_MIN)]);
  for (const r of fim5.rows) {
    const a = await withTx(c => abrirArrumacao(c, { tenantId: r.tenant_id, quartoId: r.quarto_id, numero: r.numero, reservaId: r.id, origem: 'FIM_TEMPO', prazo: mais(r.checkout, LIMPEZA_MIN), agora }));
    avisos.push(a);
  }
  // 2) acabou o tempo → fecha a ocupação e passa o quarto a «a arrumar»
  const fechadas = await pool.query(`UPDATE reservas SET status = 'CHECKOUT', atualizado_em = NOW() WHERE status = 'CHECKIN' AND checkout <= $1 RETURNING tenant_id, quarto_id`, [agora]);
  for (const r of fechadas.rows) {
    const u = await pool.query(
      `UPDATE quartos SET status = 'LIMPEZA', atualizado_em = NOW()
       WHERE id = $1 AND status = 'OCUPADO' AND NOT EXISTS (SELECT 1 FROM reservas WHERE quarto_id = $1 AND status = 'CHECKIN')`, [r.quarto_id]);
    if (u.rowCount) broadcast('quarto_atualizado', { quarto_id: r.quarto_id, status: 'LIMPEZA' }, r.tenant_id);
  }
  // 3) prazo de 30 min esgotado → avisa a chefia; só ela abre o quarto
  const esc = await pool.query(
    `UPDATE quarto_limpezas l SET escalado_em = $1 FROM quartos q
     WHERE q.id = l.quarto_id AND l.limpo_em IS NULL AND l.escalado_em IS NULL AND l.prazo_em <= $1
     RETURNING l.tenant_id, l.quarto_id, l.prazo_em, q.numero`, [agora]);
  for (const e of esc.rows) broadcast('quarto_escalado', { quarto_id: e.quarto_id, numero: e.numero, prazo_em: e.prazo_em }, e.tenant_id);
  avisos.forEach(avisarArrumar);
  return { avisos: avisos.length, fechadas: fechadas.rowCount, escaladas: esc.rowCount };
}

module.exports = { listar, vender, reservar, darEntrada, cancelarReserva, abrirQuarto, marcarLimpo, mudarEstado, processarTick,
  DURACAO_H, LIMPEZA_MIN, AVISO_MIN, ESTRELA_MIN };
