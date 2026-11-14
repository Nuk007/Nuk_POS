'use strict';
/**
 * Documentos fiscais: factura (FT), factura-recibo (FR) e nota de crédito (NC).
 *
 * Regras (preparação para a certificação AGT, decisão do dono de 14/11/2026):
 *  - Numeração própria de cada estabelecimento, por tipo e ano, sem buracos nem repetições
 *    (advisory lock por estabelecimento/tipo/ano dentro da transacção).
 *  - Cada documento guarda as suas linhas; os valores são em Kz com IVA incluído.
 *  - Um documento emitido nunca se altera nem se apaga (trigger na base de dados).
 *    Corrige-se com uma nota de crédito pelo valor total, que fica ligada ao documento de origem.
 *  - Um pedido ou uma reserva só tem um documento activo (FT/FR sem nota de crédito).
 *  - A cadeia de integridade já segue a estrutura da AGT (data; data de registo; número; total; assinatura
 *    anterior da mesma série). Hoje é um SHA-256; quando houver a chave do produtor passa a assinatura RSA
 *    em `assinar()` sem mexer no resto.
 */
const crypto = require('crypto');
const { pool } = require('../../db');
const { withTx, erro } = require('../shared');

const TIPOS_EMISSAO = ['FT', 'FR'];
const NOMES = { FT: 'Factura', FR: 'Factura-recibo', NC: 'Nota de crédito' };
const NIF_RE = /^[A-Za-z0-9]{5,20}$/;
const T = tenantId => tenantId || null;

// ─── Dinheiro em cêntimos (inteiros) para não acumular erros de vírgula flutuante ─────────────────────
const cent = v => Math.round(Number(v) * 100);
const kz = c => (c / 100).toFixed(2);
/** Separa um valor com IVA incluído em base e imposto (cêntimos). */
function separarIva(totalCent, taxa) {
  const semIva = Math.round(totalCent / (1 + Number(taxa) / 100));
  return { semIva, iva: totalCent - semIva };
}

