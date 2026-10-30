// Nuk_POS — Servidor Principal
// Stack: Node.js + Express + PostgreSQL + Socket.io
// SaaS multi-tenant: cada empresa tem tenant_id em todas as operações

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const { pool, initDB } = require('./db');
const { router: saasRouter, verificarLicencaTenant, resolverTenant, resolverTenantPublico } = require('./saas');

const app = express();
const server = http.createServer(app);

// ── Protecção global — evita crash em rotas async sem try/catch ──
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  UnhandledRejection (ignorado para não crashar):', reason?.message || reason);
});

// ── WebSocket ───────────────────────────────────────────────
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

// ── Trust proxy (Render usa reverse proxy) ───────────────────
app.set('trust proxy', 1);

// ── Middlewares ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
    },
  },
}));

// CORS: em produção restringir ao domínio do Render
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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Demasiadas tentativas. Aguarde 15 minutos.' },
});
app.use('/api/', limiter);

// ── Frontend estático ────────────────────────────────────────
// HTML sem cache para garantir que o browser carrega sempre a versão mais recente
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Helpers JWT ──────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: JWT_SECRET não definido em produção. Definir a variável de ambiente.');
  process.exit(1);
}
const JWT_SECRET_EFFECTIVE = JWT_SECRET || 'nukpos_dev_secret_APENAS_DESENVOLVIMENTO';
const JWT_EXPIRY = '8h';

function gerarToken(payload) {
  return jwt.sign(payload, JWT_SECRET_EFFECTIVE, { expiresIn: JWT_EXPIRY });
}

// Validar UUID para evitar erros 500 do PostgreSQL
function isUUID(val) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}
function validarUUID(paramName) {
  return (req, res, next) => {
    if (!isUUID(req.params[paramName])) {
      return res.status(400).json({ erro: `${paramName} inválido` });
    }
    next();
  };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET_EFFECTIVE);
    // Injectar tenantId no request para isolamento multi-tenant
    req.tenantId = req.user.tenantId || null;
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

function requerNivel(niveis) {
  return (req, res, next) => {
    if (!niveis.includes(req.user.nivel_acesso)) {
      return res.status(403).json({ erro: 'Permissão insuficiente' });
    }
    next();
  };
}

// broadcast helper — emite apenas para a room do tenant quando tenantId fornecido
function broadcast(evento, dados, tenantId) {
  if (tenantId) {
    io.to(`tenant:${tenantId}`).emit(evento, dados);
  } else {
    io.emit(evento, dados);
  }
}

// ════════════════════════════════════════════════════════════
// ROTAS API
// ════════════════════════════════════════════════════════════

// ── SaaS: Superadmin + Activação ─────────────────────────────
// /api/superadmin/* — gestão de tenants e licenças (chave SUPERADMIN_KEY)
// /api/activate/:key — página de activação (público)
app.use('/api/superadmin', saasRouter);
app.use('/api/activate',   saasRouter);

// ── Rota de activação HTML (redireciona para página) ─────────
app.get('/activate/:key', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'activate.html'));
});

// ── Health ───────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString(), versao: '2.0.0', saas: true, db: 'ok' });
  } catch {
    // Retornar 200 mesmo sem BD — o Render usa este endpoint para verificar que o processo está vivo
    // Endpoints que precisam de BD retornarão erro individualmente
    res.json({ status: 'ok', timestamp: new Date().toISOString(), versao: '2.0.0', saas: true, db: 'indisponível' });
  }
});

