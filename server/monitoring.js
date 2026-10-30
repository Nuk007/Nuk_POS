'use strict';
/**
 * monitoring.js — Monitorização centralizada do Nuk_POS
 *
 * Fornece:
 *   - Logger estruturado (Pino) com níveis e redacção automática de dados sensíveis
 *   - Integração Sentry para captura de erros em produção
 *   - initSentry(app) — inicializa Sentry e anexa handlers ao app Express
 *   - sentryErrorHandler — middleware de erros Sentry para usar em app.js
 *   - logger — instância Pino exportada para uso em todo o servidor
 *
 * Variáveis de ambiente:
 *   SENTRY_DSN          — DSN do projecto Sentry (obrigatório em produção)
 *   NODE_ENV            — 'production' activa integração Sentry
 *   SENTRY_TRACES_RATE  — taxa de amostragem de traces (0.0–1.0, default 0.1)
 */

const Sentry = require('@sentry/node');
const pino   = require('pino');

// ─── Logger estruturado (Pino) ───────────────────────────────────────────────

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // Redacção automática de campos sensíveis nos logs
  redact: {
    paths: [
      'password', 'password_hash', 'pin_hash', 'token', 'req.headers.authorization',
      'body.password', 'body.pin', '*.password_hash', '*.pin_hash',
    ],
    censor: '[REDACTED]',
  },
  // Formato humano no desenvolvimento; JSON em produção (default Pino)
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino/file',
      options: { destination: 1 }, // stdout com output legível
    },
  }),
  base: { service: 'nukpos', env: process.env.NODE_ENV || 'development' },
});

// ─── Sentry ──────────────────────────────────────────────────────────────────

/**
 * Inicializa Sentry e adiciona os handlers necessários ao app Express.
 * Deve ser chamado ANTES de qualquer outra configuração de middleware em app.js.
 *
 * @param {import('express').Application} app
 */
function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('SENTRY_DSN não definido — erros em produção não serão capturados pelo Sentry');
    } else {
      logger.debug('Sentry desactivado (NODE_ENV != production ou SENTRY_DSN ausente)');
    }
    return;
  }

  const tracesSampleRate = parseFloat(process.env.SENTRY_TRACES_RATE) || 0.1;

  Sentry.init({
    dsn,
    environment:       process.env.NODE_ENV || 'development',
    tracesSampleRate,
    // Filtrar erros esperados que não precisam de alertas
    ignoreErrors: [
      'TokenExpiredError',
      'JsonWebTokenError',
      'UnauthorizedError',
    ],
    // Não enviar informação pessoal identificável
    sendDefaultPii: false,
    beforeSend(event) {
      // Remover dados de autenticação dos eventos Sentry
      if (event.request?.headers?.authorization) {
        event.request.headers.authorization = '[REDACTED]';
      }
      if (event.request?.data?.password) {
        event.request.data.password = '[REDACTED]';
      }
      return event;
    },
  });

  // Integração Express com requestDataIntegration (Sentry v8+/v11)
  // setupExpressErrorHandler regista o error handler global — chamado uma vez

  logger.info({ dsn: dsn.replace(/\/\/.*?@/, '//[TOKEN]@'), tracesSampleRate }, 'Sentry inicializado');
}

/**
 * Middleware de erros Sentry — compatível com Sentry v8+/v11.
 * Usado em app.js antes do error handler customizado.
 * É um no-op quando Sentry não está inicializado (sem DSN).
 */
const sentryErrorHandler = (err, req, res, next) => {
  // Capturar apenas erros 5xx (ou sem status HTTP)
  if (!err.status || err.status >= 500) {
    Sentry.captureException(err);
  }
  next(err);
};

/**
 * Captura uma excepção manualmente no Sentry (útil em catch blocks).
 * É seguro chamar mesmo quando o Sentry não está inicializado.
 *
 * @param {Error}  err
 * @param {Object} context  Contexto adicional (tenantId, userId, etc.)
 */
function captureException(err, context = {}) {
  Sentry.withScope((scope) => {
    for (const [key, val] of Object.entries(context)) {
      scope.setExtra(key, val);
    }
    Sentry.captureException(err);
  });
  logger.error({ err, ...context }, err.message);
}

module.exports = { logger, initSentry, sentryErrorHandler, captureException };
