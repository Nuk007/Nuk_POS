'use strict';
/**
 * /api/auth — route handlers (thin layer).
 * Lógica de negócio em server/services/auth.service.js
 */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiters');
const svc = require('../services/auth.service');

// ── POST /api/auth/login ──────────────────────────────────────────────────────
/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Autentica um funcionário e devolve um JWT
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login bem-sucedido
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 funcionario: { $ref: '#/components/schemas/Funcionario' }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const result = await svc.login({ email: req.body.email, password: req.body.password });
    res.json(result);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    next(e);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     summary: Devolve o perfil do utilizador autenticado
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Perfil do utilizador
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Funcionario' }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const perfil = await svc.obterPerfil({ userId: req.user.id });
    res.json(perfil);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ erro: e.message });
    next(e);
  }
});

module.exports = router;