function anoLuanda(d = new Date()) {
  return parseInt(d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' }).slice(0, 4), 10);
}

/** Assinatura do documento (ver cabeçalho). */
function assinar({ emitidaEm, numero, totalCent, anterior }) {
  const dia = emitidaEm.toLocaleDateString('sv-SE', { timeZone: 'Africa/Luanda' });
  const registo = emitidaEm.toISOString().slice(0, 19);
  return crypto.createHash('sha256').update(`${dia};${registo};${numero};${kz(totalCent)};${anterior || ''}`).digest('hex');
}

async function configIva(db, tenantId) {
  const r = await db.query(
    `SELECT chave, valor FROM configuracoes WHERE chave = ANY($1) AND ($2::uuid IS NULL OR tenant_id = $2)`,
    [['iva_padrao', 'motivo_isencao_iva'], T(tenantId)]);
  const cfg = Object.fromEntries(r.rows.map(x => [x.chave, x.valor]));
  const taxa = cfg.iva_padrao !== undefined && cfg.iva_padrao !== '' && !isNaN(parseFloat(cfg.iva_padrao)) ? parseFloat(cfg.iva_padrao) : 14;
  if (taxa < 0 || taxa > 100) throw erro(409, 'Taxa de IVA configurada inválida');
  const motivo = taxa === 0 ? (cfg.motivo_isencao_iva || '').trim() : null;
  if (taxa === 0 && !motivo) throw erro(409, 'Com IVA a 0% é obrigatório indicar o motivo de isenção em Configurações');
  return { taxa, motivo };
}

/** Documento activo (FT/FR sem nota de crédito) de um pedido ou de uma reserva. */
async function documentoActivo(db, coluna, id) {
  const r = await db.query(
    `SELECT f.numero_fatura FROM faturas f
      WHERE f.${coluna} = $1 AND f.tipo_documento IN ('FT','FR')
        AND NOT EXISTS (SELECT 1 FROM faturas nc WHERE nc.documento_origem_id = f.id)
      LIMIT 1`, [id]);
  return r.rows[0] ? r.rows[0].numero_fatura : null;
}

/**
 * Totais do documento. O desconto do documento (diferença entre a soma das linhas e o valor a pagar)
 * reparte-se pelas taxas de IVA na proporção do valor de cada uma.
 */
function totais(linhas, totalCent) {
  const brutoCent = linhas.reduce((s, l) => s + l.totalCent, 0);
  const descontoCent = Math.max(0, brutoCent - totalCent);
  const porTaxa = new Map();
  for (const l of linhas) porTaxa.set(l.taxa, (porTaxa.get(l.taxa) || 0) + l.totalCent);
  let semIva = 0, restoDesconto = descontoCent;
  const taxas = [...porTaxa.keys()];
  taxas.forEach((taxa, i) => {
    const grupo = porTaxa.get(taxa);
    const quota = i === taxas.length - 1 ? restoDesconto : Math.round(descontoCent * grupo / (brutoCent || 1));
    restoDesconto -= quota;
    semIva += separarIva(grupo - quota, taxa).semIva;
  });
  return { brutoCent, descontoCent, semIvaCent: semIva, ivaCent: totalCent - semIva };
}

function linha(ordem, { produtoId = null, descricao, quantidade, precoCent, taxa, motivo }) {
  const totalCent = Math.round(Number(quantidade) * precoCent);
  const { semIva, iva } = separarIva(totalCent, taxa);
  return { ordem, produtoId, descricao: String(descricao).slice(0, 250), quantidade: Number(quantidade), precoCent, taxa, motivo, totalCent, semIvaCent: semIva, ivaCent: iva };
}

async function proximoNumero(db, tenantId, tipo, ano) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fatura:${tenantId || 'global'}:${tipo}:${ano}`]);
  const r = await db.query(
    `SELECT COALESCE(MAX(sequencial), 0) + 1 AS prox,
            (SELECT hash_assinatura FROM faturas
              WHERE serie = $1 AND ($2::uuid IS NULL OR tenant_id = $2)
              ORDER BY ano DESC, sequencial DESC LIMIT 1) AS anterior
       FROM faturas WHERE serie = $1 AND ano = $3 AND ($2::uuid IS NULL OR tenant_id = $2)`,
    [tipo, T(tenantId), ano]);
  const sequencial = Number(r.rows[0].prox);
  return { sequencial, numero: `${tipo} ${ano}/${String(sequencial).padStart(6, '0')}`, anterior: r.rows[0].anterior };
}

async function gravar(db, { tenantId, userId, tipo, ano, seq, origem = {}, cliente, linhas, totalCent, motivo = null }) {
  const t = totais(linhas, totalCent);
  const emitidaEm = new Date();
  const hash = assinar({ emitidaEm, numero: seq.numero, totalCent, anterior: seq.anterior });
  const taxaDoc = linhas.length ? linhas[0].taxa : 14;
  const f = await db.query(`
    INSERT INTO faturas (tenant_id, tipo_documento, serie, ano, sequencial, numero_fatura, pedido_id, reserva_id, cliente_id,
                         nif_cliente, nome_cliente, total_bruto, desconto, total_sem_iva, iva, total, taxa_iva,
                         hash_assinatura, emitida_em, emitida_por, documento_origem_id, motivo)
    VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
  [T(tenantId), tipo, ano, seq.sequencial, seq.numero, origem.pedidoId || null, origem.reservaId || null, cliente.id || null,
    cliente.nif || null, cliente.nome || null, kz(t.brutoCent), kz(t.descontoCent), kz(t.semIvaCent), kz(t.ivaCent), kz(totalCent),
    taxaDoc, hash, emitidaEm, userId || null, origem.documentoId || null, motivo]);
  const fatura = f.rows[0];
  const gravadas = [];
  for (const l of linhas) {
    const r = await db.query(`
      INSERT INTO fatura_linhas (fatura_id, tenant_id, ordem, produto_id, descricao, quantidade, preco_unitario,
                                 taxa_iva, motivo_isencao, total, total_sem_iva, iva)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [fatura.id, T(tenantId), l.ordem, l.produtoId, l.descricao, l.quantidade, kz(l.precoCent), l.taxa, l.motivo,
      kz(l.totalCent), kz(l.semIvaCent), kz(l.ivaCent)]);
    gravadas.push(r.rows[0]);
  }
  return { ...fatura, linhas: gravadas };
}

function validarCliente({ cliente_id, nif_cliente, nome_cliente }) {
  const nif = nif_cliente == null ? '' : String(nif_cliente).trim();
  if (nif && !NIF_RE.test(nif)) throw erro(400, 'NIF do cliente inválido (5 a 20 letras ou números)');
  const nome = nome_cliente == null ? '' : String(nome_cliente).trim();
  if (nome.length > 200) throw erro(400, 'Nome do cliente demasiado longo (máximo 200)');
  return { id: cliente_id || null, nif: nif || null, nome: nome || null };
}

/**
 * Emite uma factura (FT) ou factura-recibo (FR) a partir de um pedido FECHADO, de uma reserva
 * ou de um valor manual (com descrição).
 */
async function emitir({ tenantId, userId, tipo = 'FT', pedido_id, reserva_id, total_manual, descricao, ...dadosCliente }) {
  tipo = String(tipo || 'FT').toUpperCase();
  if (!TIPOS_EMISSAO.includes(tipo)) throw erro(400, 'Tipo de documento inválido (FT ou FR; a nota de crédito emite-se a partir do documento)');
  const cliente = validarCliente(dadosCliente);
  const ano = anoLuanda();

  return withTx(async db => {
    const { taxa, motivo } = await configIva(db, tenantId);
    if (cliente.id) {
      const c = await db.query(`SELECT 1 FROM clientes WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [cliente.id, T(tenantId)]);
      if (!c.rows[0]) throw erro(404, 'Cliente não encontrado');
    }
    let linhas, totalCent;
    const origem = {};

    if (pedido_id) {
      const p = await db.query(
        `SELECT id, total, status, pago_em, cliente_id FROM pedidos WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE`,
        [pedido_id, T(tenantId)]);
      const ped = p.rows[0];
      if (!ped) throw erro(404, 'Pedido não encontrado');
      if (ped.status !== 'FECHADO') throw erro(409, 'Só se factura um pedido FECHADO');
      const ja = await documentoActivo(db, 'pedido_id', pedido_id);
      if (ja) throw erro(409, `Este pedido já foi facturado (${ja})`);
      if (tipo === 'FR' && !ped.pago_em) throw erro(409, 'Factura-recibo só para contas já recebidas no Caixa');
      const it = await db.query(
        `SELECT i.produto_id, i.quantidade, i.preco_unitario, pr.nome
           FROM itens_pedido i JOIN produtos pr ON pr.id = i.produto_id
          WHERE i.pedido_id = $1 ORDER BY i.criado_em, pr.nome`, [pedido_id]);
      totalCent = cent(ped.total || 0);
      linhas = it.rows.map((i, k) => linha(k + 1, { produtoId: i.produto_id, descricao: i.nome, quantidade: i.quantidade, precoCent: cent(i.preco_unitario), taxa, motivo }));
      // Sem itens ou soma abaixo do valor do pedido: uma linha única pelo valor do pedido
      if (!linhas.length || linhas.reduce((s, l) => s + l.totalCent, 0) < totalCent) {
        linhas = [linha(1, { descricao: 'Consumo', quantidade: 1, precoCent: totalCent, taxa, motivo })];
      }
      origem.pedidoId = pedido_id;
      if (!cliente.id && ped.cliente_id) cliente.id = ped.cliente_id;
    } else if (reserva_id) {
      const rv = await db.query(`
        SELECT rv.id, rv.valor_total, rv.status, rv.fracao, rv.cliente_id, q.numero AS quarto
          FROM reservas rv JOIN quartos q ON q.id = rv.quarto_id
         WHERE rv.id = $1 AND ($2::uuid IS NULL OR q.tenant_id = $2) FOR UPDATE OF rv`, [reserva_id, T(tenantId)]);
      const r = rv.rows[0];
      if (!r) throw erro(404, 'Reserva não encontrada');
      if (r.status === 'CANCELADA') throw erro(409, 'Não se factura uma reserva cancelada');
      const ja = await documentoActivo(db, 'reserva_id', reserva_id);
      if (ja) throw erro(409, `Esta reserva já foi facturada (${ja})`);
      totalCent = cent(r.valor_total || 0);
      if (totalCent <= 0) throw erro(409, 'Reserva sem valor a facturar');
      const servico = { DUAS_HORAS: 'hora', PERNOITE: 'noite', DIARIA: 'diária' }[r.fracao] || 'estadia';
      linhas = [linha(1, { descricao: `Alojamento — Quarto ${r.quarto} (${servico})`, quantidade: 1, precoCent: totalCent, taxa, motivo })];
      origem.reservaId = reserva_id;
      if (!cliente.id && r.cliente_id) cliente.id = r.cliente_id;
    } else if (total_manual !== undefined && total_manual !== null && total_manual !== '') {
      totalCent = cent(total_manual);
      if (!(totalCent > 0)) throw erro(400, 'total_manual deve ser positivo');
      const desc = descricao == null ? 'Serviços prestados' : String(descricao).trim();
      if (!desc || desc.length > 250) throw erro(400, 'Descrição obrigatória (máximo 250 caracteres)');
      linhas = [linha(1, { descricao: desc, quantidade: 1, precoCent: totalCent, taxa, motivo })];
    } else {
      throw erro(400, 'Fornecer pedido_id, reserva_id ou total_manual');
    }

    const seq = await proximoNumero(db, tenantId, tipo, ano);
    return gravar(db, { tenantId, userId, tipo, ano, seq, origem, cliente, linhas, totalCent });
  });
}

