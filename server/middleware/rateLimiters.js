'use strict';
/**
 * Rate limiters centralizados — aplicados por rota ou grupo de rotas.
 *
 * Hierarquia de protecção:
 *   - globalLimiter:     200 req / 15 min — todas as rotas /api/
 *   - apiWriteLimiter:   60 req / min     — POSTs/PATCHes em geral
 *   - loginLimiter:      10 req / 15 min  — POST /api/auth/login
 *   - saasLimiter:       5 req / 15 min   — criação de tenants (superadmin)
 *   - stockMovLimiter:   30 req / min     — movimentos de stock (transacções)
 */

const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Demasiados pedidos. Tente novamente mais tarde.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Demasiadas tentativas de login. Aguarde 15 minutos.' },
  skipSuccessfulRequests: true, // só conta falhas
});

const saasLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Demasiados pedidos ao painel de administração.' },
});

const apiWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Demasiados pedidos de escrita. Tente novamente em breve.' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD',
});

const stockMovLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Demasiados movimentos de stock em simultâneo.' },
});

module.exports = { globalLimiter, loginLimiter, saasLimiter, apiWriteLimiter, stockMovLimiter };
