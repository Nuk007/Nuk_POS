'use strict';
/** Leituras simples do estabelecimento usadas pelo QR do portal e pelo manifesto da PWA (saíram das rotas a 21/11/2026). */
const { pool } = require('../db');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** Nome do estabelecimento pelo slug do portal; null se o slug for inválido ou não existir. */
async function nomePorSlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const r = await pool.query(`SELECT nome FROM tenants WHERE slug = $1 LIMIT 1`, [s]);
  return r.rows[0] ? r.rows[0].nome : null;
}

/** Slug do estabelecimento (o QR do portal leva-o: /cliente?r=<slug>). */
async function slugDe(tenantId) {
  if (!tenantId) return null;
  const r = await pool.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId]);
  return r.rows[0] ? r.rows[0].slug : null;
}

module.exports = { nomePorSlug, slugDe, SLUG_RE };
