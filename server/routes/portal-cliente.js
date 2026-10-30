'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const bcrypt = require('bcryptjs'); // usa bcryptjs (puro JS, sem compilação nativa)
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { authMiddleware, requerNivel, isUUID } = require('../middleware/auth');
const { broadcast } = require('../middleware/broadcast');

// Helper: gerar PIN hash (bcrypt)
async function hashPin(pin) {
  return bcrypt.hash(pin, 10);
}
// Helper: verificar PIN
async function verificarPin(pin, hash) {
  if (!hash) return false;
  return bcrypt.compare(pin, hash);
}

// resolverTenantPublico is injected via app.use — import from saas module
const { resolverTenantPublico } = require('../saas');

const clienteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: { erro: 'Demasiadas tentativas. Tente novamente em 10 minutos.' },
});

// ── GET /api/cliente/cardapio ──
router.get('/cardapio', clienteLimiter, resolverTenantPublico, async (req, res) => {
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

// ── GET /api/cliente/eventos ──
router.get('/eventos', clienteLimiter, resolverTenantPublico, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT chave, valor FROM configuracoes
       WHERE chave LIKE 'evento_%' AND ($1::uuid IS NULL OR tenant_id = $1)`,
      [req.tenantId || null]
    );
    const cfg = {};
    r.rows.forEach(row => { cfg[row.chave.replace('evento_', '')] = row.valor; });
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao carregar eventos' });
  }
});

// ── POST /api/cliente/login ──
// A-01 fix: exige PIN (4 dígitos) para autenticação além do número de telefone
router.post('/login', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const { telefone, pin } = req.body;
  if (!telefone || !/^9[0-9]{8}$/.test(telefone.replace(/\s/g, ''))) {
    return res.status(400).json({ erro: 'Número de telefone inválido' });
  }
  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({ erro: 'PIN obrigatório (4 dígitos)' });
  }
  try {
    const tel = telefone.replace(/\s/g, '');
    const r = await pool.query(
      `SELECT id, nome, telefone, provincia,
              pontos, nivel_fidelizacao,
              nukcoin_saldo, estrelas, criado_em, pin_hash
       FROM clientes
       WHERE telefone = $1 AND ativo = true
         AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [tel, req.tenantId || null]
    );
    if (!r.rows[0]) {
      // Resposta genérica para não revelar se o número existe
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }
    const cliente = r.rows[0];
    if (!cliente.pin_hash) {
      // Cliente ainda não tem PIN definido — pede para definir primeiro
      return res.status(403).json({ erro: 'PIN não configurado. Por favor defina o seu PIN.', sem_pin: true });
    }
    const pinValido = await verificarPin(String(pin), cliente.pin_hash);
    if (!pinValido) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }
    // Não retornar pin_hash ao cliente
    const { pin_hash: _, ...clienteSemPin } = cliente;
    res.json({ cliente: clienteSemPin });
  } catch (e) {
    console.error('login cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao autenticar cliente' });
  }
});

