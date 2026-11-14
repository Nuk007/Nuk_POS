'use strict';
/**
 * AuthService — lógica de autenticação isolada do route handler.
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { gerarToken } = require('../middleware/auth');
const { efectivasLicenciadas, licenciados } = require('./acessos');

const CONTA_SQL = `SELECT f.*, t.slug as tenant_slug, t.nome as tenant_nome, t.estado as tenant_estado, t.modulos as tenant_modulos
     FROM funcionarios f LEFT JOIN tenants t ON f.tenant_id = t.id`;

/** Token e dados da sessão de uma conta (login e troca de estabelecimento). */
function sessaoDe(funcionario) {
  const permissoes = efectivasLicenciadas(funcionario, funcionario.tenant_modulos);
  const payload = {
    id: funcionario.id,
    email: funcionario.email,
    nome: funcionario.nome,
    nivel_acesso: funcionario.nivel_acesso,
    tenantId: funcionario.tenant_id,
    tenantSlug: funcionario.tenant_slug,
    tenantNome: funcionario.tenant_nome,
    permissoes,
  };
  return {
    token: gerarToken(payload),
    funcionario: {
      id: funcionario.id,
      nome: funcionario.nome,
      email: funcionario.email,
      nivel_acesso: funcionario.nivel_acesso,
      tenant_slug: funcionario.tenant_slug,
      tenant_nome: funcionario.tenant_nome,
      titular: !!funcionario.titular,
      pode_vender_quartos: !!funcionario.pode_vender_quartos,
      arruma_quartos: !!funcionario.arruma_quartos,
      permissoes,
      modulos: funcionario.tenant_id ? licenciados(funcionario.tenant_modulos) : null,
    },
  };
}

/**
 * Login por email e palavra-passe. O mesmo email pode ter conta em vários estabelecimentos (dono de uma cadeia):
 * entra na primeira conta activa cuja palavra-passe confere (titular primeiro, depois a mais antiga); antes
 * olhava só para a primeira conta encontrada e recusava a palavra-passe certa das outras.
 */
async function login({ email, password }) {
  if (!email || !password) {
    const err = new Error('Email e password são obrigatórios'); err.statusCode = 400; throw err;
  }
  const r = await pool.query(
    `${CONTA_SQL} WHERE LOWER(f.email) = LOWER($1) AND f.ativo = true
      ORDER BY (t.estado = 'ACTIVA' OR f.tenant_id IS NULL) DESC, f.titular DESC NULLS LAST, f.criado_em LIMIT 10`,
    [email.trim()]
  );
  let suspensa = false;
  for (const funcionario of r.rows) {
    if (!(await bcrypt.compare(password, funcionario.password_hash))) continue;
    if (funcionario.tenant_id && funcionario.tenant_estado !== 'ACTIVA') { suspensa = true; continue; }
    return sessaoDe(funcionario);
  }
  if (suspensa) { const err = new Error('Conta suspensa. Contacte o administrador.'); err.statusCode = 403; throw err; }
  const err = new Error('Credenciais inválidas'); err.statusCode = 401; throw err;
}

async function obterPerfil({ userId }) {
  const r = await pool.query(
    `SELECT f.id, f.nome, f.email, f.nivel_acesso, f.tenant_id, f.titular, f.pode_vender_quartos, f.arruma_quartos, f.permissoes,
            t.slug as tenant_slug, t.nome as tenant_nome, t.modulos as tenant_modulos
     FROM funcionarios f
     LEFT JOIN tenants t ON f.tenant_id = t.id
     WHERE f.id = $1 AND f.ativo = true`,
    [userId]
  );
  if (!r.rows[0]) {
    const err = new Error('Funcionário não encontrado'); err.statusCode = 404; throw err;
  }
  const { permissoes, tenant_modulos, ...resto } = r.rows[0];
  return { ...resto, permissoes: efectivasLicenciadas(r.rows[0], tenant_modulos), modulos: r.rows[0].tenant_id ? licenciados(tenant_modulos) : null };
}

module.exports = { login, obterPerfil, sessaoDe, CONTA_SQL };