// ── Auth ─────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password, tenant_slug } = req.body;
  if (!email || !password) return res.status(400).json({ erro: 'Email e senha são obrigatórios' });

  try {
    // Multi-tenant: procurar funcionário no tenant correcto
    let query, params;
    if (tenant_slug) {
      query = `
        SELECT f.id, f.nome, f.email, f.password_hash, f.nivel_acesso, f.cargo, f.ativo,
               f.tenant_id, t.slug AS tenant_slug, t.nome AS tenant_nome, t.estado AS tenant_estado
        FROM funcionarios f
        JOIN tenants t ON t.id = f.tenant_id
        WHERE f.email = $1 AND t.slug = $2
        LIMIT 1
      `;
      params = [email.toLowerCase(), tenant_slug];
    } else {
      query = `
        SELECT f.id, f.nome, f.email, f.password_hash, f.nivel_acesso, f.cargo, f.ativo,
               f.tenant_id, t.slug AS tenant_slug, t.nome AS tenant_nome, t.estado AS tenant_estado
        FROM funcionarios f
        LEFT JOIN tenants t ON t.id = f.tenant_id
        WHERE f.email = $1
        LIMIT 1
      `;
      params = [email.toLowerCase()];
    }

    const r = await pool.query(query, params);
    const func = r.rows[0];
    if (!func || !func.ativo) return res.status(401).json({ erro: 'Credenciais inválidas' });

    if (func.tenant_estado && !['ACTIVA'].includes(func.tenant_estado)) {
      return res.status(403).json({
        erro: `Conta da empresa ${func.tenant_estado === 'SUSPENSA' ? 'suspensa' : 'inactiva'}. Contacte o suporte.`,
        codigo: `TENANT_${func.tenant_estado}`,
      });
    }

    const ok = await bcrypt.compare(password, func.password_hash);
    if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas' });

    await pool.query(`UPDATE funcionarios SET ultimo_acesso = NOW() WHERE id = $1`, [func.id]);

    const payload = {
      id: func.id, nome: func.nome, email: func.email,
      nivel_acesso: func.nivel_acesso, cargo: func.cargo,
      tenantId: func.tenant_id, tenantSlug: func.tenant_slug, tenantNome: func.tenant_nome,
    };

    const token = gerarToken(payload);
    res.json({
      token,
      utilizador: {
        id: func.id, nome: func.nome, email: func.email,
        nivel_acesso: func.nivel_acesso, cargo: func.cargo,
        tenant_id: func.tenant_id, tenant_slug: func.tenant_slug, tenant_nome: func.tenant_nome,
      },
    });
  } catch (e) {
    console.error('POST /api/auth/login:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, email, cargo, nivel_acesso, media_avaliacao, total_avaliacoes, ultimo_acesso FROM funcionarios WHERE id = $1`,
      [req.user.id]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Utilizador não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Funcionários ─────────────────────────────────────────────
app.get('/api/funcionarios', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT id, nome, email, cargo, nivel_acesso, salario, media_avaliacao, total_avaliacoes, ativo, ultimo_acesso
       FROM funcionarios
       WHERE ($1::uuid IS NULL OR tenant_id = $1)
       ORDER BY nome`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/funcionarios:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/api/funcionarios', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const { nome, email, password, cargo, nivel_acesso, salario } = req.body;
  if (!nome || !email || !password) return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios' });
  // Validar nivel_acesso ANTES de ir à BD (evita crash por constraint violation)
  const NIVEIS_VALIDOS = ['ADMIN', 'GERENTE', 'OPERADOR'];
  const nivelFinal = nivel_acesso || 'OPERADOR';
  if (!NIVEIS_VALIDOS.includes(nivelFinal)) {
    return res.status(400).json({ erro: `nivel_acesso inválido. Valores aceites: ${NIVEIS_VALIDOS.join(', ')}` });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const tenantId = req.tenantId;
    const r = await pool.query(
      `INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso, salario)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nome, email, cargo, nivel_acesso`,
      [tenantId, nome, email.toLowerCase(), hash, cargo || null, nivelFinal, salario || 0]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('❌ Erro POST /api/funcionarios:', e.message, e.detail || '');
    if (e.code === '23505') return res.status(409).json({ erro: 'Email já registado' });
    if (e.code === '23514') return res.status(400).json({ erro: 'Valor inválido para nivel_acesso' });
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.put('/api/funcionarios/:id', authMiddleware, validarUUID('id'), requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const { nome, cargo, nivel_acesso, salario, ativo, password } = req.body;
  const NIVEIS_VALIDOS = ['ADMIN', 'GERENTE', 'OPERADOR'];
  if (nivel_acesso && !NIVEIS_VALIDOS.includes(nivel_acesso)) {
    return res.status(400).json({ erro: 'nivel_acesso inválido. Valores aceites: ADMIN, GERENTE, OPERADOR' });
  }
  const tenantId = req.tenantId;
  try {
    const campos = [];
    const vals = [];
    let i = 1;
    if (nome) { campos.push(`nome=$${i++}`); vals.push(nome); }
    if (cargo !== undefined) { campos.push(`cargo=$${i++}`); vals.push(cargo); }
    if (nivel_acesso) { campos.push(`nivel_acesso=$${i++}`); vals.push(nivel_acesso); }
    if (salario !== undefined) { campos.push(`salario=$${i++}`); vals.push(salario); }
    if (ativo !== undefined) { campos.push(`ativo=$${i++}`); vals.push(ativo); }
    if (password && password.length >= 8) {
      const hash = await bcrypt.hash(password, 12);
      campos.push(`password_hash=$${i++}`); vals.push(hash);
    }
    if (!campos.length) return res.status(400).json({ erro: 'Nenhum campo para actualizar' });
    campos.push(`atualizado_em=NOW()`);
    vals.push(req.params.id);
    vals.push(tenantId || null);
    const r = await pool.query(
      `UPDATE funcionarios SET ${campos.join(',')} WHERE id=$${i} AND ($${i + 1}::uuid IS NULL OR tenant_id=$${i + 1}) RETURNING id, nome, email, cargo, nivel_acesso, ativo`,
      vals
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('❌ Erro PUT /api/funcionarios/:id:', e.message, e.detail || '');
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Mesas ────────────────────────────────────────────────────
app.get('/api/mesas', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT m.*,
        (SELECT COUNT(*) FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('FECHADO','CANCELADO')) as pedidos_activos
       FROM mesas m
       WHERE ($1::uuid IS NULL OR m.tenant_id = $1)
       ORDER BY m.zona, m.numero`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/mesas:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.patch('/api/mesas/:id/status', authMiddleware, validarUUID('id'), async (req, res) => {
  const STATUSES_VALIDOS = ['LIVRE','OCUPADA','RESERVADA','LIMPEZA','MANUTENCAO'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE mesas SET status=$1, ultima_atividade=NOW()
       WHERE id=$2 AND ($3::uuid IS NULL OR tenant_id = $3) RETURNING *`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Mesa não encontrada' });
    broadcast('mesa_atualizada', r.rows[0], tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PATCH /api/mesas/:id/status:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Produtos ─────────────────────────────────────────────────
app.get('/api/produtos', authMiddleware, async (req, res) => {
  const { categoria, disponivel } = req.query;
  const tenantId = req.tenantId;
  try {
    let q = `SELECT * FROM produtos WHERE ativo = true AND ($1::uuid IS NULL OR tenant_id = $1)`;
    const vals = [tenantId || null];
    if (categoria) { q += ` AND categoria = $${vals.length + 1}`; vals.push(categoria); }
    if (disponivel !== undefined) { q += ` AND disponivel = $${vals.length + 1}`; vals.push(disponivel === 'true'); }
    q += ` ORDER BY categoria, nome`;
    const r = await pool.query(q, vals);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/produtos:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/api/produtos', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const { nome, descricao, categoria, preco, disponivel } = req.body;
  if (!nome || !categoria || !preco) return res.status(400).json({ erro: 'Nome, categoria e preço são obrigatórios' });
  const CATS_VALIDAS = ['CHURRASCO','PEIXE','BEBIDA','SOBREMESA','ACOMPANHAMENTO','COCKTAIL','ENTRADA','SHISHA','PRATO','OUTRO'];
  if (!CATS_VALIDAS.includes(categoria)) {
    return res.status(400).json({ erro: `Categoria inválida. Válidas: ${CATS_VALIDAS.join(', ')}` });
  }
  try {
    const tenantId = req.tenantId;
    const r = await pool.query(
      `INSERT INTO produtos (tenant_id, nome, descricao, categoria, preco, disponivel) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId, nome, descricao || null, categoria, preco, disponivel !== false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('❌ Erro POST /api/produtos:', e.message, e.detail || '');
    if (e.code === '23514') return res.status(400).json({ erro: 'Categoria inválida' });
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.put('/api/produtos/:id', authMiddleware, validarUUID('id'), requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const { nome, descricao, categoria, preco, disponivel, ativo } = req.body;
  try {
    const tenantId = req.tenantId;
    const r = await pool.query(
      `UPDATE produtos SET nome=COALESCE($1,nome), descricao=COALESCE($2,descricao), categoria=COALESCE($3,categoria),
       preco=COALESCE($4,preco), disponivel=COALESCE($5,disponivel), ativo=COALESCE($6,ativo), atualizado_em=NOW()
       WHERE id=$7 AND ($8::uuid IS NULL OR tenant_id = $8) RETURNING *`,
      [nome, descricao, categoria, preco, disponivel, ativo, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Produto não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('❌ Erro PUT /api/produtos/:id:', e.message, e.detail || '');
    if (e.code === '23514') return res.status(400).json({ erro: 'Categoria inválida' });
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Pedidos ──────────────────────────────────────────────────
app.get('/api/pedidos', authMiddleware, async (req, res) => {
  const { status, mesa_id, data_inicio, data_fim } = req.query;
  const tenantId = req.tenantId;
  let q = `
    SELECT p.*, m.numero as mesa_numero, m.zona as mesa_zona,
           f.nome as funcionario_nome,
           json_agg(json_build_object(
             'id', ip.id, 'produto_id', ip.produto_id, 'produto_nome', pr.nome,
             'quantidade', ip.quantidade, 'preco_unitario', ip.preco_unitario,
             'status_cozinha', ip.status_cozinha, 'observacoes', ip.observacoes
           )) FILTER (WHERE ip.id IS NOT NULL) as itens
    FROM pedidos p
    LEFT JOIN mesas m ON p.mesa_id = m.id
    LEFT JOIN funcionarios f ON p.funcionario_id = f.id
    LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
    LEFT JOIN produtos pr ON ip.produto_id = pr.id
    WHERE ($1::uuid IS NULL OR p.tenant_id = $1)
  `;
  const vals = [tenantId || null];
  if (status) { q += ` AND p.status = $${vals.length + 1}`; vals.push(status); }
  if (mesa_id) { q += ` AND p.mesa_id = $${vals.length + 1}`; vals.push(mesa_id); }
  if (data_inicio) { q += ` AND p.criado_em >= $${vals.length + 1}`; vals.push(data_inicio); }
  if (data_fim) { q += ` AND p.criado_em <= $${vals.length + 1}`; vals.push(data_fim); }
  q += ` GROUP BY p.id, m.numero, m.zona, f.nome ORDER BY p.criado_em DESC`;
  try {
    const r = await pool.query(q, vals);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/pedidos:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.get('/api/pedidos/hoje', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(`
      SELECT p.*, m.numero as mesa_numero,
             json_agg(json_build_object(
               'produto_nome', pr.nome, 'quantidade', ip.quantidade,
               'preco_unitario', ip.preco_unitario, 'status_cozinha', ip.status_cozinha
             )) FILTER (WHERE ip.id IS NOT NULL) as itens
      FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
      LEFT JOIN produtos pr ON ip.produto_id = pr.id
      WHERE p.criado_em >= CURRENT_DATE AT TIME ZONE 'Africa/Luanda'
        AND ($1::uuid IS NULL OR p.tenant_id = $1)
      GROUP BY p.id, m.numero
      ORDER BY p.criado_em DESC
    `, [tenantId || null]);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/pedidos/hoje:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/api/pedidos', authMiddleware, async (req, res) => {
  const { mesa_id, cliente_id, itens, observacoes } = req.body;
  if (!itens || !itens.length) return res.status(400).json({ erro: 'Pedido sem itens' });
  const tenantId = req.tenantId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Calcular total
    let total = 0;
    const itensDetalhes = [];
    for (const item of itens) {
      const pr = await client.query(
        `SELECT preco FROM produtos WHERE id=$1 AND disponivel=true AND ativo=true
         AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [item.produto_id, tenantId || null]
      );
      if (!pr.rows[0]) throw new Error(`Produto ${item.produto_id} não disponível`);
      const subtotal = pr.rows[0].preco * item.quantidade;
      total += subtotal;
      itensDetalhes.push({ ...item, preco_unitario: pr.rows[0].preco });
    }

    // Criar pedido
    const pedidoR = await client.query(
      `INSERT INTO pedidos (tenant_id, mesa_id, cliente_id, funcionario_id, total, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId || null, mesa_id || null, cliente_id || null, req.user.id, total, observacoes || null]
    );
    const pedido = pedidoR.rows[0];

    // Inserir itens
    for (const item of itensDetalhes) {
      await client.query(
        `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario, observacoes)
         VALUES ($1,$2,$3,$4,$5)`,
        [pedido.id, item.produto_id, item.quantidade, item.preco_unitario, item.observacoes || null]
      );
    }

    // Actualizar mesa
    if (mesa_id) {
      await client.query(`UPDATE mesas SET status='OCUPADA', ultima_atividade=NOW() WHERE id=$1`, [mesa_id]);
    }

    await client.query('COMMIT');

    const pedidoCompleto = await pool.query(`
      SELECT p.*, m.numero as mesa_numero,
             json_agg(json_build_object(
               'id', ip.id, 'produto_id', ip.produto_id, 'produto_nome', pr.nome,
               'quantidade', ip.quantidade, 'preco_unitario', ip.preco_unitario,
               'status_cozinha', ip.status_cozinha
             )) as itens
      FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
      LEFT JOIN produtos pr ON ip.produto_id = pr.id
      WHERE p.id = $1
      GROUP BY p.id, m.numero
    `, [pedido.id]);

    broadcast('novo_pedido', pedidoCompleto.rows[0], tenantId || null);
    res.status(201).json(pedidoCompleto.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ erro: e.message });
  } finally {
    client.release();
  }
});

app.patch('/api/pedidos/:id/status', authMiddleware, validarUUID('id'), async (req, res) => {
  const STATUSES_VALIDOS = ['ABERTO','EM_PREPARO','PRONTO','FECHADO','CANCELADO'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE pedidos SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND ($3::uuid IS NULL OR tenant_id = $3) RETURNING *`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Pedido não encontrado' });

    // Se fechado, libertar mesa
    if (status === 'FECHADO' && r.rows[0].mesa_id) {
      const outrosPedidos = await pool.query(
        `SELECT id FROM pedidos WHERE mesa_id=$1 AND status NOT IN ('FECHADO','CANCELADO') AND id != $2`,
        [r.rows[0].mesa_id, req.params.id]
      );
      if (!outrosPedidos.rows.length) {
        await pool.query(`UPDATE mesas SET status='LIVRE' WHERE id=$1`, [r.rows[0].mesa_id]);
      }
    }

    broadcast('pedido_atualizado', { id: req.params.id, status }, tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PATCH /api/pedidos/:id/status:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.patch('/api/pedidos/:pedidoId/itens/:itemId/status', authMiddleware, validarUUID('pedidoId'), validarUUID('itemId'), async (req, res) => {
  const { status_cozinha } = req.body;
  const STATUSES_COZINHA = ['PENDENTE', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO'];
  if (status_cozinha && !STATUSES_COZINHA.includes(status_cozinha)) {
    return res.status(400).json({ erro: 'status_cozinha inválido' });
  }
  const tenantId = req.tenantId;
  try {
    // Verificar que o pedido pertence ao tenant antes de actualizar o item
    const r = await pool.query(
      `UPDATE itens_pedido ip SET status_cozinha=$1
       FROM pedidos p
       WHERE ip.id=$2 AND ip.pedido_id=$3 AND p.id=ip.pedido_id
         AND ($4::uuid IS NULL OR p.tenant_id=$4)
       RETURNING ip.*`,
      [status_cozinha, req.params.itemId, req.params.pedidoId, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Item não encontrado' });
    broadcast('item_atualizado', r.rows[0], tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PATCH itens status:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Quartos ──────────────────────────────────────────────────
app.get('/api/quartos', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(`
      SELECT q.*,
        (SELECT json_agg(json_build_object('id',r.id,'checkin',r.checkin,'checkout',r.checkout,'status',r.status,'nome_hospede',r.nome_hospede,'fracao',r.fracao))
         FROM reservas r WHERE r.quarto_id = q.id AND r.status IN ('CONFIRMADA','CHECKIN')
         AND r.checkout > NOW()) as reservas_activas
      FROM quartos q
      WHERE ($1::uuid IS NULL OR q.tenant_id = $1)
      ORDER BY q.tipo, q.numero
    `, [tenantId || null]);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/quartos:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/api/quartos/reserva', authMiddleware, async (req, res) => {
  const { quarto_id, nome_hospede, fracao, checkin, checkout, cliente_id, observacoes } = req.body;
  if (!quarto_id || !fracao || !checkin || !checkout) {
    return res.status(400).json({ erro: 'Quarto, fracção, check-in e check-out são obrigatórios' });
  }
  const tenantId = req.tenantId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar disponibilidade (SELECT FOR UPDATE evita dupla reserva)
    const q = await client.query(
      `SELECT id, status, preco_2h, preco_pernoite, preco_diaria FROM quartos
       WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE NOWAIT`,
      [quarto_id, tenantId || null]
    );
    if (!q.rows[0]) throw new Error('Quarto não encontrado');

    // Verificar conflitos de reserva
    const conflito = await client.query(`
      SELECT id FROM reservas
      WHERE quarto_id=$1 AND status IN ('CONFIRMADA','CHECKIN')
      AND NOT (checkout <= $2 OR checkin >= $3)
    `, [quarto_id, checkin, checkout]);
    if (conflito.rows.length) throw new Error('Quarto já reservado neste período');

    // Calcular valor
    const precos = { DUAS_HORAS: q.rows[0].preco_2h, PERNOITE: q.rows[0].preco_pernoite, DIARIA: q.rows[0].preco_diaria };
    const valor_total = precos[fracao] || 0;

    // Criar reserva
    const r = await client.query(`
      INSERT INTO reservas (tenant_id, quarto_id, cliente_id, nome_hospede, fracao, checkin, checkout, valor_total, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [tenantId || null, quarto_id, cliente_id || null, nome_hospede || null, fracao, checkin, checkout, valor_total, observacoes || null]);

    // Actualizar status do quarto
    await client.query(`UPDATE quartos SET status='OCUPADO', atualizado_em=NOW() WHERE id=$1`, [quarto_id]);

    await client.query('COMMIT');
    broadcast('quarto_atualizado', { quarto_id, status: 'OCUPADO' }, tenantId || null);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ erro: e.message });
  } finally {
    client.release();
  }
});

app.patch('/api/reservas/:id/status', authMiddleware, validarUUID('id'), async (req, res) => {
  const STATUSES_VALIDOS = ['CONFIRMADA','CHECKIN','CHECKOUT','CANCELADA','NO_SHOW'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    // Verificar que a reserva pertence a um quarto do tenant
    const r = await pool.query(
      `UPDATE reservas rv SET status=$1, atualizado_em=NOW()
       FROM quartos q
       WHERE rv.id=$2 AND rv.quarto_id = q.id
         AND ($3::uuid IS NULL OR q.tenant_id = $3)
       RETURNING rv.*`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Reserva não encontrada' });

    if (['CHECKOUT', 'CANCELADA'].includes(status)) {
      const outrasReservas = await pool.query(
        `SELECT id FROM reservas WHERE quarto_id=$1 AND status IN ('CONFIRMADA','CHECKIN') AND id != $2`,
        [r.rows[0].quarto_id, req.params.id]
      );
      if (!outrasReservas.rows.length) {
        await pool.query(`UPDATE quartos SET status='LIMPEZA', atualizado_em=NOW() WHERE id=$1`, [r.rows[0].quarto_id]);
      }
    }

    broadcast('quarto_atualizado', { quarto_id: r.rows[0].quarto_id, status }, tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.patch('/api/quartos/:id/status', authMiddleware, validarUUID('id'), requerNivel(['ADMIN','GERENTE']), async (req, res) => {
  const STATUSES_VALIDOS = ['DISPONIVEL','OCUPADO','LIMPEZA','MANUTENCAO','BLOQUEADO'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `UPDATE quartos SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND ($3::uuid IS NULL OR tenant_id = $3) RETURNING *`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Quarto não encontrado' });
    broadcast('quarto_atualizado', { quarto_id: req.params.id, status }, tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── GET /api/reservas — listagem de reservas de quartos ──────
app.get('/api/reservas', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT r.*, q.numero as quarto_numero, q.tipo as quarto_tipo
       FROM reservas r
       LEFT JOIN quartos q ON q.id = r.quarto_id
       WHERE ($1::uuid IS NULL OR q.tenant_id = $1)
       ORDER BY r.criado_em DESC LIMIT 100`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/reservas:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── GET /api/solicitacoes-hospedagem — solicitações do portal cliente ──
app.get('/api/solicitacoes-hospedagem', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT s.*, c.nome as cliente_nome, c.telefone as cliente_telefone
       FROM solicitacoes_hospedagem s
       LEFT JOIN clientes c ON c.id = s.cliente_id
       WHERE ($1::uuid IS NULL OR c.tenant_id = $1 OR (s.cliente_id IS NULL AND $1 IS NULL))
       ORDER BY s.criado_em DESC LIMIT 100`,
      [tenantId || null]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/solicitacoes-hospedagem:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── PATCH /api/solicitacoes-hospedagem/:id/status ────────────
app.patch('/api/solicitacoes-hospedagem/:id/status', authMiddleware, validarUUID('id'), requerNivel(['ADMIN','GERENTE']), async (req, res) => {
  const STATUSES_VALIDOS = ['PENDENTE','CONFIRMADA','CANCELADA'];
  const { status } = req.body;
  if (!STATUSES_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
  const tenantId = req.tenantId;
  try {
    // Verificar isolamento tenant: solicitação deve pertencer a cliente do tenant
    const r = await pool.query(
      `UPDATE solicitacoes_hospedagem s SET status=$1, atualizado_em=NOW()
       FROM (
         SELECT sh.id FROM solicitacoes_hospedagem sh
         LEFT JOIN clientes c ON c.id = sh.cliente_id
         WHERE sh.id = $2
           AND ($3::uuid IS NULL OR c.tenant_id = $3 OR sh.cliente_id IS NULL)
       ) sub
       WHERE s.id = sub.id
       RETURNING s.*`,
      [status, req.params.id, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Solicitação não encontrada' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PATCH /api/solicitacoes-hospedagem/:id/status:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Stock ────────────────────────────────────────────────────
app.get('/api/stock', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(`
      SELECT s.*,
        CASE WHEN s.stock_atual <= s.stock_minimo THEN true ELSE false END as alerta_stock
      FROM stock_items s
      WHERE s.ativo = true AND ($1::uuid IS NULL OR s.tenant_id = $1)
      ORDER BY s.categoria, s.nome
    `, [tenantId || null]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/api/stock', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  const { nome, categoria, stock_atual, stock_minimo, stock_ideal, unidade, custo_unitario, fornecedor } = req.body;
  if (!nome || !categoria || !unidade) return res.status(400).json({ erro: 'Nome, categoria e unidade são obrigatórios' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `INSERT INTO stock_items (tenant_id, nome, categoria, stock_atual, stock_minimo, stock_ideal, unidade, custo_unitario, fornecedor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tenantId || null, nome, categoria, stock_atual || 0, stock_minimo || 0, stock_ideal || 0, unidade, custo_unitario || null, fornecedor || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('❌ Erro POST /api/stock:', e.message, e.detail || '');
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/api/stock/:id/movimento', authMiddleware, validarUUID('id'), async (req, res) => {
  const { tipo, quantidade, motivo } = req.body;
  const TIPOS_VALIDOS = ['VENDA','COMPRA','AJUSTE','DESPERDICIO','INVENTARIO'];
  if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo de movimento inválido' });
  if (!quantidade || isNaN(quantidade) || parseFloat(quantidade) === 0) return res.status(400).json({ erro: 'Quantidade inválida' });

  const tenantId = req.tenantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query(
      `SELECT stock_atual FROM stock_items WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2) FOR UPDATE`,
      [req.params.id, tenantId || null]
    );
    if (!s.rows[0]) throw new Error('Item não encontrado');

    const antes = parseFloat(s.rows[0].stock_atual);
    // COMPRA/INVENTARIO: sempre soma; VENDA/DESPERDICIO: sempre subtrai; AJUSTE: usa o sinal da quantidade
    let delta;
    if (tipo === 'COMPRA' || tipo === 'INVENTARIO') delta = Math.abs(quantidade);
    else if (tipo === 'VENDA' || tipo === 'DESPERDICIO') delta = -Math.abs(quantidade);
    else delta = parseFloat(quantidade); // AJUSTE: positivo ou negativo conforme enviado
    const depois = antes + delta;
    if (depois < 0) throw new Error('Stock insuficiente');

    await client.query(`UPDATE stock_items SET stock_atual=$1, atualizado_em=NOW() WHERE id=$2`, [depois, req.params.id]);
    const r = await client.query(
      `INSERT INTO movimentos_stock (stock_item_id, tipo, quantidade, quantidade_antes, motivo, operador_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, tipo, quantidade, antes, motivo || null, req.user.id]
    );

    await client.query('COMMIT');

    // Verificar alerta de stock
    const item = await pool.query(`SELECT * FROM stock_items WHERE id=$1`, [req.params.id]);
    if (parseFloat(item.rows[0].stock_atual) <= parseFloat(item.rows[0].stock_minimo)) {
      broadcast('alerta_stock', { item: item.rows[0], mensagem: `Stock baixo: ${item.rows[0].nome}` }, item.rows[0].tenant_id || null);
    }

    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ erro: e.message });
  } finally {
    client.release();
  }
});

// ── Financeiro ───────────────────────────────────────────────
app.get('/api/financeiro/resumo', authMiddleware, async (req, res) => {
  const { data } = req.query;
  // Validar formato e validade da data para prevenir injecção e erros de BD
  let dataFiltro = new Date().toISOString().split('T')[0];
  if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    const d = new Date(data + 'T00:00:00Z');
    if (!isNaN(d.getTime()) && d.toISOString().startsWith(data)) {
      dataFiltro = data;
    }
  }
  const tenantId = req.tenantId;
  try {
  const [vendas, porCategoria, porStatus, quartos] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total),0) as receita_total,
             COUNT(CASE WHEN status='FECHADO' THEN 1 END) as pedidos_fechados
      FROM pedidos WHERE criado_em::date = $1 AND ($2::uuid IS NULL OR tenant_id=$2)
    `, [dataFiltro, tenantId || null]),
    pool.query(`
      SELECT pr.categoria, COUNT(ip.id) as itens_vendidos, COALESCE(SUM(ip.quantidade * ip.preco_unitario),0) as total
      FROM itens_pedido ip
      JOIN produtos pr ON ip.produto_id = pr.id
      JOIN pedidos p ON ip.pedido_id = p.id
      WHERE p.criado_em::date = $1 AND p.status = 'FECHADO'
        AND ($2::uuid IS NULL OR p.tenant_id=$2)
      GROUP BY pr.categoria ORDER BY total DESC
    `, [dataFiltro, tenantId || null]),
    pool.query(`
      SELECT status, COUNT(*) as total, COALESCE(SUM(total),0) as valor
      FROM pedidos WHERE criado_em::date = $1 AND ($2::uuid IS NULL OR tenant_id=$2) GROUP BY status
    `, [dataFiltro, tenantId || null]),
    pool.query(`
      SELECT COUNT(*) as total_reservas, COALESCE(SUM(rv.valor_total),0) as receita_quartos
      FROM reservas rv JOIN quartos q ON rv.quarto_id=q.id
      WHERE rv.criado_em::date = $1 AND rv.status != 'CANCELADA'
        AND ($2::uuid IS NULL OR q.tenant_id=$2)
    `, [dataFiltro, tenantId || null]),
  ]);

  res.json({
    data: dataFiltro,
    pedidos: vendas.rows[0],
    por_categoria: porCategoria.rows,
    por_status: porStatus.rows,
    quartos: quartos.rows[0],
  });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.get('/api/financeiro/faturas', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(`
      SELECT f.*, c.nome as cliente_nome
      FROM faturas f LEFT JOIN clientes c ON f.cliente_id = c.id
      WHERE ($1::uuid IS NULL OR f.tenant_id = $1)
      ORDER BY f.emitida_em DESC LIMIT 100
    `, [tenantId || null]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/api/financeiro/faturas', authMiddleware, async (req, res) => {
  const { pedido_id, reserva_id, cliente_id, nif_cliente, nome_cliente } = req.body;
  const tenantId = req.tenantId;

  // Validar UUIDs fornecidos
  if (pedido_id && !isUUID(pedido_id)) return res.status(400).json({ erro: 'pedido_id inválido' });
  if (reserva_id && !isUUID(reserva_id)) return res.status(400).json({ erro: 'reserva_id inválido' });
  if (cliente_id && !isUUID(cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });

  try {
    // Calcular sequencial
    const ano = new Date().getFullYear();
    const seq = await pool.query(`SELECT COALESCE(MAX(sequencial),0)+1 as prox FROM faturas WHERE serie='FT' AND ano=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`, [ano, tenantId || null]);
    const sequencial = seq.rows[0].prox;
    const numero_fatura = `FT ${ano}/${String(sequencial).padStart(6, '0')}`;

    let total = 0;
    if (pedido_id) {
      // Verificar que o pedido pertence ao tenant
      const p = await pool.query(`SELECT total FROM pedidos WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`, [pedido_id, tenantId || null]);
      if (!p.rows[0]) return res.status(404).json({ erro: 'Pedido não encontrado' });
      total = parseFloat(p.rows[0].total || 0);
    } else if (reserva_id) {
      // Verificar que a reserva pertence ao tenant (via quarto)
      const rv = await pool.query(`
        SELECT rv.valor_total FROM reservas rv
        JOIN quartos q ON rv.quarto_id = q.id
        WHERE rv.id=$1 AND ($2::uuid IS NULL OR q.tenant_id=$2)
      `, [reserva_id, tenantId || null]);
      if (!rv.rows[0]) return res.status(404).json({ erro: 'Reserva não encontrada' });
      total = parseFloat(rv.rows[0].valor_total || 0);
    } else if (req.body.total_manual !== undefined) {
      total = parseFloat(req.body.total_manual) || 0;
      if (total <= 0) return res.status(400).json({ erro: 'total_manual deve ser positivo' });
    } else {
      return res.status(400).json({ erro: 'Fornecer pedido_id, reserva_id ou total_manual' });
    }

    const taxa_iva = 14;
    const total_sem_iva = total / (1 + taxa_iva / 100);
    const iva = total - total_sem_iva;
    const hash = require('crypto').createHash('sha256').update(`${numero_fatura}${total}${Date.now()}`).digest('hex');

    const r = await pool.query(`
      INSERT INTO faturas (tenant_id, pedido_id, reserva_id, cliente_id, serie, ano, sequencial, numero_fatura,
                           nif_cliente, nome_cliente, total_sem_iva, iva, total, taxa_iva, hash_assinatura)
      VALUES ($1,$2,$3,$4,'FT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
    `, [tenantId || null, pedido_id || null, reserva_id || null, cliente_id || null, ano, sequencial, numero_fatura,
        nif_cliente || null, nome_cliente || null, total_sem_iva.toFixed(2), iva.toFixed(2), total.toFixed(2), taxa_iva, hash]);

    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Clientes ──────────────────────────────────────────────────
app.get('/api/clientes', authMiddleware, async (req, res) => {
  const { q } = req.query;
  const tenantId = req.tenantId;
  try {
    let query = `SELECT id, nome, telefone, email, nivel_fidelizacao, saldo_carteira, criado_em
                 FROM clientes WHERE ativo=true AND ($1::uuid IS NULL OR tenant_id = $1)`;
    const vals = [tenantId || null];
    if (q) { query += ` AND (nome ILIKE $2 OR telefone ILIKE $2 OR email ILIKE $2)`; vals.push(`%${q}%`); }
    query += ` ORDER BY nome`;
    const r = await pool.query(query, vals);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/clientes:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/api/clientes', authMiddleware, async (req, res) => {
  const { nome, telefone, email, nif } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `INSERT INTO clientes (tenant_id, nome, telefone, email, nif) VALUES ($1,$2,$3,$4,$5) RETURNING id, nome, telefone, email`,
      [tenantId || null, nome, telefone || null, email || null, nif || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erro: 'Telefone ou email já registado' });
    console.error('❌ Erro POST /api/clientes:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Dashboard ─────────────────────────────────────────────────
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const [
      resumoHoje, mesasStatus, quartosStatus, stockAlertas,
      pedidosAbertos, topProdutos
    ] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total),0) as receita_hoje,
               COUNT(CASE WHEN status='FECHADO' THEN 1 END) as fechados
        FROM pedidos WHERE criado_em::date = CURRENT_DATE
          AND ($1::uuid IS NULL OR tenant_id = $1)
      `, [tenantId || null]),
      pool.query(`SELECT status, COUNT(*) as total FROM mesas WHERE ($1::uuid IS NULL OR tenant_id = $1) GROUP BY status`, [tenantId || null]),
      pool.query(`SELECT status, COUNT(*) as total FROM quartos WHERE ($1::uuid IS NULL OR tenant_id = $1) GROUP BY status`, [tenantId || null]),
      pool.query(`SELECT COUNT(*) as total FROM stock_items WHERE ativo=true AND stock_atual <= stock_minimo AND ($1::uuid IS NULL OR tenant_id=$1)`, [tenantId || null]),
      pool.query(`
        SELECT p.id, p.status, m.numero as mesa, p.total, p.criado_em,
               COUNT(ip.id) as num_itens
        FROM pedidos p
        LEFT JOIN mesas m ON p.mesa_id = m.id
        LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
        WHERE p.status IN ('ABERTO','EM_PREPARO','PRONTO')
          AND ($1::uuid IS NULL OR p.tenant_id = $1)
        GROUP BY p.id, m.numero
        ORDER BY p.criado_em ASC
      `, [tenantId || null]),
      pool.query(`
        SELECT pr.nome, pr.categoria, SUM(ip.quantidade) as total_vendido
        FROM itens_pedido ip
        JOIN produtos pr ON ip.produto_id = pr.id
        JOIN pedidos p ON ip.pedido_id = p.id
        WHERE p.criado_em::date = CURRENT_DATE AND p.status = 'FECHADO'
          AND ($1::uuid IS NULL OR p.tenant_id = $1)
        GROUP BY pr.id ORDER BY total_vendido DESC LIMIT 5
      `, [tenantId || null]),
    ]);

    res.json({
      resumo_hoje: resumoHoje.rows[0],
      mesas: mesasStatus.rows,
      quartos: quartosStatus.rows,
      alertas_stock: parseInt(stockAlertas.rows[0].total),
      pedidos_abertos: pedidosAbertos.rows,
      top_produtos: topProdutos.rows,
    });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Chamadas Staff ────────────────────────────────────────────
app.post('/api/chamadas', authMiddleware, async (req, res) => {
  const { mesa_id, motivo } = req.body;
  if (!mesa_id || !isUUID(mesa_id)) return res.status(400).json({ erro: 'mesa_id inválido' });
  const tenantId = req.tenantId;
  try {
    // Verificar que a mesa pertence ao tenant
    const mesa = await pool.query(
      `SELECT id FROM mesas WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`,
      [mesa_id, tenantId || null]
    );
    if (!mesa.rows[0]) return res.status(404).json({ erro: 'Mesa não encontrada' });
    const r = await pool.query(
      `INSERT INTO chamadas_staff (mesa_id, motivo) VALUES ($1,$2) RETURNING *`,
      [mesa_id, motivo || null]
    );
    broadcast('chamada_staff', { mesa_id, motivo, id: r.rows[0].id }, tenantId);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.patch('/api/chamadas/:id/atender', authMiddleware, validarUUID('id'), async (req, res) => {
  const tenantId = req.tenantId;
  try {
    // Verificar que a chamada pertence ao tenant (via mesa)
    const r = await pool.query(`
      UPDATE chamadas_staff cs SET funcionario_id=$1, atendido_em=NOW(),
      tempo_resposta_seg=EXTRACT(EPOCH FROM (NOW()-cs.solicitado_em))::INTEGER
      FROM mesas m
      WHERE cs.id=$2 AND cs.mesa_id = m.id
        AND ($3::uuid IS NULL OR m.tenant_id=$3)
      RETURNING cs.*
    `, [req.user.id, req.params.id, tenantId || null]);
    if (!r.rows[0]) return res.status(404).json({ erro: 'Chamada não encontrada' });
    broadcast('chamada_atendida', r.rows[0], tenantId);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ── Configurações ─────────────────────────────────────────────
app.get('/api/configuracoes', authMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT chave, valor, descricao FROM configuracoes
       WHERE ($1::uuid IS NULL OR tenant_id = $1) ORDER BY chave`,
      [tenantId || null]
    );
    const cfg = {};
    r.rows.forEach(row => { cfg[row.chave] = row.valor; });
    res.json(cfg);
  } catch (e) {
    console.error('GET /api/configuracoes:', e.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.put('/api/configuracoes', authMiddleware, requerNivel(['ADMIN']), async (req, res) => {
  // Whitelist de chaves permitidas para evitar injecção de configurações arbitrárias
  const CHAVES_PERMITIDAS = [
    'nome_estabelecimento', 'iva_padrao', 'moeda', 'timezone',
    'telefone', 'email_contato', 'morada', 'nif_empresa',
    'taxa_servico', 'stock_alerta_minimo', 'versao',
  ];
  const chavesDesconhecidas = Object.keys(req.body).filter(k => !CHAVES_PERMITIDAS.includes(k));
  if (chavesDesconhecidas.length > 0) {
    return res.status(400).json({ erro: `Chaves não permitidas: ${chavesDesconhecidas.join(', ')}` });
  }
  const tenantId = req.tenantId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [chave, valor] of Object.entries(req.body)) {
      await client.query(
        `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, chave) DO UPDATE SET valor=$3, atualizado_em=NOW()`,
        [tenantId || null, chave, String(valor)]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: e.message });
  } finally {
    client.release();
  }
});

// ════════════════════════════════════════════════════════════
// WebSocket
// ════════════════════════════════════════════════════════════

// Autenticação JWT na ligação WebSocket
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Não autenticado'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET_EFFECTIVE);
    next();
  } catch {
    next(new Error('Token inválido ou expirado'));
  }
});

io.on('connection', (socket) => {
  console.log(`🔌 WebSocket conectado: ${socket.id} (${socket.user?.email})`);

  // Entrar automaticamente na sala do tenant
  if (socket.user?.tenantId) {
    socket.join(`tenant:${socket.user.tenantId}`);
  }

  socket.on('join_room', (room) => {
    // Apenas permitir entrar em salas genéricas (não em salas de outros tenants)
    if (typeof room === 'string' && !room.startsWith('tenant:')) {
      socket.join(room);
    }
  });
  socket.on('leave_room', (room) => {
    if (typeof room === 'string' && !room.startsWith('tenant:')) {
      socket.leave(room);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Cliente WebSocket desconectado:', socket.id);
  });
});

// ════════════════════════════════════════════════════════════
// PORTAL DO CLIENTE — Rotas públicas (sem JWT)
// NOTA: deve ficar ANTES do SPA fallback (*) para não ser interceptado
// ════════════════════════════════════════════════════════════

// Rate limiter mais restritivo para rotas públicas
const clienteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: { erro: 'Demasiadas tentativas. Tente novamente em 10 minutos.' },
});

// ── GET /api/cliente/cardapio — lista produtos disponíveis ──
app.get('/api/cliente/cardapio', clienteLimiter, resolverTenantPublico, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, descricao, preco, categoria, disponivel
       FROM produtos
       WHERE disponivel = true AND ativo = true
         AND ($1::uuid IS NULL OR tenant_id = $1)
       ORDER BY categoria, nome`,
      [req.tenantId || null]
    );
    res.json({ produtos: r.rows });
  } catch (e) {
    console.error('cardapio:', e.message);
    res.status(500).json({ erro: 'Erro ao carregar cardápio' });
  }
});

// ── GET /api/cliente/eventos — informações de eventos ──
app.get('/api/cliente/eventos', clienteLimiter, resolverTenantPublico, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT chave, valor FROM configuracoes
       WHERE chave LIKE 'evento_%'
         AND ($1::uuid IS NULL OR tenant_id = $1)`,
      [req.tenantId || null]
    );
    const cfg = {};
    r.rows.forEach(row => { cfg[row.chave.replace('evento_', '')] = row.valor; });
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao carregar eventos' });
  }
});

// ── POST /api/cliente/login — identificação por telefone ──
app.post('/api/cliente/login', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const { telefone } = req.body;
  if (!telefone || !/^9[0-9]{8}$/.test(telefone.replace(/\s/g, ''))) {
    return res.status(400).json({ erro: 'Número de telefone inválido' });
  }
  try {
    const tel = telefone.replace(/\s/g, '');
    const r = await pool.query(
      `SELECT id, nome, telefone, provincia,
              pontos, nivel_fidelizacao,
              nukcoin_saldo, estrelas, criado_em
       FROM clientes
       WHERE telefone = $1 AND ativo = true
         AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [tel, req.tenantId || null]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ erro: 'Cliente não encontrado', nao_encontrado: true });
    }
    res.json({ cliente: r.rows[0] });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao autenticar cliente' });
  }
});

// ── POST /api/cliente/cadastrar — registo de novo cliente ──
app.post('/api/cliente/cadastrar', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const { nome, telefone, provincia, referido_por_tel } = req.body;
  if (!nome || nome.trim().length < 2) {
    return res.status(400).json({ erro: 'Nome obrigatório (mínimo 2 caracteres)' });
  }
  const tel = (telefone || '').replace(/\s/g, '');
  if (!/^9[0-9]{8}$/.test(tel)) {
    return res.status(400).json({ erro: 'Número de telefone inválido (formato 9XXXXXXXX)' });
  }
  const tenantId = req.tenantId;
  try {
    // Verificar se já existe neste tenant
    const ex = await pool.query(
      `SELECT id FROM clientes WHERE telefone = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [tel, tenantId || null]
    );
    if (ex.rows[0]) {
      return res.status(409).json({ erro: 'Número de telefone já cadastrado' });
    }

    // Resolver referral: encontrar UUID do cliente referenciador (mesmo tenant)
    let referidoPorId = null;
    if (referido_por_tel) {
      const telRef = referido_por_tel.replace(/\s/g, '');
      if (/^9[0-9]{8}$/.test(telRef)) {
        const ref = await pool.query(
          `SELECT id FROM clientes WHERE telefone = $1 AND ativo = true
           AND ($2::uuid IS NULL OR tenant_id = $2)`,
          [telRef, tenantId || null]
        );
        if (ref.rows[0]) referidoPorId = ref.rows[0].id;
      }
    }

    const novoId = uuidv4();
    const r = await pool.query(
      `INSERT INTO clientes (id, tenant_id, nome, telefone, provincia, pontos,
                             nivel_fidelizacao, nukcoin_saldo, estrelas, referido_por, ativo, criado_em)
       VALUES ($1, $2, $3, $4, $5, 50, 'BRONZE', 0, 0, $6, true, NOW())
       RETURNING id, nome, telefone, provincia, pontos,
                 nivel_fidelizacao, nukcoin_saldo, estrelas`,
      [novoId, tenantId || null, nome.trim(), tel, provincia || null, referidoPorId]
    );

    // Atribuir 1 estrela ao cliente que fez a referência
    if (referidoPorId) {
      await pool.query(
        `UPDATE clientes SET estrelas = estrelas + 1 WHERE id = $1`, [referidoPorId]
      );
      broadcast('estrela_referral', { cliente_id: referidoPorId, motivo: 'Referência de novo cliente' });
    }

    broadcast('cliente_novo', { nome: r.rows[0].nome });
    res.status(201).json({
      cliente: r.rows[0],
      mensagem: 'Cadastro realizado com sucesso! 🎉 Bónus de 50 pontos creditados.',
      referral_bonus: referidoPorId ? true : false,
    });
  } catch (e) {
    console.error('cadastrar cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao cadastrar cliente' });
  }
});

// ── POST /api/cliente/pedido-restaurante — pedido de mesa ──
app.post('/api/cliente/pedido-restaurante', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const { itens, mesa_ref, observacoes, cliente_id, metodo_pagamento } = req.body;
  if (!itens || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'Itens do pedido são obrigatórios' });
  }
  // Limitar número de itens por pedido para prevenir abuso
  if (itens.length > 50) {
    return res.status(400).json({ erro: 'Máximo de 50 itens por pedido' });
  }
  const METODOS = ['CASH', 'TPA', 'NUKCOIN', 'EXPRESS', 'TRANSFERENCIA'];
  const metodo = (metodo_pagamento || 'CASH').toUpperCase();
  if (!METODOS.includes(metodo)) {
    return res.status(400).json({ erro: `Método de pagamento inválido. Aceites: ${METODOS.join(', ')}` });
  }
  // Validar cliente_id se fornecido
  if (cliente_id && !isUUID(cliente_id)) {
    return res.status(400).json({ erro: 'cliente_id inválido' });
  }
  // Validar itens
  for (const item of itens) {
    if (!item.produto_id || !isUUID(item.produto_id)) {
      return res.status(400).json({ erro: 'produto_id inválido em item do pedido' });
    }
    if (!item.quantidade || !Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 100) {
      return res.status(400).json({ erro: 'Quantidade inválida (1-100 por item)' });
    }
  }
  const tenantId = req.tenantId;
  try {
    // Buscar configurações de desconto (do tenant)
    const cfgR = await pool.query(
      `SELECT chave, valor FROM configuracoes
       WHERE chave IN ('nukcoin_desconto_pct','estrelas_minimo_consumo','estrelas_para_desconto','desconto_estrelas_pct','desconto_estrelas_limite')
         AND ($1::uuid IS NULL OR tenant_id = $1)`,
      [tenantId || null]
    );
    const cfg = {};
    cfgR.rows.forEach(r => { cfg[r.chave] = parseFloat(r.valor); });

    // Calcular total buscando preços reais do BD (do tenant)
    let total = 0;
    const itensFull = [];
    for (const item of itens) {
      const p = await pool.query(
        `SELECT id, nome, preco FROM produtos WHERE id = $1 AND disponivel = true
         AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [item.produto_id, tenantId || null]
      );
      if (!p.rows[0]) continue;
      const subtotal = parseFloat(p.rows[0].preco) * item.quantidade;
      total += subtotal;
      itensFull.push({ produto_id: p.rows[0].id, nome: p.rows[0].nome, quantidade: item.quantidade, preco_unitario: parseFloat(p.rows[0].preco), subtotal });
    }
    if (itensFull.length === 0) {
      return res.status(400).json({ erro: 'Nenhum produto válido encontrado' });
    }

    let totalFinal = total;
    let descontoAplicado = 0;
    let estrelaGanha = false;
    let novoSaldoNukcoin = null;

    // Processar Nuk-Coin
    if (metodo === 'NUKCOIN' && cliente_id) {
      const clienteR = await pool.query(
        `SELECT nukcoin_saldo, estrelas FROM clientes WHERE id = $1 AND ativo = true
         AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [cliente_id, tenantId || null]
      );
      if (!clienteR.rows[0]) {
        return res.status(400).json({ erro: 'Cliente não encontrado para pagamento Nuk-Coin' });
      }
      const saldoAtual = parseFloat(clienteR.rows[0].nukcoin_saldo);

      // Aplicar desconto de estrelas se elegível
      const estrelasCliente = clienteR.rows[0].estrelas;
      const limite = cfg.desconto_estrelas_limite || 25000;
      if (estrelasCliente >= (cfg.estrelas_para_desconto || 5) && total <= limite) {
        const pct = cfg.desconto_estrelas_pct || 20;
        descontoAplicado = total * (pct / 100);
        totalFinal = total - descontoAplicado;
      } else {
        // Desconto padrão Nuk-Coin
        const pct = cfg.nukcoin_desconto_pct || 10;
        descontoAplicado = total * (pct / 100);
        totalFinal = total - descontoAplicado;
      }

      if (saldoAtual < totalFinal) {
        return res.status(400).json({
          erro: 'Saldo Nuk-Coin insuficiente',
          saldo_atual: saldoAtual,
          total_necessario: totalFinal,
        });
      }

      // Debitar saldo
      const novoSaldo = saldoAtual - totalFinal;
      await pool.query(
        `UPDATE clientes SET nukcoin_saldo = $1 WHERE id = $2`, [novoSaldo, cliente_id]
      );
      novoSaldoNukcoin = novoSaldo;

      // Registar movimento
      await pool.query(
        `INSERT INTO movimentos_nukcoin (id, cliente_id, tipo, valor, saldo_antes, saldo_depois, descricao, criado_em)
         VALUES ($1, $2, 'CONSUMO', $3, $4, $5, 'Pagamento pedido restaurante', NOW())`,
        [uuidv4(), cliente_id, totalFinal, saldoAtual, novoSaldo]
      );
    }

    // Determinar mesa_id (do tenant)
    let mesa_id = null;
    if (mesa_ref) {
      const m = await pool.query(
        `SELECT id FROM mesas WHERE numero = $1
         AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [mesa_ref, tenantId || null]
      );
      if (m.rows[0]) mesa_id = m.rows[0].id;
    }

    // Criar pedido
    const pedidoId = uuidv4();
    const codigo = 'P' + Date.now().toString().slice(-4);
    await pool.query(
      `INSERT INTO pedidos (id, tenant_id, mesa_id, cliente_id, status, total, observacoes, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, 'ABERTO', $5, $6, NOW(), NOW())`,
      [pedidoId, tenantId || null, mesa_id, cliente_id || null, totalFinal, observacoes || null]
    );

    // Inserir itens
    for (const item of itensFull) {
      await pool.query(
        `INSERT INTO itens_pedido (id, pedido_id, produto_id, quantidade, preco_unitario)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), pedidoId, item.produto_id, item.quantidade, item.preco_unitario]
      );
    }

    // Atribuir estrela se consumo >= mínimo (para clientes cadastrados)
    if (cliente_id && total >= (cfg.estrelas_minimo_consumo || 25000)) {
      await pool.query(
        `UPDATE clientes SET estrelas = estrelas + 1 WHERE id = $1`, [cliente_id]
      );
      estrelaGanha = true;
    }

    // Notificar staff em tempo real
    broadcast('novo_pedido_cliente', {
      pedido_id: pedidoId,
      codigo,
      mesa_ref: mesa_ref || null,
      itens: itensFull.map(i => `${i.quantidade}x ${i.nome}`),
      total: totalFinal,
      metodo_pagamento: metodo,
      fonte: 'PORTAL_CLIENTE',
    });

    res.status(201).json({
      codigo,
      pedido_id: pedidoId,
      total_bruto: total,
      desconto: descontoAplicado,
      total_final: totalFinal,
      metodo_pagamento: metodo,
      estrela_ganha: estrelaGanha,
      nukcoin_saldo_novo: novoSaldoNukcoin,
      mensagem: 'Pedido enviado com sucesso!',
    });
  } catch (e) {
    console.error('pedido-restaurante:', e.message);
    res.status(500).json({ erro: 'Erro ao registar pedido' });
  }
});

// ── POST /api/cliente/pedido-hospedagem — solicitação de quarto ──
app.post('/api/cliente/pedido-hospedagem', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const FRACOES_VALIDAS = ['DUAS_HORAS', 'PERNOITE', 'DIARIA'];
  const { fracao, quantidade, nome_hospede, telefone, observacoes, cliente_id } = req.body;
  if (!FRACOES_VALIDAS.includes(fracao)) {
    return res.status(400).json({ erro: `Fração inválida. Valores aceites: ${FRACOES_VALIDAS.join(', ')}` });
  }
  const qty = parseInt(quantidade) || 1;
  if (qty < 1 || qty > 20) {
    return res.status(400).json({ erro: 'Quantidade inválida (1-20)' });
  }
  try {
    const solicitacaoId = uuidv4();
    const codigo = 'H' + Date.now().toString().slice(-4);

    // Registar como solicitação pendente de confirmação
    await pool.query(
      `INSERT INTO solicitacoes_hospedagem (id, cliente_id, tipo_fracao, quantidade_quartos, status,
                            nome_responsavel, telefone_contacto, observacoes, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, 'PENDENTE', $5, $6, $7, NOW(), NOW())`,
      [solicitacaoId, cliente_id || null, fracao, qty,
       nome_hospede || null, telefone || null, observacoes || null]
    );

    // Notificar staff
    broadcast('nova_solicitacao_hospedagem', {
      id: solicitacaoId,
      codigo,
      fracao,
      quantidade: qty,
      nome_hospede: nome_hospede || 'Visitante',
      telefone: telefone || '—',
      fonte: 'PORTAL_CLIENTE',
    });

    res.status(201).json({ codigo, solicitacao_id: solicitacaoId, mensagem: 'Solicitação enviada! A nossa equipa entrará em contacto brevemente.' });
  } catch (e) {
    console.error('pedido-hospedagem:', e.message);
    res.status(500).json({ erro: 'Erro ao registar solicitação' });
  }
});

// ── GET /api/cliente/perfil — perfil completo por telefone ──
app.get('/api/cliente/perfil', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const tel = (req.query.tel || '').replace(/\s/g, '');
  if (!/^9[0-9]{8}$/.test(tel)) {
    return res.status(400).json({ erro: 'Telefone inválido' });
  }
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT id, nome, telefone, provincia,
              pontos, nivel_fidelizacao,
              nukcoin_saldo, estrelas, criado_em
       FROM clientes WHERE telefone = $1 AND ativo = true
         AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [tel, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });

    // Buscar configurações relevantes (do tenant)
    const cfgR = await pool.query(
      `SELECT chave, valor FROM configuracoes
       WHERE chave IN ('estrelas_para_desconto','desconto_estrelas_pct','desconto_estrelas_limite','nukcoin_desconto_pct')
         AND ($1::uuid IS NULL OR tenant_id = $1)`,
      [tenantId || null]
    );
    const cfg = {};
    cfgR.rows.forEach(row => { cfg[row.chave] = parseFloat(row.valor); });

    const cliente = r.rows[0];
    const estrelasParaDesconto = cfg.estrelas_para_desconto || 5;
    res.json({
      cliente,
      config: cfg,
      desconto_ativo: cliente.estrelas >= estrelasParaDesconto,
    });
  } catch (e) {
    console.error('perfil cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao carregar perfil' });
  }
});

// ── POST /api/cliente/nukcoin/carregar — carregar crédito Nuk-Coin ──
// Requer autenticação de operador (JWT) — endpoint protegido
app.post('/api/cliente/nukcoin/carregar', clienteLimiter, authMiddleware, async (req, res) => {
  const VALORES_VALIDOS = [5000, 10000, 15000, 20000, 25000, 50000];
  const { cliente_id, valor } = req.body;
  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id obrigatório' });
  if (!isUUID(cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  const valorNum = parseFloat(valor);
  if (!VALORES_VALIDOS.includes(valorNum)) {
    return res.status(400).json({ erro: `Valor inválido. Opções: ${VALORES_VALIDOS.join(', ')} Kz` });
  }
  const tenantId = req.tenantId;
  try {
    const clienteR = await pool.query(
      `SELECT id, nome, nukcoin_saldo FROM clientes
       WHERE id = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [cliente_id, tenantId || null]
    );
    if (!clienteR.rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });

    const saldoAntes = parseFloat(clienteR.rows[0].nukcoin_saldo);
    const saldoDepois = saldoAntes + valorNum;

    await pool.query(
      `UPDATE clientes SET nukcoin_saldo = $1 WHERE id = $2`, [saldoDepois, cliente_id]
    );
    await pool.query(
      `INSERT INTO movimentos_nukcoin (id, cliente_id, tipo, valor, saldo_antes, saldo_depois, descricao, criado_em)
       VALUES ($1, $2, 'CARREGAMENTO', $3, $4, $5, 'Carregamento Nuk-Coin', NOW())`,
      [uuidv4(), cliente_id, valorNum, saldoAntes, saldoDepois]
    );

    res.json({
      saldo_anterior: saldoAntes,
      valor_carregado: valorNum,
      saldo_atual: saldoDepois,
      mensagem: `✅ ${valorNum.toLocaleString('pt-AO')} Kz carregados com sucesso!`,
    });
  } catch (e) {
    console.error('nukcoin carregar:', e.message);
    res.status(500).json({ erro: 'Erro ao carregar Nuk-Coin' });
  }
});

// ── GET /api/cliente/nukcoin/historico — histórico de movimentos ──
app.get('/api/cliente/nukcoin/historico', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const { cliente_id } = req.query;
  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id obrigatório' });
  if (!isUUID(cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  const tenantId = req.tenantId;
  try {
    // Verificar que o cliente pertence a este tenant
    const clienteCheck = await pool.query(
      `SELECT id FROM clientes WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [cliente_id, tenantId || null]
    );
    if (!clienteCheck.rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });

    const r = await pool.query(
      `SELECT tipo, valor, saldo_antes, saldo_depois, descricao, criado_em
       FROM movimentos_nukcoin
       WHERE cliente_id = $1
       ORDER BY criado_em DESC
       LIMIT 20`,
      [cliente_id]
    );
    res.json({ movimentos: r.rows });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao carregar histórico' });
  }
});

// ── GET /api/qrcode — retorna SVG do QR code do portal ──
app.get('/api/qrcode', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL ||
      `${req.protocol}://${req.get('host')}`;
    const portalUrl = `${baseUrl}/cliente`;

    // Gerar QR code como SVG usando qrcode puro (algoritmo embutido)
    // Usamos a lib qrcode se disponível, senão retornamos apenas a URL
    let qrSvg = null;
    try {
      const QRCode = require('qrcode');
      qrSvg = await QRCode.toString(portalUrl, { type: 'svg', width: 300, margin: 2 });
    } catch {
      // qrcode não instalado — retorna URL para o cliente gerar o QR
    }

    res.json({ url: portalUrl, qr_svg: qrSvg });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao gerar QR code' });
  }
});

// ════════════════════════════════════════════════════════════
// SPA fallback (frontend) — deve ficar DEPOIS de todas as rotas /api/
// ════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada' });
  // Portal do cliente
  if (req.path === '/cliente' || req.path === '/cliente/') {
    return res.sendFile(path.join(__dirname, '..', 'public', 'cliente.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ════════════════════════════════════════════════════════════
// Erro global — captura erros via next(err) ou throw em async handlers
// ════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('❌ Erro global:', err.message, err.detail || '', err.code || '');
  if (res.headersSent) return;
  // Erros conhecidos do PostgreSQL
  if (err.code === '23505') return res.status(409).json({ erro: 'Registo duplicado' });
  if (err.code === '23514') return res.status(400).json({ erro: 'Valor inválido (constraint violada)' });
  if (err.code === '23503') return res.status(400).json({ erro: 'Referência inválida' });
  // Erros de JWT
  if (err.name === 'JsonWebTokenError') return res.status(401).json({ erro: 'Token inválido' });
  if (err.name === 'TokenExpiredError') return res.status(401).json({ erro: 'Token expirado' });
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ════════════════════════════════════════════════════════════
// Arranque
// ════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

// Arrancar o servidor imediatamente — a BD inicializa em background
// para que o health check do Render passe mesmo que a BD demore a ligar
server.listen(PORT, () => {
  console.log(`🚀 Nuk_POS v1.0 a correr na porta ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  A inicializar base de dados...`);

  initDB()
    .then(() => {
      console.log('✅ Base de dados pronta');
    })
    .catch((err) => {
      console.error('❌ Falha ao inicializar base de dados:', err.message);
      console.error('⚠️  O servidor continua a correr — verifique DATABASE_URL nas variáveis de ambiente');
      // Não terminar o processo — o servidor responde ao health check
      // A BD pode ficar disponível mais tarde (ex: PostgreSQL ainda a arrancar)
    });
});
