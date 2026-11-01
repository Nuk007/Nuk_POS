// Nuk_POS — Módulo SaaS Multi-Tenant
// Superadmin: gestão de tenants e licenças
// Activação: link via WhatsApp (Meta Cloud API, com fallback manual wa.me)
// Isolamento: tenant_id injectado em todas as operações

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { saasLimiter } = require('./middleware/rateLimiters');

const router = express.Router();

// ──────────────────────────────────────────────────────────────
// WhatsApp Business Cloud API (Meta) — mesmo padrão do AviationMoney
// Decisão de 01/11/2026 (pedido do dono): o Twilio nunca chegou a ser configurado em produção —
// o botão "Reenviar link" dizia sempre "enviado com sucesso" sem nada ter saído. Substituído pela
// API oficial do WhatsApp Business da Meta, com o mesmo padrão já em uso no AviationMoney:
// WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID activam o envio automático por modelo (template,
// a aprovar no WhatsApp Manager); sem as duas, ou se a chamada falhar, cai-se sempre para um link
// manual wa.me (abre o WhatsApp já com a mensagem escrita) — nunca bloqueia a criação/activação.
// ──────────────────────────────────────────────────────────────
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const whatsappConfigurado = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

async function enviarWhatsAppTemplate(telefone, template, parametrosCorpo) {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: telefone, type: 'template',
      template: { name: template, language: { code: 'pt_PT' }, components: [{ type: 'body', parameters: parametrosCorpo.map(texto => ({ type: 'text', text: texto })) }] },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Falha ao enviar WhatsApp (HTTP ${r.status}).`);
  return j;
}

function textoActivacao(nomeEmpresa, link) {
  return `Nuk_POS: a licença para ${nomeEmpresa} foi gerada. Para activar o seu sistema, abra este link: ${link} (uso único, guarde-o em lugar seguro).`;
}

// Link "clicar para conversar" — funciona sempre, sem conta nem credenciais: abre o WhatsApp do
// destinatário já com a mensagem escrita, para enviar à mão quando a Cloud API não está disponível.
function linkManualWhatsApp(telefone, texto) {
  const tel = String(telefone || '').replace(/\D/g, '');
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
}

// ──────────────────────────────────────────────────────────────
// MIDDLEWARE DE AUTENTICAÇÃO DO SUPERADMIN
// Chave separada do JWT dos tenants — definida em SUPERADMIN_KEY
// ──────────────────────────────────────────────────────────────
function superAdminAuth(req, res, next) {
  // Aceitar apenas via header — nunca via query string (apareceria nos logs do servidor)
  const key = req.headers['x-superadmin-key'];
  const SUPER_KEY = process.env.SUPERADMIN_KEY;
  if (!SUPER_KEY) {
    return res.status(503).json({ erro: 'Serviço indisponível' });
  }
  if (!key) {
    return res.status(401).json({ erro: 'Autenticação obrigatória' });
  }
  // Comparação timing-safe para prevenir ataques de temporização
  try {
    const keyBuf = Buffer.from(key);
    const secretBuf = Buffer.from(SUPER_KEY);
    if (keyBuf.length !== secretBuf.length || !crypto.timingSafeEqual(keyBuf, secretBuf)) {
      return res.status(401).json({ erro: 'Chave inválida' });
    }
  } catch {
    return res.status(401).json({ erro: 'Chave inválida' });
  }
  next();
}

// ──────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ──────────────────────────────────────────────────────────────
function gerarLicenseKey() {
  // Formato: NUKP-XXXX-XXXX-XXXX  (fácil de ler, difícil de adivinhar)
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `NUKP-${seg()}-${seg()}-${seg()}`;
}

function gerarSlug(nome) {
  return nome
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

async function slugUnico(base) {
  let slug = base;
  let i = 1;
  while (true) {
    const r = await pool.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    if (r.rows.length === 0) return slug;
    slug = `${base}-${i++}`;
  }
}

// Tenta enviar a activação pela Cloud API; lança sempre que não estiver configurada ou a chamada
// falhar — quem chama decide o que fazer a seguir (ver linkManualWhatsApp acima, usado nos 3
// pontos que geram/reenviam uma activação).
async function enviarWhatsAppActivacao(telefone, nomeEmpresa, licenseKey, baseUrl) {
  if (!whatsappConfigurado()) throw new Error('WhatsApp não configurado (WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID em falta)');
  const link = `${baseUrl}/activate/${licenseKey}`;
  await enviarWhatsAppTemplate(
    telefone.replace(/\D/g, ''),
    process.env.WHATSAPP_TEMPLATE_ACTIVACAO || 'activacao_tenant',
    [nomeEmpresa, link]
  );
  return link;
}

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — DASHBOARD / MÉTRICAS GLOBAIS
// GET /api/saas/dashboard
// ──────────────────────────────────────────────────────────────
router.get('/dashboard', superAdminAuth, async (req, res) => {
  try {
    const [totais, porEstado, expiramBreve, planos] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(*) FILTER (WHERE estado = 'ACTIVA')        AS activas,
          COUNT(*) FILTER (WHERE estado = 'PENDENTE')      AS pendentes,
          COUNT(*) FILTER (WHERE estado = 'SUSPENSA')      AS suspensas,
          COUNT(*) FILTER (WHERE estado = 'EXPIRADA')      AS expiradas
        FROM tenants
      `),
      pool.query(`
        SELECT estado, COUNT(*) AS qtd
        FROM tenants
        GROUP BY estado ORDER BY qtd DESC
      `),
      pool.query(`
        SELECT t.id, t.nome, t.slug, t.telefone_whatsapp, l.fim
        FROM tenants t
        JOIN licencas l ON l.tenant_id = t.id AND l.estado = 'ACTIVA'
        WHERE l.fim BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        ORDER BY l.fim ASC
        LIMIT 10
      `),
      pool.query(`
        SELECT p.nome, COUNT(t.id) AS tenants
        FROM planos_assinatura p
        LEFT JOIN tenants t ON t.plano_id = p.id AND t.estado = 'ACTIVA'
        GROUP BY p.nome ORDER BY tenants DESC
      `),
    ]);

    res.json({
      resumo: totais.rows[0],
      por_estado: porEstado.rows,
      expiram_em_7_dias: expiramBreve.rows,
      por_plano: planos.rows,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — LISTAR PLANOS
// GET /api/saas/planos
// ──────────────────────────────────────────────────────────────
router.get('/planos', superAdminAuth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM planos_assinatura ORDER BY preco_mensal ASC`);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — ACTUALIZAR PLANO
// PUT /api/saas/planos/:id
// ──────────────────────────────────────────────────────────────
router.put('/planos/:id', superAdminAuth, async (req, res) => {
  const { nome, descricao, max_funcionarios, max_produtos, max_mesas, preco_mensal, preco_anual, ativo } = req.body;
  try {
    await pool.query(`
      UPDATE planos_assinatura
      SET nome=$1, descricao=$2, max_funcionarios=$3, max_produtos=$4,
          max_mesas=$5, preco_mensal=$6, preco_anual=$7, ativo=$8
      WHERE id = $9
    `, [nome, descricao, max_funcionarios, max_produtos, max_mesas, preco_mensal, preco_anual, ativo, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — LISTAR TENANTS
// GET /api/saas/tenants?estado=ACTIVA&q=hotel
// ──────────────────────────────────────────────────────────────
router.get('/tenants', superAdminAuth, async (req, res) => {
  const { estado, q, page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  let where = ['1=1'];
  let params = [];
  let i = 1;

  if (estado) { where.push(`t.estado = $${i++}`); params.push(estado); }
  if (q) {
    where.push(`(t.nome ILIKE $${i} OR t.slug ILIKE $${i} OR t.telefone_whatsapp ILIKE $${i})`);
    params.push(`%${q}%`); i++;
  }

  try {
    const total = await pool.query(
      `SELECT COUNT(*) FROM tenants t WHERE ${where.join(' AND ')}`, params
    );
    const rows = await pool.query(`
      SELECT t.*, p.nome AS plano_nome, p.preco_mensal,
             l.estado AS licenca_estado, l.fim AS licenca_fim
      FROM tenants t
      LEFT JOIN planos_assinatura p ON p.id = t.plano_id
      LEFT JOIN licencas l ON l.tenant_id = t.id AND l.estado = 'ACTIVA'
      WHERE ${where.join(' AND ')}
      ORDER BY t.criado_em DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]);

    res.json({
      tenants: rows.rows,
      total: parseInt(total.rows[0].count),
      pagina: parseInt(page),
      paginas: Math.ceil(parseInt(total.rows[0].count) / limit),
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — CRIAR TENANT + GERAR LICENÇA + ENVIAR WHATSAPP
// POST /api/saas/tenants
// Body: { nome, telefone_whatsapp, email, nif, plano_nome, duracao_dias, notas }
// ──────────────────────────────────────────────────────────────
router.post('/tenants', saasLimiter, superAdminAuth, async (req, res) => {
  const {
    nome,
    telefone_whatsapp,
    email = '',
    nif = '',
    plano_nome = 'PRO',
    duracao_dias = 30,
    notas = '',
  } = req.body;

  if (!nome || !telefone_whatsapp) {
    return res.status(400).json({ erro: 'nome e telefone_whatsapp são obrigatórios' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Buscar plano
    const planoR = await client.query(
      `SELECT id FROM planos_assinatura WHERE nome = $1 AND ativo = true`, [plano_nome]
    );
    if (planoR.rows.length === 0) {
      throw new Error(`Plano "${plano_nome}" não encontrado`);
    }
    const planoId = planoR.rows[0].id;

    // Criar tenant
    const slug = await slugUnico(gerarSlug(nome));
    const tenantR = await client.query(`
      INSERT INTO tenants (nome, nif, telefone_whatsapp, email, plano_id, estado, slug)
      VALUES ($1, $2, $3, $4, $5, 'PENDENTE', $6)
      RETURNING id, slug
    `, [nome, nif, telefone_whatsapp, email, planoId, slug]);
    const tenantId = tenantR.rows[0].id;

    // Gerar licença
    const licenseKey = gerarLicenseKey();
    await client.query(`
      INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, estado, notas)
      VALUES ($1, $2, $3, $4, 'PENDENTE', $5)
    `, [tenantId, licenseKey, planoId, duracao_dias, notas]);

    await client.query('COMMIT');

    // Enviar WhatsApp (fora da transacção — falha não reverte o tenant)
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const activationLink = `${baseUrl}/activate/${licenseKey}`;
    let whatsappEnviado = false;
    let whatsappManual = null;

    try {
      await enviarWhatsAppActivacao(telefone_whatsapp, nome, licenseKey, baseUrl);
      await pool.query(
        `UPDATE licencas SET whatsapp_enviado_em = NOW() WHERE license_key = $1`, [licenseKey]
      );
      whatsappEnviado = true;
    } catch (wErr) {
      console.warn(`⚠️  WhatsApp não enviado para ${telefone_whatsapp}: ${wErr.message}`);
      whatsappManual = linkManualWhatsApp(telefone_whatsapp, textoActivacao(nome, activationLink));
    }

    res.status(201).json({
      ok: true,
      tenant_id: tenantId,
      slug,
      license_key: licenseKey,
      activation_link: activationLink,
      whatsapp_enviado: whatsappEnviado,
      whatsapp_manual: whatsappManual,
      aviso: whatsappEnviado ? null : 'WhatsApp não enviado — use o link manual para enviar à mão',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: 'Erro interno do servidor' });
  } finally {
    client.release();
  }
});

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — DETALHES DE UM TENANT
// GET /api/saas/tenants/:id
// ──────────────────────────────────────────────────────────────
router.get('/tenants/:id', superAdminAuth, async (req, res) => {
  try {
    const tenant = await pool.query(`
      SELECT t.*, p.nome AS plano_nome, p.max_funcionarios, p.max_produtos, p.preco_mensal
      FROM tenants t
      LEFT JOIN planos_assinatura p ON p.id = t.plano_id
      WHERE t.id = $1
    `, [req.params.id]);

    if (tenant.rows.length === 0) return res.status(404).json({ erro: 'Tenant não encontrado' });

    const licencas = await pool.query(
      `SELECT * FROM licencas WHERE tenant_id = $1 ORDER BY criado_em DESC`, [req.params.id]
    );

    // Estatísticas do tenant
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM funcionarios WHERE tenant_id = $1) AS funcionarios,
        (SELECT COUNT(*) FROM produtos WHERE tenant_id = $1 AND ativo = true) AS produtos,
        (SELECT COUNT(*) FROM clientes WHERE tenant_id = $1) AS clientes,
        (SELECT COUNT(*) FROM pedidos WHERE tenant_id = $1 AND criado_em > NOW() - INTERVAL '30 days') AS pedidos_30d,
        (SELECT COALESCE(SUM(total),0) FROM pedidos WHERE tenant_id = $1 AND criado_em > NOW() - INTERVAL '30 days') AS receita_30d
    `, [req.params.id]);

    res.json({ ...tenant.rows[0], licencas: licencas.rows, stats: stats.rows[0] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — MUDAR ESTADO DE TENANT
// PATCH /api/saas/tenants/:id/estado
// Body: { estado: 'ACTIVA' | 'SUSPENSA' | 'CANCELADA' }
// ──────────────────────────────────────────────────────────────
router.patch('/tenants/:id/estado', superAdminAuth, async (req, res) => {
  const { estado } = req.body;
  const VALIDOS = ['ACTIVA', 'SUSPENSA', 'CANCELADA', 'EXPIRADA'];
  if (!VALIDOS.includes(estado)) return res.status(400).json({ erro: 'Estado inválido' });

  try {
    await pool.query(
      `UPDATE tenants SET estado = $1, atualizado_em = NOW() WHERE id = $2`,
      [estado, req.params.id]
    );
    res.json({ ok: true, estado });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — REENVIAR LINK DE ACTIVAÇÃO VIA WHATSAPP
// POST /api/saas/licencas/:key/reenviar
// ──────────────────────────────────────────────────────────────
router.post('/licencas/:key/reenviar', superAdminAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT l.*, t.nome AS tenant_nome, t.telefone_whatsapp
      FROM licencas l
      JOIN tenants t ON t.id = l.tenant_id
      WHERE l.license_key = $1
    `, [req.params.key]);

    if (r.rows.length === 0) return res.status(404).json({ erro: 'Licença não encontrada' });
    const lic = r.rows[0];

    if (lic.estado === 'ACTIVA') {
      return res.status(400).json({ erro: 'Licença já activada — reenvio não necessário' });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${baseUrl}/activate/${lic.license_key}`;
    let whatsappEnviado = false;
    let whatsappManual = null;

    // Falha do WhatsApp não pode rebentar o pedido — ao contrário de POST /tenants e
    // POST /tenants/:id/renovar (que já tratavam isto), esta rota deixava a excepção subir até
    // ao catch geral e devolvia sempre 500 "Erro interno do servidor", mesmo com a licença válida
    // e o link bom (descoberto em 01/11/2026: reenviar sem WhatsApp configurado rebentava sempre).
    try {
      await enviarWhatsAppActivacao(lic.telefone_whatsapp, lic.tenant_nome, lic.license_key, baseUrl);
      await pool.query(`UPDATE licencas SET whatsapp_enviado_em = NOW() WHERE license_key = $1`, [req.params.key]);
      whatsappEnviado = true;
    } catch (wErr) {
      console.warn(`⚠️  WhatsApp não reenviado para ${lic.telefone_whatsapp}: ${wErr.message}`);
      whatsappManual = linkManualWhatsApp(lic.telefone_whatsapp, textoActivacao(lic.tenant_nome, link));
    }

    res.json({
      ok: true,
      link,
      whatsapp_enviado: whatsappEnviado,
      whatsapp_manual: whatsappManual,
      aviso: whatsappEnviado ? null : 'WhatsApp não enviado — envie o link manualmente',
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// SUPERADMIN — GERAR NOVA LICENÇA PARA TENANT EXISTENTE (renovação)
// POST /api/saas/tenants/:id/renovar
// Body: { duracao_dias, plano_nome }
// ──────────────────────────────────────────────────────────────
router.post('/tenants/:id/renovar', superAdminAuth, async (req, res) => {
  const { duracao_dias = 30, plano_nome, notas = 'Renovação' } = req.body;
  try {
    const tenant = await pool.query(`SELECT * FROM tenants WHERE id = $1`, [req.params.id]);
    if (tenant.rows.length === 0) return res.status(404).json({ erro: 'Tenant não encontrado' });

    let planoId = tenant.rows[0].plano_id;
    if (plano_nome) {
      const p = await pool.query(`SELECT id FROM planos_assinatura WHERE nome = $1`, [plano_nome]);
      if (p.rows.length > 0) planoId = p.rows[0].id;
    }

    const licenseKey = gerarLicenseKey();
    await pool.query(`
      INSERT INTO licencas (tenant_id, license_key, plano_id, duracao_dias, estado, notas)
      VALUES ($1, $2, $3, $4, 'PENDENTE', $5)
    `, [req.params.id, licenseKey, planoId, duracao_dias, notas]);

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    let whatsappEnviado = false;
    let whatsappManual = null;
    const activationLink = `${baseUrl}/activate/${licenseKey}`;

    try {
      await enviarWhatsAppActivacao(tenant.rows[0].telefone_whatsapp, tenant.rows[0].nome, licenseKey, baseUrl);
      await pool.query(`UPDATE licencas SET whatsapp_enviado_em = NOW() WHERE license_key = $1`, [licenseKey]);
      whatsappEnviado = true;
    } catch (e) {
      console.warn('WhatsApp não enviado:', e.message);
      whatsappManual = linkManualWhatsApp(tenant.rows[0].telefone_whatsapp, textoActivacao(tenant.rows[0].nome, activationLink));
    }

    res.json({
      ok: true,
      license_key: licenseKey,
      activation_link: activationLink,
      whatsapp_enviado: whatsappEnviado,
      whatsapp_manual: whatsappManual,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// PÚBLICO — VERIFICAR LICENÇA (pré-activação)
// GET /api/saas/activate/:key
// ──────────────────────────────────────────────────────────────
router.get('/activate/:key', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT l.*, t.nome AS tenant_nome, t.slug, t.email AS tenant_email,
             p.nome AS plano_nome, p.max_funcionarios, p.max_produtos, p.preco_mensal
      FROM licencas l
      JOIN tenants t ON t.id = l.tenant_id
      JOIN planos_assinatura p ON p.id = l.plano_id
      WHERE l.license_key = $1
    `, [req.params.key]);

    if (r.rows.length === 0) {
      return res.status(404).json({ erro: 'Licença não encontrada ou inválida' });
    }

    const lic = r.rows[0];

    if (lic.estado === 'ACTIVA') {
      return res.status(409).json({
        erro: 'Licença já activada',
        activada_em: lic.activado_em,
        tenant: lic.tenant_nome,
        slug: lic.slug,
      });
    }

    if (lic.estado === 'REVOGADA') {
      return res.status(403).json({ erro: 'Esta licença foi revogada. Contacte o suporte.' });
    }

    res.json({
      valida: true,
      tenant_nome: lic.tenant_nome,
      plano: lic.plano_nome,
      max_funcionarios: lic.max_funcionarios,
      max_produtos: lic.max_produtos,
      duracao_dias: lic.duracao_dias,
      preco_mensal: lic.preco_mensal,
      estado: lic.estado,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ──────────────────────────────────────────────────────────────
// PÚBLICO — CONFIRMAR ACTIVAÇÃO DA LICENÇA
// POST /api/saas/activate/:key/confirmar
// Body: { nome_admin, telefone_admin, email_admin, password }
// ──────────────────────────────────────────────────────────────
router.post('/activate/:key/confirmar', async (req, res) => {
  const { nome_admin, telefone_admin, email_admin, password } = req.body;

  if (!nome_admin || !password || password.length < 8) {
    return res.status(400).json({ erro: 'Nome e password (mínimo 8 caracteres) são obrigatórios' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar licença
    const licR = await client.query(`
      SELECT l.*, t.nome AS tenant_nome, t.slug, p.nome AS plano_nome
      FROM licencas l
      JOIN tenants t ON t.id = l.tenant_id
      JOIN planos_assinatura p ON p.id = l.plano_id
      WHERE l.license_key = $1 FOR UPDATE
    `, [req.params.key]);

    if (licR.rows.length === 0) {
      throw new Error('Licença inválida');
    }
    const lic = licR.rows[0];

    if (lic.estado !== 'PENDENTE') {
      throw new Error(`Licença já foi ${lic.estado.toLowerCase()}`);
    }

    const agora = new Date();
    const fim = new Date(agora.getTime() + lic.duracao_dias * 24 * 60 * 60 * 1000);

    // Activar licença
    await client.query(`
      UPDATE licencas
      SET estado = 'ACTIVA', inicio = $1, fim = $2,
          activado_em = $1, activado_por_ip = $3
      WHERE license_key = $4
    `, [agora, fim, req.ip, req.params.key]);

    // Activar tenant
    await client.query(`
      UPDATE tenants SET estado = 'ACTIVA', atualizado_em = NOW() WHERE id = $1
    `, [lic.tenant_id]);

    // Criar admin do tenant
    const hash = await bcrypt.hash(password, 12);
    const emailAdmin = email_admin || `admin@${lic.slug}.nukpos.ao`;

    await client.query(`
      INSERT INTO funcionarios (tenant_id, nome, email, password_hash, cargo, nivel_acesso)
      VALUES ($1, $2, $3, $4, 'Administrador', 'ADMIN')
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = $4
    `, [lic.tenant_id, nome_admin, emailAdmin, hash]);

    // Configurações iniciais do tenant (se ainda não existirem)
    const configsBase = [
      ['nome_estabelecimento', lic.tenant_nome],
      ['iva_padrao', '14'],
      ['moeda', 'Kz'],
      ['timezone', 'Africa/Luanda'],
      ['versao', '2.0.0'],
      ['nukcoin_desconto_pct', '10'],
      ['estrelas_minimo_consumo', '25000'],
      ['estrelas_para_desconto', '5'],
      ['desconto_estrelas_pct', '20'],
      ['desconto_estrelas_limite', '25000'],
      ['pontos_boas_vindas', '50'],
      ['portal_url', ''],
    ];
    for (const [chave, valor] of configsBase) {
      await client.query(`
        INSERT INTO configuracoes (tenant_id, chave, valor)
        VALUES ($1, $2, $3) ON CONFLICT (tenant_id, chave) DO NOTHING
      `, [lic.tenant_id, chave, valor]);
    }

    await client.query('COMMIT');

    // Enviar WhatsApp de boas-vindas (melhor-esforço — a activação já está feita e confirmada
    // na resposta abaixo, independentemente de esta mensagem sair ou não).
    const telNotif = telefone_admin || null;
    if (telNotif && whatsappConfigurado()) {
      try {
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        await enviarWhatsAppTemplate(
          telNotif.replace(/\D/g, ''),
          process.env.WHATSAPP_TEMPLATE_BOAS_VINDAS || 'boas_vindas_tenant',
          [lic.tenant_nome, lic.plano_nome, fim.toLocaleDateString('pt-PT'), `${baseUrl}/`, emailAdmin]
        );
      } catch (e) {
        console.warn('WhatsApp boas-vindas não enviado:', e.message);
      }
    }

    res.json({
      ok: true,
      mensagem: 'Licença activada com sucesso!',
      tenant: lic.tenant_nome,
      plano: lic.plano_nome,
      email_admin: emailAdmin,
      valido_ate: fim.toLocaleDateString('pt-PT'),
      slug: lic.slug,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Activação licença:', err.message);
    // Erros de validação (ex: campo obrigatório) são repassados; erros de DB são genéricos
    const isValidationError = ['obrigatório','inválid','não encontrad','expirada','já activa'].some(s => err.message.toLowerCase().includes(s));
    res.status(400).json({ erro: isValidationError ? err.message : 'Erro ao activar licença' });
  } finally {
    client.release();
  }
});

// ──────────────────────────────────────────────────────────────
// MIDDLEWARE: verificar se tenant tem licença activa
// Exportado para uso em app.js
// ──────────────────────────────────────────────────────────────
async function verificarLicencaTenant(req, res, next) {
  const tenantId = req.tenantId;
  if (!tenantId) return next(); // rotas sem tenant passam (superadmin, activate, etc.)

  try {
    const r = await pool.query(`
      SELECT l.fim, t.estado
      FROM tenants t
      LEFT JOIN licencas l ON l.tenant_id = t.id AND l.estado = 'ACTIVA'
      WHERE t.id = $1
    `, [tenantId]);

    if (r.rows.length === 0) {
      return res.status(404).json({ erro: 'Tenant não encontrado' });
    }

    const { estado, fim } = r.rows[0];

    if (estado === 'SUSPENSA') {
      return res.status(403).json({
        erro: 'Conta suspensa. Contacte o suporte Nuk_POS.',
        codigo: 'TENANT_SUSPENSA',
      });
    }

    if (estado === 'EXPIRADA' || (fim && new Date(fim) < new Date())) {
      // Marcar como expirada se passou o prazo
      if (fim && new Date(fim) < new Date()) {
        await pool.query(
          `UPDATE tenants SET estado='EXPIRADA' WHERE id=$1 AND estado='ACTIVA'`, [tenantId]
        );
        await pool.query(
          `UPDATE licencas SET estado='EXPIRADA' WHERE tenant_id=$1 AND estado='ACTIVA' AND fim < NOW()`, [tenantId]
        );
      }
      return res.status(403).json({
        erro: 'Licença expirada. Renove a sua assinatura.',
        codigo: 'LICENCA_EXPIRADA',
      });
    }

    next();
  } catch (err) {
    next(); // em caso de erro de BD não bloquear operação
  }
}

// ──────────────────────────────────────────────────────────────
// MIDDLEWARE: resolver tenant a partir do JWT
// ──────────────────────────────────────────────────────────────
function resolverTenant(req, res, next) {
  if (req.user && req.user.tenantId) {
    req.tenantId = req.user.tenantId;
  }
  next();
}

// ──────────────────────────────────────────────────────────────
// MIDDLEWARE: resolver tenant para rotas públicas do portal
// Lê X-Tenant-Slug header ou ?slug= query param
// Injeta req.tenantId (rejeita com 400 se slug inválido/ausente)
// ──────────────────────────────────────────────────────────────
async function resolverTenantPublico(req, res, next) {
  const slug = req.headers['x-tenant-slug'] || req.query.slug;
  if (!slug) {
    return res.status(400).json({ erro: 'Tenant não identificado. Forneça X-Tenant-Slug.' });
  }
  try {
    const { pool } = require('./db');
    const r = await pool.query(
      `SELECT id, estado FROM tenants WHERE slug = $1`,
      [slug.toLowerCase().trim()]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ erro: 'Estabelecimento não encontrado' });
    }
    if (r.rows[0].estado !== 'ACTIVA') {
      return res.status(403).json({ erro: 'Estabelecimento temporariamente indisponível', estado: r.rows[0].estado });
    }
    req.tenantId = r.rows[0].id;
    next();
  } catch (err) {
    console.error('resolverTenantPublico:', err.message);
    res.status(500).json({ erro: 'Erro ao identificar estabelecimento' });
  }
}

module.exports = {
  router,
  verificarLicencaTenant,
  resolverTenant,
  resolverTenantPublico,
  superAdminAuth,
};
