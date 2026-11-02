'use strict';
/**
 * PWA — service worker (com a versão da app, para renovar a cache em cada deploy) e manifesto do portal do cliente
 * (um por estabelecimento: ao instalar, abre directamente o portal desse estabelecimento).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'sw.template.js'), 'utf8');
const VERSAO = (process.env.RENDER_GIT_COMMIT || process.env.APP_VERSION || String(Date.now())).slice(0, 12);

router.get('/sw.js', (req, res) => {
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.send(TEMPLATE.replace(/__VERSAO__/g, VERSAO));
});

router.get('/manifest-cliente.webmanifest', async (req, res) => {
  const slug = String(req.query.r || '').toLowerCase();
  let nome = 'Nuk_POS';
  const valido = /^[a-z0-9][a-z0-9-]{0,59}$/.test(slug);
  if (valido) {
    try {
      const t = await pool.query(`SELECT nome FROM tenants WHERE slug = $1 LIMIT 1`, [slug]);
      if (t.rows[0]) nome = t.rows[0].nome;
    } catch (_) { /* sem nome: usa o genérico */ }
  }
  const start = valido ? `/cliente?r=${slug}` : '/cliente';
  res.set({ 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
  res.json({
    id: start, name: nome, short_name: nome.length > 12 ? nome.slice(0, 12) : nome,
    description: 'Menu, pedidos e Nuk-Coin', lang: 'pt-AO', start_url: start, scope: '/cliente',
    display: 'standalone', background_color: '#0d1117', theme_color: '#0d1117',
    icons: [
      { src: '/img/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/img/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

module.exports = router;
