'use strict';
/**
 * Controlo por módulo, lido da BD (cache de 15 s, por isso uma revogação vale quase de imediato):
 *  - exigirModulo(chave): a conta tem o acesso E o estabelecimento contratou o módulo a que a chave pertence;
 *  - exigirLicenca(modulo): o estabelecimento contratou o módulo (não olha ao acesso individual — serve rotas
 *    partilhadas por vários ecrãs do mesmo módulo).
 * Tokens sem a marca `permissoes` (emitidos antes desta funcionalidade) passam como antes até expirarem.
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { efectivas, chavesLicenciadas, licenciados } = require('../services/acessos');

const cache = new Map(); // userId -> { ate, f }
const TTL = 15000;

async function contaDe(userId) {
  const c = cache.get(userId);
  if (c && c.ate > Date.now()) return c.f;
  const r = await pool.query(
    `SELECT f.titular, f.nivel_acesso, f.permissoes, f.ativo, f.tenant_id, t.modulos
     FROM funcionarios f LEFT JOIN tenants t ON t.id = f.tenant_id WHERE f.id = $1`, [userId]);
  const f = r.rows[0] || null;
  cache.set(userId, { ate: Date.now() + TTL, f });
  return f;
}
const limparCache = () => cache.clear();

// montado antes do authMiddleware do router → lê o token aqui (token inválido: deixa o authMiddleware responder 401)
function utilizadorDoPedido(req) {
  let u = req.user;
  if (!u) {
    const h = req.headers.authorization;
    try { u = h && h.startsWith('Bearer ') ? jwt.verify(h.slice(7), process.env.JWT_SECRET) : null; } catch (_) { u = null; }
  }
  return u && Array.isArray(u.permissoes) ? u : null;
}

function exigirModulo(chave) {
  return async (req, res, next) => {
    try {
      const u = utilizadorDoPedido(req);
      if (!u) return next();
      const f = await contaDe(u.id);
      if (!f || !f.ativo) return res.status(403).json({ erro: 'Não tem acesso a este módulo. Peça a um administrador.' });
      if (f.tenant_id && !chavesLicenciadas(f.modulos).includes(chave)) return res.status(403).json({ erro: 'Este módulo não está incluído na licença do estabelecimento.' });
      if (!efectivas(f).includes(chave)) return res.status(403).json({ erro: 'Não tem acesso a este módulo. Peça a um administrador.' });
      next();
    } catch (e) { next(e); }
  };
}

function exigirLicenca(modulo) {
  return async (req, res, next) => {
    try {
      const u = utilizadorDoPedido(req);
      if (!u) return next();
      const f = await contaDe(u.id);
      if (f && f.tenant_id && !licenciados(f.modulos).includes(modulo)) return res.status(403).json({ erro: 'Este módulo não está incluído na licença do estabelecimento.' });
      next();
    } catch (e) { next(e); }
  };
}
module.exports = { exigirModulo, exigirLicenca, limparCache };