/** Nota de crédito pelo valor total de uma FT/FR (anula-a para efeitos fiscais). */
async function notaCredito({ tenantId, userId, faturaId, motivo }) {
  const m = motivo == null ? '' : String(motivo).trim();
  if (m.length < 5 || m.length > 250) throw erro(400, 'Motivo obrigatório (5 a 250 caracteres)');
  const ano = anoLuanda();

  return withTx(async db => {
    const o = await db.query(`SELECT * FROM faturas WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE`, [faturaId, T(tenantId)]);
    const orig = o.rows[0];
    if (!orig) throw erro(404, 'Documento não encontrado');
    if (orig.tipo_documento === 'NC') throw erro(409, 'Não se emite nota de crédito sobre outra nota de crédito');
    const ja = await db.query(`SELECT numero_fatura FROM faturas WHERE documento_origem_id = $1 AND tipo_documento = 'NC'`, [faturaId]);
    if (ja.rows[0]) throw erro(409, `Este documento já tem nota de crédito (${ja.rows[0].numero_fatura})`);

    const ls = await db.query(`SELECT * FROM fatura_linhas WHERE fatura_id = $1 ORDER BY ordem`, [faturaId]);
    const totalCent = cent(orig.total);
    let linhas = ls.rows.map(l => ({
      ordem: l.ordem, produtoId: l.produto_id, descricao: l.descricao, quantidade: Number(l.quantidade), precoCent: cent(l.preco_unitario),
      taxa: Number(l.taxa_iva), motivo: l.motivo_isencao, totalCent: cent(l.total), semIvaCent: cent(l.total_sem_iva), ivaCent: cent(l.iva),
    }));
    // Documentos anteriores ao módulo fiscal não têm linhas: uma linha pelo total
    if (!linhas.length) {
      const taxa = Number(orig.taxa_iva || 14);
      linhas = [linha(1, { descricao: `Anulação de ${orig.numero_fatura}`, quantidade: 1, precoCent: totalCent, taxa, motivo: taxa === 0 ? 'Isento' : null })];
    }
    const seq = await proximoNumero(db, tenantId, 'NC', ano);
    return gravar(db, {
      tenantId, userId, tipo: 'NC', ano, seq, totalCent, motivo: m, linhas,
      origem: { pedidoId: orig.pedido_id, reservaId: orig.reserva_id, documentoId: orig.id },
      cliente: { id: orig.cliente_id, nif: orig.nif_cliente, nome: orig.nome_cliente },
    });
  });
}

