'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requerNivel } = require('../middleware/auth');

const CHAVES_PERMITIDAS = [
  'nome_estabelecimento', 'iva_padrao', 'moeda', 'timezone',
  'telefone', 'email_contato', 'morada', 'nif_empresa',
  'taxa_servico', 'stock_alerta_minimo', 'versao',
  // M-04 fix: chaves do sistema de fidelização NukCoin/estrelas
  'nukcoin_desconto_pct', 'estrelas_minimo_consumo', 'estrelas_para_desconto',
  'desconto_estrelas_pct', 'desconto_estrelas_limite', 'pontos_boas_vindas', 'portal_url',
  // Chaves de eventos/promoções
  'evento_nome', 'evento_data', 'evento_descricao', 'evento_ativo',
];

// GET /api/configuracoes
router.get('/', authMiddleware, async (req, res) => {
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

// PUT /api/configuracoes
router.put('/', authMiddleware, requerNivel(['ADMIN']), async (req, res) => {
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

module.exports = router;
