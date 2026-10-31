'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel } = require('../middleware/auth');

// GET /api/qrcode
router.get('/', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const { pool } = require('../db');
    const t = await pool.query(`SELECT slug FROM tenants WHERE id = $1`, [req.tenantId || null]);
    const slug = t.rows[0] && t.rows[0].slug;
    // o portal precisa de saber a que estabelecimento pertence (?r=<slug>)
    const portalUrl = slug ? `${baseUrl}/cliente?r=${encodeURIComponent(slug)}` : `${baseUrl}/cliente`;
    let qrSvg = null;
    try {
      const QRCode = require('qrcode');
      qrSvg = await QRCode.toString(portalUrl, { type: 'svg', width: 300, margin: 2 });
    } catch {
      // qrcode não instalado — retorna apenas a URL
    }
    res.json({ url: portalUrl, qr_svg: qrSvg });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao gerar QR code' });
  }
});

module.exports = router;
