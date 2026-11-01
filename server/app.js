// Nuk_POS — Servidor Principal (refactored)
// Stack: Node.js + Express + PostgreSQL + Socket.io
// SaaS multi-tenant: cada empresa tem tenant_id em todas as operações
// v2026.11.01.4-config-quartos

require('dotenv').config();
console.log('[NukPOS] server/app.js v2026.11.01.4-config-quartos a arrancar');

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { pool, initDB } = require('./db');
const { router: saasRouter, verificarLicencaTenant, resolverTenant } = require('./saas');
const broadcast = require('./middleware/broadcast');
const { initWebSocket } = require('./websocket');
const { logger, initSentry, sentryErrorHandler } = require('./monitoring');
const { globalLimiter, apiWriteLimiter } = require('./middleware/rateLimiters');

// ── Protecção global ─────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.warn({ reason: reason?.message || String(reason) }, '⚠️  UnhandledRejection (ignorado para não crashar)');
});

// ── Express + HTTP server ────────────────────────────────────
const app = express();

// Sentry DEVE ser inicializado antes de qualquer middleware
initSentry(app);

const server = http.createServer(app);

// ── WebSocket ────────────────────────────────────────────────
const allowedOriginsWS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? (origin, cb) => {
          if (!origin || allowedOriginsWS.some(o => origin.startsWith(o))) cb(null, true);
          else cb(new Error('WS CORS não permitido'));
        }
      : true,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Inicializar módulos que dependem de io
broadcast.init(io);
initWebSocket(io);

// ── Trust proxy (Render usa reverse proxy) ───────────────────
app.set('trust proxy', 1);

// ── Middlewares globais ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // B-02 fix: removido 'unsafe-inline' de scriptSrc; os handlers onclick= foram migrados para addEventListener
      scriptSrc: ["'self'", "https://cdn.socket.io"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    },
  },
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (origin, cb) => {
        if (!origin || allowedOrigins.some(o => origin.startsWith(o))) cb(null, true);
        else cb(new Error('CORS não permitido'));
      }
    : true,
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiters (ver middleware/rateLimiters.js)
app.use('/api/', globalLimiter);
app.use('/api/', apiWriteLimiter);

// ── Estático: HTML sem cache ─────────────────────────────────
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Documentação da API (Swagger UI) ─────────────────────────
// O Swagger UI usa scripts/estilos inline; relaxa-se o CSP apenas nesta rota.
const swaggerUi   = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));
app.use('/api/docs',
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:"],
    },
  }),
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, { customSiteTitle: 'Nuk_POS API Docs' })
);

// ── Rotas SaaS (superadmin + activação de tenants) ───────────
// saasLimiter aplica-se só a POST /tenants (dentro de saas.js) — nunca ao router inteiro.
// Estava aqui a cobrir TODO o /api/saas (dashboard, listar/ver tenants, activação pública…)
// com 5 pedidos/15min, quando o limite era pensado só para a criação de tenants (ver
// server/middleware/rateLimiters.js): qualquer navegação normal no painel — dashboard +
// listar + abrir um tenant já são 3 pedidos — esgotava o limite e bloqueava o superadmin
// por 15 minutos, devolvendo "Demasiados pedidos ao painel de administração." (descoberto
// em 01/11/2026 ao diagnosticar "a chave não funciona").
app.use('/api/saas', saasRouter);