// ── POST /api/cliente/definir-pin ── (A-01: primeiro acesso ou reset de PIN)
router.post('/definir-pin', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const { telefone, pin } = req.body;
  if (!telefone || !/^9[0-9]{8}$/.test(telefone.replace(/\s/g, ''))) {
    return res.status(400).json({ erro: 'Número de telefone inválido' });
  }
  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({ erro: 'PIN deve ter exactamente 4 dígitos' });
  }
  try {
    const tel = telefone.replace(/\s/g, '');
    const r = await pool.query(
      `SELECT id FROM clientes WHERE telefone = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [tel, req.tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const hash = await hashPin(String(pin));
    await pool.query(`UPDATE clientes SET pin_hash = $1 WHERE id = $2`, [hash, r.rows[0].id]);
    res.json({ mensagem: 'PIN definido com sucesso.' });
  } catch (e) {
    console.error('definir-pin:', e.message);
    res.status(500).json({ erro: 'Erro ao definir PIN' });
  }
});

// ── POST /api/cliente/cadastrar ──
router.post('/cadastrar', clienteLimiter, resolverTenantPublico, async (req, res) => {
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
    const ex = await pool.query(
      `SELECT id FROM clientes WHERE telefone = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [tel, tenantId || null]
    );
    if (ex.rows[0]) return res.status(409).json({ erro: 'Número de telefone já cadastrado' });

    let referidoPorId = null;
    if (referido_por_tel) {
      const telRef = referido_por_tel.replace(/\s/g, '');
      if (/^9[0-9]{8}$/.test(telRef)) {
        const ref = await pool.query(
          `SELECT id FROM clientes WHERE telefone = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`,
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
       RETURNING id, nome, telefone, provincia, pontos, nivel_fidelizacao, nukcoin_saldo, estrelas`,
      [novoId, tenantId || null, nome.trim(), tel, provincia || null, referidoPorId]
    );

    if (referidoPorId) {
      await pool.query(`UPDATE clientes SET estrelas = estrelas + 1 WHERE id = $1`, [referidoPorId]);
      broadcast('estrela_referral', { cliente_id: referidoPorId, motivo: 'Referência de novo cliente' }, tenantId);
    }

    broadcast('cliente_novo', { nome: r.rows[0].nome }, tenantId);
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

// ── POST /api/cliente/pedido-restaurante ──
router.post('/pedido-restaurante', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const { itens, mesa_ref, observacoes, cliente_id, metodo_pagamento } = req.body;
  if (!itens || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'Itens do pedido são obrigatórios' });
  }
  if (itens.length > 50) return res.status(400).json({ erro: 'Máximo de 50 itens por pedido' });

  const METODOS = ['CASH', 'TPA', 'NUKCOIN', 'EXPRESS', 'TRANSFERENCIA'];
  const metodo = (metodo_pagamento || 'CASH').toUpperCase();
  if (!METODOS.includes(metodo)) {
    return res.status(400).json({ erro: `Método de pagamento inválido. Aceites: ${METODOS.join(', ')}` });
  }
  if (cliente_id && !isUUID(cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });

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
    const cfgR = await pool.query(
      `SELECT chave, valor FROM configuracoes
       WHERE chave IN ('nukcoin_desconto_pct','estrelas_minimo_consumo','estrelas_para_desconto','desconto_estrelas_pct','desconto_estrelas_limite')
         AND ($1::uuid IS NULL OR tenant_id = $1)`,
      [tenantId || null]
    );
    const cfg = {};
    cfgR.rows.forEach(r => { cfg[r.chave] = parseFloat(r.valor); });

    let total = 0;
    const itensFull = [];
    for (const item of itens) {
      const p = await pool.query(
        `SELECT id, nome, preco FROM produtos WHERE id = $1 AND disponivel = true AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [item.produto_id, tenantId || null]
      );
      if (!p.rows[0]) continue;
      const subtotal = parseFloat(p.rows[0].preco) * item.quantidade;
      total += subtotal;
      itensFull.push({ produto_id: p.rows[0].id, nome: p.rows[0].nome, quantidade: item.quantidade, preco_unitario: parseFloat(p.rows[0].preco), subtotal });
    }
    if (itensFull.length === 0) return res.status(400).json({ erro: 'Nenhum produto válido encontrado' });

    let totalFinal = total;
    let descontoAplicado = 0;
    let estrelaGanha = false;
    let novoSaldoNukcoin = null;

    if (metodo === 'NUKCOIN' && cliente_id) {
      const nukClient = await pool.connect();
      try {
        await nukClient.query('BEGIN');
        const clienteR = await nukClient.query(
          `SELECT nukcoin_saldo, estrelas FROM clientes WHERE id = $1 AND ativo = true
           AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE`,
          [cliente_id, tenantId || null]
        );
        if (!clienteR.rows[0]) {
          await nukClient.query('ROLLBACK');
          nukClient.release();
          return res.status(400).json({ erro: 'Cliente não encontrado para pagamento Nuk-Coin' });
        }
        const saldoAtual = parseFloat(clienteR.rows[0].nukcoin_saldo);
        const estrelasCliente = clienteR.rows[0].estrelas;
        const limite = cfg.desconto_estrelas_limite || 25000;
        if (estrelasCliente >= (cfg.estrelas_para_desconto || 5) && total <= limite) {
          const pct = cfg.desconto_estrelas_pct || 20;
          descontoAplicado = total * (pct / 100);
          totalFinal = total - descontoAplicado;
        } else {
          const pct = cfg.nukcoin_desconto_pct || 10;
          descontoAplicado = total * (pct / 100);
          totalFinal = total - descontoAplicado;
        }
        if (saldoAtual < totalFinal) {
          await nukClient.query('ROLLBACK');
          nukClient.release();
          return res.status(400).json({ erro: 'Saldo Nuk-Coin insuficiente', saldo_atual: saldoAtual, total_necessario: totalFinal });
        }
        const novoSaldo = saldoAtual - totalFinal;
        await nukClient.query(`UPDATE clientes SET nukcoin_saldo = $1 WHERE id = $2`, [novoSaldo, cliente_id]);
        novoSaldoNukcoin = novoSaldo;
        await nukClient.query(
          `INSERT INTO movimentos_nukcoin (id, cliente_id, tipo, valor, saldo_antes, saldo_depois, descricao, criado_em)
           VALUES ($1, $2, 'CONSUMO', $3, $4, $5, 'Pagamento pedido restaurante', NOW())`,
          [uuidv4(), cliente_id, totalFinal, saldoAtual, novoSaldo]
        );
        await nukClient.query('COMMIT');
      } catch (nukErr) {
        await nukClient.query('ROLLBACK');
        nukClient.release();
        throw nukErr;
      }
      nukClient.release();
    }

    let mesa_id = null;
    if (mesa_ref) {
      const m = await pool.query(
        `SELECT id FROM mesas WHERE numero = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [mesa_ref, tenantId || null]
      );
      if (m.rows[0]) mesa_id = m.rows[0].id;
    }

    const pedidoId = uuidv4();
    const codigo = 'P' + crypto.randomBytes(3).toString('hex').toUpperCase();
    await pool.query(
      `INSERT INTO pedidos (id, tenant_id, mesa_id, cliente_id, status, total, observacoes, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, 'ABERTO', $5, $6, NOW(), NOW())`,
      [pedidoId, tenantId || null, mesa_id, cliente_id || null, totalFinal, observacoes || null]
    );

    for (const item of itensFull) {
      await pool.query(
        `INSERT INTO itens_pedido (id, pedido_id, produto_id, quantidade, preco_unitario) VALUES ($1,$2,$3,$4,$5)`,
        [uuidv4(), pedidoId, item.produto_id, item.quantidade, item.preco_unitario]
      );
    }

    if (cliente_id && total >= (cfg.estrelas_minimo_consumo || 25000)) {
      await pool.query(`UPDATE clientes SET estrelas = estrelas + 1 WHERE id = $1`, [cliente_id]);
      estrelaGanha = true;
    }

    broadcast('novo_pedido_cliente', {
      pedido_id: pedidoId, codigo, mesa_ref: mesa_ref || null,
      itens: itensFull.map(i => `${i.quantidade}x ${i.nome}`),
      total: totalFinal, metodo_pagamento: metodo, fonte: 'PORTAL_CLIENTE',
    }, tenantId);

    res.status(201).json({
      codigo, pedido_id: pedidoId, total_bruto: total,
      desconto: descontoAplicado, total_final: totalFinal,
      metodo_pagamento: metodo, estrela_ganha: estrelaGanha,
      nukcoin_saldo_novo: novoSaldoNukcoin,
      mensagem: 'Pedido enviado com sucesso!',
    });
  } catch (e) {
    console.error('pedido-restaurante:', e.message);
    res.status(500).json({ erro: 'Erro ao registar pedido' });
  }
});

// ── POST /api/cliente/pedido-hospedagem ──
router.post('/pedido-hospedagem', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const FRACOES_VALIDAS = ['DUAS_HORAS', 'PERNOITE', 'DIARIA'];
  const { fracao, quantidade, nome_hospede, telefone, observacoes, cliente_id } = req.body;
  if (!FRACOES_VALIDAS.includes(fracao)) {
    return res.status(400).json({ erro: `Fração inválida. Valores aceites: ${FRACOES_VALIDAS.join(', ')}` });
  }
  const qty = parseInt(quantidade) || 1;
  if (qty < 1 || qty > 20) return res.status(400).json({ erro: 'Quantidade inválida (1-20)' });
  const tenantId = req.tenantId;
  try {
    const solicitacaoId = uuidv4();
    const codigo = 'H' + Date.now().toString().slice(-4);
    // A-02 fix: incluir tenant_id no INSERT para isolamento multi-tenant
    await pool.query(
      `INSERT INTO solicitacoes_hospedagem (id, tenant_id, cliente_id, tipo_fracao, quantidade_quartos, status,
                            nome_responsavel, telefone_contacto, observacoes, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, 'PENDENTE', $6, $7, $8, NOW(), NOW())`,
      [solicitacaoId, tenantId || null, cliente_id || null, fracao, qty, nome_hospede || null, telefone || null, observacoes || null]
    );
    broadcast('nova_solicitacao_hospedagem', {
      id: solicitacaoId, codigo, fracao, quantidade: qty,
      nome_hospede: nome_hospede || 'Visitante', telefone: telefone || '—', fonte: 'PORTAL_CLIENTE',
    }, tenantId);
    res.status(201).json({ codigo, solicitacao_id: solicitacaoId, mensagem: 'Solicitação enviada! A nossa equipa entrará em contacto brevemente.' });
  } catch (e) {
    console.error('pedido-hospedagem:', e.message);
    res.status(500).json({ erro: 'Erro ao registar solicitação' });
  }
});

// ── POST /api/cliente/perfil ── (M-05 fix: telefone no body, não na query string para não aparecer em logs)
router.post('/perfil', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const tel = ((req.body && req.body.telefone) || '').replace(/\s/g, '');
  if (!/^9[0-9]{8}$/.test(tel)) return res.status(400).json({ erro: 'Telefone inválido' });
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT id, nome, telefone, provincia, pontos, nivel_fidelizacao, nukcoin_saldo, estrelas, criado_em
       FROM clientes WHERE telefone = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [tel, tenantId || null]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const cfgR = await pool.query(
      `SELECT chave, valor FROM configuracoes
       WHERE chave IN ('estrelas_para_desconto','desconto_estrelas_pct','desconto_estrelas_limite','nukcoin_desconto_pct')
         AND ($1::uuid IS NULL OR tenant_id = $1)`,
      [tenantId || null]
    );
    const cfg = {};
    cfgR.rows.forEach(row => { cfg[row.chave] = parseFloat(row.valor); });
    const cliente = r.rows[0];
    res.json({ cliente, config: cfg, desconto_ativo: cliente.estrelas >= (cfg.estrelas_para_desconto || 5) });
  } catch (e) {
    console.error('perfil cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao carregar perfil' });
  }
});

// ── POST /api/cliente/nukcoin/carregar (requer JWT de operador) ──
router.post('/nukcoin/carregar', clienteLimiter, authMiddleware, async (req, res) => {
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
      `SELECT id, nome, nukcoin_saldo FROM clientes WHERE id = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [cliente_id, tenantId || null]
    );
    if (!clienteR.rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const saldoAntes = parseFloat(clienteR.rows[0].nukcoin_saldo);
    const saldoDepois = saldoAntes + valorNum;
    await pool.query(`UPDATE clientes SET nukcoin_saldo = $1 WHERE id = $2`, [saldoDepois, cliente_id]);
    await pool.query(
      `INSERT INTO movimentos_nukcoin (id, cliente_id, tipo, valor, saldo_antes, saldo_depois, descricao, criado_em)
       VALUES ($1, $2, 'CARREGAMENTO', $3, $4, $5, 'Carregamento Nuk-Coin', NOW())`,
      [uuidv4(), cliente_id, valorNum, saldoAntes, saldoDepois]
    );
    res.json({
      saldo_anterior: saldoAntes, valor_carregado: valorNum, saldo_atual: saldoDepois,
      mensagem: `✅ ${valorNum.toLocaleString('pt-AO')} Kz carregados com sucesso!`,
    });
  } catch (e) {
    console.error('nukcoin carregar:', e.message);
    res.status(500).json({ erro: 'Erro ao carregar Nuk-Coin' });
  }
});

// ── GET /api/cliente/nukcoin/historico ──
router.get('/nukcoin/historico', clienteLimiter, resolverTenantPublico, async (req, res) => {
  const { cliente_id } = req.query;
  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id obrigatório' });
  if (!isUUID(cliente_id)) return res.status(400).json({ erro: 'cliente_id inválido' });
  const tenantId = req.tenantId;
  try {
    const clienteCheck = await pool.query(
      `SELECT id FROM clientes WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [cliente_id, tenantId || null]
    );
    if (!clienteCheck.rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const r = await pool.query(
      `SELECT tipo, valor, saldo_antes, saldo_depois, descricao, criado_em
       FROM movimentos_nukcoin WHERE cliente_id = $1 ORDER BY criado_em DESC LIMIT 20`,
      [cliente_id]
    );
    res.json({ movimentos: r.rows });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao carregar histórico' });
  }
});

module.exports = { router, clienteLimiter };
