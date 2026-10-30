'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware, requerNivel } = require('../middleware/auth');

// GET /api/qrcode
router.get('/', authMiddleware, requerNivel(['ADMIN', 'GERENTE']), async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const portalUrl = `${baseUrl}/cliente`;
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
