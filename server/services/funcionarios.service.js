'use strict';
/**
 * FuncionariosService — contas do estabelecimento.
 * Regra do dono: a 1.ª conta (ADMIN) é a TITULAR; não se desactiva nem se despromove — só transfere a titularidade.
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { erro, withTx } = require('./shared');

const NIVEIS = ['ADMIN', 'GERENTE', 'OPERADOR'];
const COLS = `id, nome, email, cargo, nivel_acesso, salario, media_avaliacao, total_avaliacoes, ativo, titular,
              pode_vender_quartos, arruma_quartos, ultimo_acesso, criado_em`;

const bool = v => (v === undefined || v === null ? null : v === true || v === 'true');

async function listar({ tenantId }) {
  const r = await pool.query(`SELECT ${COLS} FROM funcionarios WHERE ($1::uuid IS NULL OR tenant_id = $1) ORDER BY titular DESC, nome`, [tenantId || null]);
  return r.rows;
}

async function criar({ tenantId, nome, email, password, nivel_acesso, cargo, salario, pode_vender_quartos, arruma_quartos }) {
  if (!nome || !email || !password) throw erro(400, 'nome, email e password são obrigatórios');
  if (!NIVEIS.includes(nivel_acesso)) throw erro(400, `nivel_acesso inválido. Valores: ${NIVEIS.join(', ')}`);
  if (String(password).length < 8) throw erro(400, 'A palavra-passe deve ter pelo menos 8 caracteres');
  // M-02: unicidade de email por tenant, não global
  const ex = await pool.query(`SELECT id FROM funcionarios WHERE LOWER(email) = LOWER($1) AND ($2::uuid IS NULL OR tenant_id = $2)`, [email.trim(), tenantId || null]);
  if (ex.rows[0]) throw erro(409, 'Email já registado neste estabelecimento');
  const hash = await bcrypt.hash(password, 12);
  const r = await pool.query(
    `INSERT INTO funcionarios (id, tenant_id, nome, email, password_hash, nivel_acesso, cargo, salario, pode_vender_quartos, arruma_quartos, ativo, criado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW()) RETURNING ${COLS}`,
    [uuidv4(), tenantId || null, nome.trim(), email.trim().toLowerCase(), hash, nivel_acesso, cargo || null, Number(salario) || 0, bool(pode_vender_quartos) === true, bool(arruma_quartos) === true]);
  return r.rows[0];
}

async function actualizar({ tenantId, id, nome, nivel_acesso, ativo, password, cargo, salario, pode_vender_quartos, arruma_quartos }) {
  if (nivel_acesso !== undefined && !NIVEIS.includes(nivel_acesso)) throw erro(400, `nivel_acesso inválido. Valores: ${NIVEIS.join(', ')}`);
  if (password !== undefined && password !== '' && String(password).length < 8) throw erro(400, 'A palavra-passe deve ter pelo menos 8 caracteres');
  const hash = password ? await bcrypt.hash(password, 12) : null;
  const novoAtivo = ativo !== undefined ? bool(ativo) : null;
  // A guarda do titular está no próprio UPDATE: nunca fica inactivo nem deixa de ser ADMIN.
  const r = await pool.query(
    `UPDATE funcionarios SET
       nome = COALESCE($1, nome),
       nivel_acesso = COALESCE($2, nivel_acesso),
       ativo = COALESCE($3, ativo),
       password_hash = COALESCE($4, password_hash),
       cargo = COALESCE($5, cargo),
       salario = COALESCE($6, salario),
       pode_vender_quartos = COALESCE($7, pode_vender_quartos),
       arruma_quartos = COALESCE($8, arruma_quartos),
       atualizado_em = NOW()
     WHERE id = $9 AND ($10::uuid IS NULL OR tenant_id = $10)
       AND NOT (titular AND (COALESCE($3, true) = false OR COALESCE($2, 'ADMIN') <> 'ADMIN'))
     RETURNING ${COLS}`,
    [nome || null, nivel_acesso || null, novoAtivo, hash, cargo === undefined ? null : cargo, salario === undefined ? null : Number(salario) || 0,
     bool(pode_vender_quartos), bool(arruma_quartos), id, tenantId || null]);
  if (r.rows[0]) return r.rows[0];
  const ex = await pool.query(`SELECT titular FROM funcionarios WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [id, tenantId || null]);
  if (!ex.rows[0]) throw erro(404, 'Funcionário não encontrado');
  throw erro(403, 'O titular do estabelecimento não pode ser desactivado nem despromovido. Transfira primeiro a titularidade.');
}

/** O titular actual passa a titularidade a outro funcionário activo (que fica ADMIN). Exige a palavra-passe do titular. */
async function transferirTitularidade({ tenantId, userId, novoTitularId, password }) {
  if (!novoTitularId || !password) throw erro(400, 'Indique o novo titular e a sua palavra-passe');
  if (!tenantId) throw erro(400, 'Estabelecimento em falta');
  const eu = await pool.query(`SELECT titular, password_hash FROM funcionarios WHERE id = $1 AND tenant_id = $2 AND ativo = true`, [userId, tenantId]);
  if (!eu.rows[0] || !eu.rows[0].titular) throw erro(403, 'Só o titular do estabelecimento pode transferir a titularidade');
  if (!(await bcrypt.compare(String(password), eu.rows[0].password_hash))) throw erro(401, 'Palavra-passe incorrecta');
  if (novoTitularId === userId) throw erro(400, 'Já é o titular');
  return withTx(async (db) => {
    const alvo = await db.query(`SELECT id, nome FROM funcionarios WHERE id = $1 AND tenant_id = $2 AND ativo = true FOR UPDATE`, [novoTitularId, tenantId]);
    if (!alvo.rows[0]) throw erro(404, 'Funcionário não encontrado ou inactivo');
    await db.query(`UPDATE funcionarios SET titular = false WHERE tenant_id = $1 AND titular`, [tenantId]);
    await db.query(`UPDATE funcionarios SET titular = true, nivel_acesso = 'ADMIN', atualizado_em = NOW() WHERE id = $1`, [novoTitularId]);
    return { titular_id: novoTitularId, nome: alvo.rows[0].nome };
  });
}

/** Tem o perfil pedido? (consulta à BD: a revogação é imediata, não depende do JWT) */
async function temPerfil(tenantId, userId, coluna) {
  if (!['pode_vender_quartos', 'arruma_quartos'].includes(coluna)) throw new Error('perfil desconhecido'); // coluna fixa
  const r = await pool.query(`SELECT ${coluna} AS v FROM funcionarios WHERE id = $1 AND tenant_id = $2 AND ativo = true`, [userId, tenantId]);
  return !!(r.rows[0] && r.rows[0].v);
}

module.exports = { listar, criar, actualizar, transferirTitularidade, temPerfil, NIVEIS };
