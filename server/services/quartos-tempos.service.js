'use strict';
/**
 * Tempos dos quartos por estabelecimento (pedido do dono, 21/11/2026: deixam de estar fixos no código).
 * Configuram-se em Configurações → «🛏️ Tempos dos quartos» (só ADMIN); sem configuração valem os de sempre.
 *
 *  hora_h      duração do serviço «Hora»            (2 h)
 *  noite_h     duração do serviço «Noite»           (12 h)
 *  diaria_h    duração do serviço «Diária»          (24 h)
 *  limpeza_min folga de arrumação depois da hora limite e prazo para dar o quarto como limpo (30 min)
 *  aviso_min   aviso aos arrumadores antes do fim da ocupação (5 min)
 *  estrela_min reserva a começar em menos disto → ★ vermelha, vendas bloqueadas; é também a antecedência
 *              com que se pode dar entrada a uma reserva (60 min)
 * Grava-se em `configuracoes`, chave `quartos_tempos` (JSON). O agendador lê o `aviso_min` directamente em SQL.
 */
const { pool } = require('../db');
const { erro } = require('./shared');

const CHAVE = 'quartos_tempos';
const PADRAO = Object.freeze({ hora_h: 2, noite_h: 12, diaria_h: 24, limpeza_min: 30, aviso_min: 5, estrela_min: 60 });
const LIMITES = {
  hora_h: [1, 12, 'A duração do serviço «Hora»', 'horas'],
  noite_h: [4, 24, 'A duração do serviço «Noite»', 'horas'],
  diaria_h: [12, 72, 'A duração do serviço «Diária»', 'horas'],
  limpeza_min: [5, 240, 'O tempo de arrumação', 'minutos'],
  aviso_min: [1, 60, 'O aviso antes do fim', 'minutos'],
  estrela_min: [15, 360, 'O tempo da estrela vermelha', 'minutos'],
};
const FRACAO_CAMPO = { DUAS_HORAS: 'hora_h', PERNOITE: 'noite_h', DIARIA: 'diaria_h' };

function normalizar(obj) {
  const t = { ...PADRAO };
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(PADRAO)) {
      const v = Number(obj[k]);
      const [min, max] = LIMITES[k];
      if (Number.isInteger(v) && v >= min && v <= max) t[k] = v;
    }
  }
  return t;
}

/** Tempos em vigor no estabelecimento (com os de sempre no que não estiver configurado). */
async function ler(db, tenantId) {
  if (!tenantId) return { ...PADRAO };
  const r = await (db || pool).query(`SELECT valor FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
  if (!r.rows[0]) return { ...PADRAO };
  try { return normalizar(JSON.parse(r.rows[0].valor)); } catch { return { ...PADRAO }; }
}

/** Duração de um serviço (DUAS_HORAS | PERNOITE | DIARIA) em minutos. */
const duracaoMin = (t, fracao) => t[FRACAO_CAMPO[fracao]] * 60;

/** Só ADMIN (a rota garante). Aceita só os campos enviados; `repor: true` volta aos de sempre. */
async function definir({ tenantId, repor, ...valores }) {
  if (repor === true) {
    await pool.query(`DELETE FROM configuracoes WHERE tenant_id = $1 AND chave = $2`, [tenantId, CHAVE]);
    return { ...PADRAO };
  }
  const actual = await ler(null, tenantId);
  let mudou = false;
  for (const k of Object.keys(PADRAO)) {
    if (valores[k] === undefined || valores[k] === null || valores[k] === '') continue;
    const v = Number(valores[k]);
    const [min, max, nome, unidade] = LIMITES[k];
    if (!Number.isInteger(v) || v < min || v > max) throw erro(400, `${nome} tem de ser um número inteiro de ${min} a ${max} ${unidade}`);
    actual[k] = v; mudou = true;
  }
  if (!mudou) throw erro(400, 'Indique pelo menos um tempo');
  if (!(actual.hora_h < actual.noite_h && actual.noite_h <= actual.diaria_h)) throw erro(400, 'A «Hora» tem de ser mais curta do que a «Noite», e a «Noite» não pode passar a «Diária»');
  if (actual.aviso_min >= actual.limpeza_min + actual.hora_h * 60) throw erro(400, 'O aviso antes do fim é demasiado grande');
  await pool.query(
    `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = $3, atualizado_em = NOW()`, [tenantId, CHAVE, JSON.stringify(actual)]);
  return actual;
}

module.exports = { ler, definir, duracaoMin, PADRAO, LIMITES, CHAVE };