// ── Rotas autenticadas ───────────────────────────────────────
// C-01 fix: resolverTenant corre PRIMEIRO para popular req.tenantId a partir do JWT,
// depois verificarLicencaTenant valida a licença usando esse tenantId.
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/dashboard',      resolverTenant, verificarLicencaTenant, require('./routes/dashboard'));
app.use('/api/funcionarios',   resolverTenant, verificarLicencaTenant, require('./routes/funcionarios'));
app.use('/api/mesas',          resolverTenant, verificarLicencaTenant, require('./routes/mesas'));
app.use('/api/produtos',       resolverTenant, verificarLicencaTenant, require('./routes/produtos'));
app.use('/api/pedidos',        resolverTenant, verificarLicencaTenant, require('./routes/pedidos'));
app.use('/api/quartos',        resolverTenant, verificarLicencaTenant, require('./routes/quartos'));
app.use('/api/reservas',       resolverTenant, verificarLicencaTenant, require('./routes/reservas'));
app.use('/api/solicitacoes-hospedagem', resolverTenant, verificarLicencaTenant, require('./routes/solicitacoes'));
app.use('/api/solicitacoes-portal', resolverTenant, verificarLicencaTenant, require('./routes/solicitacoes-portal'));
app.use('/api/stock',          resolverTenant, verificarLicencaTenant, require('./routes/stock'));
app.use('/api/financeiro',     resolverTenant, verificarLicencaTenant, require('./routes/financeiro'));
app.use('/api/clientes',       resolverTenant, verificarLicencaTenant, require('./routes/clientes'));
app.use('/api/chamadas',       resolverTenant, verificarLicencaTenant, require('./routes/chamadas'));
app.use('/api/configuracoes',  resolverTenant, verificarLicencaTenant, require('./routes/configuracoes'));
app.use('/api/qrcode',         resolverTenant, verificarLicencaTenant, require('./routes/qrcode'));

// ── Portal cliente — rotas públicas (sem JWT, com resolverTenantPublico) ──
// NOTA: deve ficar ANTES do SPA fallback (*)
const { router: portalClienteRouter } = require('./routes/portal-cliente');
app.use('/api/cliente', portalClienteRouter);

// ── Health check (uptime monitoring) ─────────────────────────
app.get('/api/health', async (req, res) => {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      version: process.env.npm_package_version || '1.0.0',
      env: process.env.NODE_ENV || 'development',
      db: 'ok',
      uptime: Math.floor(process.uptime()),
      latency_ms: Date.now() - start,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Health check: DB offline');
    res.status(503).json({
      status: 'degraded',
      db: 'offline',
      error: err.message,
      ts: new Date().toISOString(),
    });
  }
});

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada' });
  if (req.path === '/cliente' || req.path === '/cliente/') {
    return res.sendFile(path.join(__dirname, '..', 'public', 'cliente.html'));
  }
  // Link de activação enviado por WhatsApp ao criar o tenant (server/saas.js: `${baseUrl}/activate/${licenseKey}`)
  // — sem isto caía no índice (login do POS) e a activação de qualquer estabelecimento novo ficava impossível.
  if (req.path === '/activate' || req.path.startsWith('/activate/')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'activate.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Sentry error handler (deve ser ANTES do error handler custom) ─────────
app.use(sentryErrorHandler);

// ── Error handler global ──────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error({ err, code: err.code, detail: err.detail }, '❌ Erro global');
  if (res.headersSent) return;
  if (err.code === '23505') return res.status(409).json({ erro: 'Registo duplicado' });
  if (err.code === '23514') return res.status(400).json({ erro: 'Valor inválido (constraint violada)' });
  if (err.code === '23503') return res.status(400).json({ erro: 'Referência inválida' });
  if (err.name === 'JsonWebTokenError') return res.status(401).json({ erro: 'Token inválido' });
  if (err.name === 'TokenExpiredError') return res.status(401).json({ erro: 'Token expirado' });
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ── Arranque (directo, ou via scripts/start.js que aplica migrações antes) ──
const executadoDirectamente = require.main === module;
const executadoPeloStart    = require.main && /scripts[\\/]start\.js$/.test(require.main.filename || '');
if (executadoDirectamente || executadoPeloStart) {
  const PORT = process.env.PORT || 3000;

  server.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, '🚀 Nuk_POS v1.0 a correr');

    initDB()
      .then(() => {
        logger.info('✅ Base de dados pronta');
      })
      .catch((err) => {
        logger.error({ err }, '❌ Falha ao inicializar base de dados — verifique DATABASE_URL');
      });
  });
}

module.exports = { app, server };