/** Últimos 100 documentos, com a indicação de anulação por nota de crédito. */
async function listar({ tenantId }) {
  const r = await pool.query(`
    SELECT f.*, c.nome AS cliente_nome, o.numero_fatura AS documento_origem_numero, nc.numero_fatura AS anulada_por_numero
      FROM faturas f
      LEFT JOIN clientes c ON c.id = f.cliente_id
      LEFT JOIN faturas o ON o.id = f.documento_origem_id
      LEFT JOIN faturas nc ON nc.documento_origem_id = f.id AND nc.tipo_documento = 'NC'
     WHERE ($1::uuid IS NULL OR f.tenant_id = $1)
     ORDER BY f.emitida_em DESC LIMIT 100`, [T(tenantId)]);
  return r.rows;
}

/** Documento com as linhas (usado também pelo PDF). */
async function obter({ tenantId, faturaId }) {
  const f = await pool.query(`
    SELECT f.*, c.nome AS cliente_nome, o.numero_fatura AS documento_origem_numero, nc.numero_fatura AS anulada_por_numero
      FROM faturas f
      LEFT JOIN clientes c ON c.id = f.cliente_id
      LEFT JOIN faturas o ON o.id = f.documento_origem_id
      LEFT JOIN faturas nc ON nc.documento_origem_id = f.id AND nc.tipo_documento = 'NC'
     WHERE f.id = $1 AND ($2::uuid IS NULL OR f.tenant_id = $2)`, [faturaId, T(tenantId)]);
  if (!f.rows[0]) throw erro(404, 'Factura não encontrada');
  const l = await pool.query(`SELECT * FROM fatura_linhas WHERE fatura_id = $1 ORDER BY ordem`, [faturaId]);
  return { ...f.rows[0], linhas: l.rows };
}

module.exports = { emitir, notaCredito, listar, obter, NOMES, _interno: { totais, separarIva, assinar, linha } };
