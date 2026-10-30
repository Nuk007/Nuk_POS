'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { pool } = require('../db');
const { gerarToken, authMiddleware } = require('../middleware/auth');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Demasiadas tentativas. Aguarde 15 minutos.' },
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ erro: 'Email e password são obrigatórios' });
  }
  try {
    const r = await pool.query(
      `SELECT f.*, t.slug as tenant_slug, t.nome as tenant_nome, t.ativo as tenant_ativo
       FROM funcionarios f
       LEFT JOIN tenants t ON f.tenant_id = t.id
       WHERE LOWER(f.email) = LOWER($1) AND f.ativo = true`,
      [email.trim()]
    );
    if (!r.rows[0]) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }
    const funcionario = r.rows[0];

    // Verificar se o tenant está activo (excepto superadmin que não tem tenant)
    if (funcionario.tenant_id && !funcionario.tenant_ativo) {
      return res.status(403).json({ erro: 'Conta suspensa. Contacte o administrador.' });
    }

    const ok = await bcrypt.compare(password, funcionario.password_hash);
    if (!ok) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
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

    const token = gerarToken(payload);
    res.json({
      token,
      funcionario: {
        id: funcionario.id,
        nome: funcionario.nome,
        email: funcionario.email,
        nivel_acesso: funcionario.nivel_acesso,
        tenant_slug: funcionario.tenant_slug,
        tenant_nome: funcionario.tenant_nome,
      },
    });
  } catch (e) {
    console.error('POST /api/auth/login:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.id, f.nome, f.email, f.nivel_acesso, f.tenant_id,
              t.slug as tenant_slug, t.nome as tenant_nome
       FROM funcionarios f
       LEFT JOIN tenants t ON f.tenant_id = t.id
       WHERE f.id = $1 AND f.ativo = true`,
      [req.user.id]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Funcionário não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

module.exports = router;
