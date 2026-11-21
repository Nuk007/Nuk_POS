'use strict';
/**
 * ConfiguracoesService — chaves simples do estabelecimento (lógica que estava na rota; 21/11/2026).
 * As configurações com regras próprias têm o seu serviço (fluxos-venda, quartos-tempos, resumo-diario…) e ficam
 * fora desta lista de propósito.
 */
const { pool } = require('../db');
const { withTx, erro } = require('./shared');

const CHAVES_PERMITIDAS = [
  'nome_estabelecimento', 'iva_padrao', 'moeda', 'timezone',
  'telefone', 'email_contato', 'morada', 'nif_empresa',
  'taxa_servico', 'stock_alerta_minimo', 'versao',
  // sistema de fidelização Nuk-Coin/estrelas
  'nukcoin_desconto_pct', 'estrelas_minimo_consumo', 'estrelas_para_desconto',
  'desconto_estrelas_pct', 'desconto_estrelas_limite', 'pontos_boas_vindas', 'portal_url',
  // eventos/promoções
  'evento_nome', 'evento_data', 'evento_descricao', 'evento_ativo',
];

/** Dados do estabelecimento que vão nos talões e documentos: morada, NIF e telefone. Vazio = apagar. */
function validarContacto(b) {
  if (b.morada != null && String(b.morada).trim().length > 200) return 'A morada não pode ter mais de 200 caracteres';
  if (b.nif_empresa != null && String(b.nif_empresa).trim() !== '' && !/^[A-Za-z0-9]{5,20}$/.test(String(b.nif_empresa).trim())) return 'NIF inválido: use só letras e números (5 a 20 caracteres)';
  if (b.telefone != null && String(b.telefone).trim() !== '' && !/^\+?[0-9 ()-]{6,20}$/.test(String(b.telefone).trim())) return 'Telefone inválido: use números, espaços e + (6 a 20 caracteres)';
  return null;
}

/** Todas as chaves do estabelecimento num objecto { chave: valor }. */
async function ler({ tenantId }) {
  const r = await pool.query(
    `SELECT chave, valor FROM configuracoes WHERE ($1::uuid IS NULL OR tenant_id = $1) ORDER BY chave`, [tenantId || null]);
  return Object.fromEntries(r.rows.map(x => [x.chave, x.valor]));
}

/** Grava várias chaves de uma vez (tudo ou nada). Só as chaves da lista; só ADMIN (a rota garante). */
async function guardar({ tenantId, valores }) {
  const v = valores && typeof valores === 'object' ? valores : {};
  const desconhecidas = Object.keys(v).filter(k => !CHAVES_PERMITIDAS.includes(k));
  if (desconhecidas.length) throw erro(400, `Chaves não permitidas: ${desconhecidas.join(', ')}`);
  const msg = validarContacto(v);
  if (msg) throw erro(400, msg);
  await withTx(async client => {
    for (const [chave, valor] of Object.entries(v)) {
      await client.query(
        `INSERT INTO configuracoes (tenant_id, chave, valor) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = $3, atualizado_em = NOW()`, [tenantId || null, chave, String(valor).trim()]);
    }
  });
  return { ok: true };
}

module.exports = { ler, guardar, validarContacto, CHAVES_PERMITIDAS };
