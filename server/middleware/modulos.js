'use strict';
/**
 * exigirModulo(chave) — recusa (403) quem não tem o acesso ao módulo. Lê a BD (cache de 15 s), por isso uma
 * revogação vale quase de imediato. Tokens sem a marca `permissoes` (emitidos antes desta funcionalidade) passam
 * como antes até expirarem.
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { efectivas } = require('../services/acessos');

const cache = new Map(); // userId -> { ate, f }
const TTL = 15000;

async function acessosDe(userId) {
  const c = cache.get(userId);
  if (c && c.ate > Date.now()) return c.f;
  const r = await pool.query(`SELECT titular, nivel_acesso, permissoes, ativo FROM funcionarios WHERE id = $1`, [userId]);
  const f = r.rows[0] || null;
  cache.set(userId, { ate: Date.now() + TTL, f });
  return f;
}
const limparCache = () => cache.clear();

function exigirModulo(chave) {
  return async (req, res, next) => {
    try {
      // montado antes do authMiddleware do router → lê o token aqui (token inválido: deixa o authMiddleware responder 401)
      let u = req.user;
      if (!u) {
        const h = req.headers.authorization;
        try { u = h && h.startsWith('Bearer ') ? jwt.verify(h.slice(7), process.env.JWT_SECRET) : null; } catch (_) { u = null; }
      }
      if (!u || !Array.isArray(u.permissoes)) return next();
      const f = await acessosDe(u.id);
      if (!f || !f.ativo || !efectivas(f).includes(chave)) return res.status(403).json({ erro: 'Não tem acesso a este módulo. Peça a um administrador.' });
      next();
    } catch (e) { next(e); }
  };
}
module.exports = { exigirModulo, limparCache };
