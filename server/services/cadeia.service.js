'use strict';
/**
 * Cadeia de estabelecimentos (14/11/2026).
 * - Estabelecimentos da pessoa: as contas activas com o MESMO email noutros estabelecimentos activos.
 * - Mudar de estabelecimento: pede a palavra-passe da conta de destino (quem só conhece a sua não entra noutro).
 * - Consolidado: só para quem é ADMIN no estabelecimento actual e só dos estabelecimentos da MESMA cadeia
 *   (tenants.grupo_id, definido pelo superadmin) onde essa pessoa também é ADMIN.
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { erro } = require('./shared');
const auth = require('./auth.service');
const fin = require('./financeiro.service');
const { periodo } = require('./relatorios.service');

async function contaActual(userId) {
  const r = await pool.query(
    `SELECT f.id, f.email, f.nivel_acesso, f.tenant_id, t.grupo_id, g.nome AS grupo_nome
       FROM funcionarios f JOIN tenants t ON t.id = f.tenant_id LEFT JOIN grupos g ON g.id = t.grupo_id
      WHERE f.id = $1 AND f.ativo`, [userId]);
  if (!r.rows[0]) throw erro(404, 'Conta não encontrada');
  return r.rows[0];
}

/** Estabelecimentos onde este email tem conta activa (o actual marcado), com a cadeia de cada um. */
async function estabelecimentos({ userId }) {
  const eu = await contaActual(userId);
  const r = await pool.query(
    `SELECT t.id AS tenant_id, t.nome, t.slug, t.grupo_id, g.nome AS grupo_nome, f.nivel_acesso
       FROM funcionarios f JOIN tenants t ON t.id = f.tenant_id LEFT JOIN grupos g ON g.id = t.grupo_id
      WHERE LOWER(f.email) = LOWER($1) AND f.ativo AND t.estado = 'ACTIVA'
      ORDER BY t.nome`, [eu.email]);
  return {
    actual: eu.tenant_id,
    cadeia: eu.grupo_id ? { id: eu.grupo_id, nome: eu.grupo_nome } : null,
    estabelecimentos: r.rows.map(x => ({ ...x, actual: x.tenant_id === eu.tenant_id })),
  };
}

/** Troca de sessão para a conta do mesmo email noutro estabelecimento, confirmando a palavra-passe dessa conta. */
async function trocar({ userId, tenant_id, palavra_passe }) {
  if (!palavra_passe) throw erro(400, 'Confirme com a palavra-passe');
  const eu = await contaActual(userId);
  if (tenant_id === eu.tenant_id) throw erro(400, 'Já está neste estabelecimento');
  const r = await pool.query(`${auth.CONTA_SQL} WHERE LOWER(f.email) = LOWER($1) AND f.tenant_id = $2 AND f.ativo`, [eu.email, tenant_id]);
  const destino = r.rows[0];
  if (!destino) throw erro(404, 'Não tem conta activa nesse estabelecimento');
  if (destino.tenant_estado !== 'ACTIVA') throw erro(403, 'Esse estabelecimento está suspenso');
  // 403 e não 401: um 401 faria o frontend terminar a sessão actual
  if (!(await bcrypt.compare(String(palavra_passe), destino.password_hash))) throw erro(403, 'Palavra-passe errada para esse estabelecimento');
  return auth.sessaoDe(destino);
}

/** Números de cada estabelecimento da cadeia no período e o total (só ADMIN, só onde também é ADMIN). */
async function consolidado({ userId, de, ate }) {
  const p = periodo(de, ate);
  const eu = await contaActual(userId);
  if (eu.nivel_acesso !== 'ADMIN') throw erro(403, 'O consolidado da cadeia é só para administradores');
  if (!eu.grupo_id) throw erro(409, 'Este estabelecimento não pertence a uma cadeia (peça à GESTNUK AI para os agrupar)', { codigo: 'SEM_CADEIA' });
  const t = await pool.query(
    `SELECT t.id, t.nome FROM tenants t
      WHERE t.grupo_id = $1 AND t.estado = 'ACTIVA'
        AND EXISTS (SELECT 1 FROM funcionarios f WHERE f.tenant_id = t.id AND f.ativo AND f.nivel_acesso = 'ADMIN' AND LOWER(f.email) = LOWER($2))
      ORDER BY t.nome`, [eu.grupo_id, eu.email]);
  const linhas = [];
  for (const x of t.rows) {
    const r = await fin.resultado({ tenantId: x.id, de: p.de, ate: p.ate });
    const pedidos = r.receita.pedidos;
    linhas.push({
      tenant_id: x.id, nome: x.nome, actual: x.id === eu.tenant_id,
      receita: r.receita.total, alojamento: r.receita.alojamento, pedidos,
      ticket_medio: pedidos ? Math.round(r.receita.vendas / pedidos) : 0,
      custo_vendas: r.custo_vendas, despesas: r.total_despesas, resultado: r.resultado,
      por_receber: r.por_receber.valor,
    });
  }
  const soma = k => Math.round(linhas.reduce((s, l) => s + Number(l[k] || 0), 0) * 100) / 100;
  const pedidos = soma('pedidos');
  return {
    periodo: p, cadeia: { id: eu.grupo_id, nome: eu.grupo_nome }, estabelecimentos: linhas,
    total: { receita: soma('receita'), alojamento: soma('alojamento'), pedidos, custo_vendas: soma('custo_vendas'), despesas: soma('despesas'), resultado: soma('resultado'), por_receber: soma('por_receber'),
      ticket_medio: pedidos ? Math.round((soma('receita') - soma('alojamento')) / pedidos) : 0 },
  };
}

/** Superadmin: põe o estabelecimento numa cadeia pelo nome (cria-a se não existir) ou tira-o (nome vazio). */
async function definirCadeia({ tenantId, nome }) {
  const n = nome == null ? '' : String(nome).trim();
  if (n.length > 120) throw erro(400, 'Nome da cadeia demasiado longo (máximo 120)');
  let grupoId = null;
  if (n) {
    const g = await pool.query(
      `INSERT INTO grupos (nome) VALUES ($1) ON CONFLICT (LOWER(nome)) DO UPDATE SET nome = grupos.nome RETURNING id`, [n]);
    grupoId = g.rows[0].id;
  }
  const r = await pool.query(`UPDATE tenants SET grupo_id = $1, atualizado_em = NOW() WHERE id = $2 RETURNING id, grupo_id`, [grupoId, tenantId]);
  if (!r.rows[0]) throw erro(404, 'Tenant não encontrado');
  return { tenant_id: tenantId, grupo_id: grupoId, cadeia: n || null };
}

async function listarCadeias() {
  const r = await pool.query(
    `SELECT g.id, g.nome, COUNT(t.id)::int AS estabelecimentos FROM grupos g LEFT JOIN tenants t ON t.grupo_id = g.id GROUP BY g.id ORDER BY g.nome`);
  return r.rows;
}

module.exports = { estabelecimentos, trocar, consolidado, definirCadeia, listarCadeias };
