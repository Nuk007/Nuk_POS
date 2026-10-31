'use strict';
/**
 * AuthService — lógica de autenticação isolada do route handler.
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { gerarToken } = require('../middleware/auth');

async function login({ email, password }) {
  if (!email || !password) {
    const err = new Error('Email e password são obrigatórios'); err.statusCode = 400; throw err;
  }

  const r = await pool.query(
    `SELECT f.*, t.slug as tenant_slug, t.nome as tenant_nome, t.estado as tenant_estado
     FROM funcionarios f
     LEFT JOIN tenants t ON f.tenant_id = t.id
     WHERE LOWER(f.email) = LOWER($1) AND f.ativo = true`,
    [email.trim()]
  );

  const funcionario = r.rows[0];
  if (!funcionario) {
    const err = new Error('Credenciais inválidas'); err.statusCode = 401; throw err;
  }

  if (funcionario.tenant_id && funcionario.tenant_estado !== 'ACTIVA') {
    const err = new Error('Conta suspensa. Contacte o administrador.'); err.statusCode = 403; throw err;
  }

  const ok = await bcrypt.compare(password, funcionario.password_hash);
  if (!ok) {
    const err = new Error('Credenciais inválidas'); err.statusCode = 401; throw err;
  }

  const payload = {
    id: funcionario.id,
    email: funcionario.email,
    nome: funcionario.nome,
    nivel_acesso: funcionario.nivel_acesso,
    tenantId: funcionario.tenant_id,
    tenantSlug: funcionario.tenant_slug,
    tenantNome: funcionario.tenant_nome,
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
    },
  };
}

async function obterPerfil({ userId }) {
  const r = await pool.query(
    `SELECT f.id, f.nome, f.email, f.nivel_acesso, f.tenant_id,
            t.slug as tenant_slug, t.nome as tenant_nome
     FROM funcionarios f
     LEFT JOIN tenants t ON f.tenant_id = t.id
     WHERE f.id = $1 AND f.ativo = true`,
    [userId]
  );
  if (!r.rows[0]) {
    const err = new Error('Funcionário não encontrado'); err.statusCode = 404; throw err;
  }
  return r.rows[0];
}

module.exports = { login, obterPerfil };
