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

module.exports = { definirQuantidade, contar, MAX_MESAS };
