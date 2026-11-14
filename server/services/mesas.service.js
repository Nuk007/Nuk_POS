'use strict';
/**
 * MesasService — número de mesas de cada estabelecimento (configuração, só ADMIN).
 * Mesas novas chamam-se M01, M02… (as que já existem mantêm o nome). Ao diminuir, retiram-se as de número mais alto,
 * mas só se estiverem livres e sem histórico de pedidos: nada se apaga a meio, ou muda tudo ou não muda nada.
 */
const { pool } = require('../db');
const { withTx, erro } = require('./shared');

const MAX_MESAS = 200;
const nome = (n) => 'M' + String(n).padStart(2, '0');
const numeroDe = (numero) => parseInt(String(numero).replace(/\D+/g, ''), 10) || 0;

async function definirQuantidade({ tenantId, quantidade, zona, capacidade }) {
  const alvo = Number(quantidade);
  if (!Number.isInteger(alvo) || alvo < 0 || alvo > MAX_MESAS) throw erro(400, `Indique um número de mesas entre 0 e ${MAX_MESAS}`);
  const cap = capacidade === undefined ? 4 : Number(capacidade);
  if (!Number.isInteger(cap) || cap < 1 || cap > 50) throw erro(400, 'Lugares por mesa inválidos (1-50)');
  const zonaNova = String(zona || 'Salão').trim().slice(0, 50) || 'Salão';

  return withTx(async db => {
    const r = await db.query(
      `SELECT m.id, m.numero, m.status, EXISTS (SELECT 1 FROM pedidos p WHERE p.mesa_id = m.id) AS com_historico
       FROM mesas m WHERE m.tenant_id = $1 FOR UPDATE`, [tenantId]);
    const mesas = r.rows.sort((a, b) => numeroDe(a.numero) - numeroDe(b.numero) || a.numero.localeCompare(b.numero));
    const actual = mesas.length;

    if (alvo > actual) {
      const usados = new Set(mesas.map(m => m.numero.toUpperCase()));
      let criadas = 0, n = 1;
      while (criadas < alvo - actual) {
        const nm = nome(n++);
        if (usados.has(nm)) continue;
        await db.query(`INSERT INTO mesas (tenant_id, numero, capacidade, zona) VALUES ($1,$2,$3,$4)`, [tenantId, nm, cap, zonaNova]);
        criadas++;
      }
      return { quantidade: alvo, criadas, removidas: 0 };
    }

    if (alvo < actual) {
      const aRemover = mesas.slice(alvo); // as de número mais alto
      const presas = aRemover.filter(m => m.status !== 'LIVRE' || m.com_historico);
      if (presas.length) {
        throw erro(409, `Não é possível reduzir: ${presas.map(m => m.numero).join(', ')} ${presas.length > 1 ? 'estão' : 'está'} em uso ou ${presas.length > 1 ? 'têm' : 'tem'} pedidos registados.`, { mesas: presas.map(m => m.numero) });
      }
      await db.query(`DELETE FROM mesas WHERE id = ANY($1::uuid[])`, [aRemover.map(m => m.id)]);
      return { quantidade: alvo, criadas: 0, removidas: aRemover.length };
    }
    return { quantidade: alvo, criadas: 0, removidas: 0 };
  });
}

async function contar({ tenantId }) {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM mesas WHERE tenant_id = $1`, [tenantId]);
  return { quantidade: r.rows[0].n };
}

const ESTADOS = ['LIVRE', 'OCUPADA', 'RESERVADA', 'LIMPEZA', 'MANUTENCAO'];

async function listar({ tenantId }) {
  const r = await pool.query(
    `SELECT m.*, COUNT(p.id) FILTER (WHERE p.status IN ('ABERTO','EM_PREPARO','PRONTO')) AS pedidos_ativos
       FROM mesas m LEFT JOIN pedidos p ON p.mesa_id = m.id
      WHERE ($1::uuid IS NULL OR m.tenant_id = $1)
      GROUP BY m.id ORDER BY m.numero`, [tenantId || null]);
  return r.rows;
}

/** Regra do dono: mesa com conta por pagar fica em uso até o Caixa receber. */
async function mudarEstado({ tenantId, id, status }) {
  if (!ESTADOS.includes(status)) throw erro(400, `status inválido. Valores: ${ESTADOS.join(', ')}`);
  return withTx(async db => {
    const m = await db.query(`SELECT id FROM mesas WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE`, [id, tenantId || null]);
    if (!m.rows[0]) throw erro(404, 'Mesa não encontrada');
    if (status === 'LIVRE' && await require('./ocupacao.service').mesaTemContaPorPagar(db, id)) {
      throw erro(409, 'A mesa tem uma conta por pagar: só fica livre depois de paga no Caixa.', { codigo: 'CONTA_POR_PAGAR' });
    }
    const r = await db.query(`UPDATE mesas SET status = $1, ultima_atividade = NOW() WHERE id = $2 RETURNING *`, [status, id]);
    return r.rows[0];
  });
}

module.exports = { definirQuantidade, contar, listar, mudarEstado, ESTADOS, MAX_MESAS };
