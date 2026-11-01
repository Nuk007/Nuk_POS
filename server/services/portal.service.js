'use strict';
/**
 * Portal do cliente + carteira Nuk-Coin — lógica de negócio.
 *
 * Regras de dinheiro (não violar):
 *  - Toda a alteração de saldo corre numa transacção com SELECT … FOR UPDATE (sem perdas em concorrência).
 *  - Cada alteração de saldo deixa um movimento em movimentos_nukcoin (livro-razão): saldo = Σ movimentos.
 *  - Pagar com Nuk-Coin exige o PIN do cliente; o débito e o pedido gravam-se na MESMA transacção.
 *  - Cancelar um pedido pago com Nuk-Coin estorna o valor (ver pedidos.service).
 */
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { broadcast } = require('../middleware/broadcast');
const { withTx, erro } = require('./shared');
const stock = require('./stock.service');

const TEL_RE = /^9[0-9]{8}$/;
const PIN_RE = /^\d{4}$/;
const METODOS = ['CASH', 'TPA', 'NUKCOIN', 'EXPRESS', 'TRANSFERENCIA'];
const VALORES_CARREGAMENTO = [5000, 10000, 15000, 20000, 25000, 50000];
const T = tenantId => tenantId || null;
const limpaTel = t => String(t || '').replace(/\s/g, '');
const arred = n => Math.round(n * 100) / 100;

async function configDe(db, tenantId, chaves) {
  const r = await db.query(`SELECT chave, valor FROM configuracoes WHERE chave = ANY($1) AND ($2::uuid IS NULL OR tenant_id = $2)`, [chaves, T(tenantId)]);
  const cfg = {};
  r.rows.forEach(x => { cfg[x.chave] = parseFloat(x.valor); });
  return cfg;
}

/** Verifica o PIN de um cliente (por id). Mensagem genérica para não revelar o que falhou. */
async function exigirPin(db, tenantId, clienteId, pin) {
  if (!PIN_RE.test(String(pin || ''))) throw erro(401, 'PIN obrigatório (4 dígitos)');
  const r = await db.query(`SELECT pin_hash FROM clientes WHERE id = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`, [clienteId, T(tenantId)]);
  if (!r.rows[0] || !r.rows[0].pin_hash || !(await bcrypt.compare(String(pin), r.rows[0].pin_hash))) throw erro(401, 'Credenciais inválidas');
}

async function cardapio({ tenantId }) {
  const r = await pool.query(
    `SELECT id, nome, descricao, preco, categoria, disponivel FROM produtos
     WHERE disponivel = true AND ativo = true AND ($1::uuid IS NULL OR tenant_id = $1) ORDER BY categoria, nome`, [T(tenantId)]);
  return { produtos: r.rows };
}

async function eventos({ tenantId }) {
  const r = await pool.query(`SELECT chave, valor FROM configuracoes WHERE chave LIKE 'evento_%' AND ($1::uuid IS NULL OR tenant_id = $1)`, [T(tenantId)]);
  const cfg = {};
  r.rows.forEach(x => { cfg[x.chave.replace('evento_', '')] = x.valor; });
  return cfg;
}

async function login({ tenantId, telefone, pin }) {
  const tel = limpaTel(telefone);
  if (!TEL_RE.test(tel)) throw erro(400, 'Número de telefone inválido');
  if (!PIN_RE.test(String(pin || ''))) throw erro(400, 'PIN obrigatório (4 dígitos)');
  const r = await pool.query(
    `SELECT id, nome, telefone, provincia, pontos, nivel_fidelizacao, nukcoin_saldo, estrelas, criado_em, pin_hash
     FROM clientes WHERE telefone = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`, [tel, T(tenantId)]);
  const c = r.rows[0];
  if (!c) throw erro(401, 'Credenciais inválidas');
  if (!c.pin_hash) throw erro(403, 'PIN não configurado. Por favor defina o seu PIN.', { sem_pin: true });
  if (!(await bcrypt.compare(String(pin), c.pin_hash))) throw erro(401, 'Credenciais inválidas');
  const { pin_hash: _, ...semPin } = c;
  return { cliente: semPin };
}

/** Primeiro acesso de clientes antigos (sem PIN). Quem já tem PIN só o repõe através de um operador. */
async function definirPin({ tenantId, telefone, pin }) {
  const tel = limpaTel(telefone);
  if (!TEL_RE.test(tel)) throw erro(400, 'Número de telefone inválido');
  if (!PIN_RE.test(String(pin || ''))) throw erro(400, 'PIN deve ter exactamente 4 dígitos');
  const hash = await bcrypt.hash(String(pin), 10);
  const r = await pool.query(
    `UPDATE clientes SET pin_hash = $1 WHERE telefone = $2 AND ativo = true AND pin_hash IS NULL AND ($3::uuid IS NULL OR tenant_id = $3) RETURNING id`,
    [hash, tel, T(tenantId)]);
  if (r.rows[0]) return { mensagem: 'PIN definido com sucesso.' };
  const ex = await pool.query(`SELECT 1 FROM clientes WHERE telefone = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`, [tel, T(tenantId)]);
  if (!ex.rows[0]) throw erro(404, 'Cliente não encontrado');
  throw erro(403, 'O PIN já está definido. Peça a um funcionário para o repor.');
}

/** Operador repõe o PIN: o cliente fica sem PIN e define um novo no próximo acesso. */
async function reporPin({ tenantId, clienteId }) {
  const r = await pool.query(`UPDATE clientes SET pin_hash = NULL WHERE id = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2) RETURNING id`, [clienteId, T(tenantId)]);
  if (!r.rows[0]) throw erro(404, 'Cliente não encontrado');
  return { mensagem: 'PIN reposto. O cliente define um novo PIN no próximo acesso.' };
}

async function cadastrar({ tenantId, nome, telefone, provincia, pin, referido_por_tel }) {
  if (!nome || String(nome).trim().length < 2) throw erro(400, 'Nome obrigatório (mínimo 2 caracteres)');
  const tel = limpaTel(telefone);
  if (!TEL_RE.test(tel)) throw erro(400, 'Número de telefone inválido (formato 9XXXXXXXX)');
  if (!PIN_RE.test(String(pin || ''))) throw erro(400, 'Escolha um PIN de 4 dígitos');
  const ex = await pool.query(`SELECT id FROM clientes WHERE telefone = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [tel, T(tenantId)]);
  if (ex.rows[0]) throw erro(409, 'Número de telefone já cadastrado');

  let referidoPorId = null;
  const telRef = limpaTel(referido_por_tel);
  if (TEL_RE.test(telRef) && telRef !== tel) {
    const ref = await pool.query(`SELECT id FROM clientes WHERE telefone = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`, [telRef, T(tenantId)]);
    if (ref.rows[0]) referidoPorId = ref.rows[0].id;
  }
  const cfg = await configDe(pool, tenantId, ['pontos_boas_vindas']);
  const pontos = Number.isFinite(cfg.pontos_boas_vindas) ? cfg.pontos_boas_vindas : 50;
  const hash = await bcrypt.hash(String(pin), 10);

  const cliente = await withTx(async db => {
    const r = await db.query(
      `INSERT INTO clientes (id, tenant_id, nome, telefone, provincia, pontos, nivel_fidelizacao, nukcoin_saldo, estrelas, referido_por, ativo, pin_hash, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,'BRONZE',0,0,$7,true,$8,NOW())
       RETURNING id, nome, telefone, provincia, pontos, nivel_fidelizacao, nukcoin_saldo, estrelas`,
      [uuidv4(), T(tenantId), String(nome).trim(), tel, provincia || null, pontos, referidoPorId, hash]);
    if (referidoPorId) await db.query(`UPDATE clientes SET estrelas = estrelas + 1 WHERE id = $1`, [referidoPorId]);
    return r.rows[0];
  });
  if (referidoPorId) broadcast('estrela_referral', { cliente_id: referidoPorId, motivo: 'Referência de novo cliente' }, tenantId);
  broadcast('cliente_novo', { nome: cliente.nome }, tenantId);
  return { cliente, mensagem: `Cadastro realizado com sucesso! 🎉 Bónus de ${pontos} pontos creditados.`, referral_bonus: !!referidoPorId };
}

/** Carregamento feito por um operador (o dinheiro entra no balcão). */
async function carregar({ tenantId, clienteId, valor, operadorId }) {
  const v = Number(valor);
  if (!VALORES_CARREGAMENTO.includes(v)) throw erro(400, `Valor inválido. Opções: ${VALORES_CARREGAMENTO.join(', ')} Kz`);
  const out = await withTx(async db => {
    const r = await db.query(`SELECT id, nome, nukcoin_saldo FROM clientes WHERE id = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE`, [clienteId, T(tenantId)]);
    if (!r.rows[0]) throw erro(404, 'Cliente não encontrado');
    const antes = parseFloat(r.rows[0].nukcoin_saldo);
    const depois = arred(antes + v);
    await db.query(`UPDATE clientes SET nukcoin_saldo = $1 WHERE id = $2`, [depois, clienteId]);
    await db.query(
      `INSERT INTO movimentos_nukcoin (id, cliente_id, tipo, valor, saldo_antes, saldo_depois, descricao) VALUES ($1,$2,'CARREGAMENTO',$3,$4,$5,$6)`,
      [uuidv4(), clienteId, v, antes, depois, operadorId ? `Carregamento no balcão (operador ${operadorId})` : 'Carregamento Nuk-Coin']);
    return { saldo_anterior: antes, valor_carregado: v, saldo_atual: depois, nome: r.rows[0].nome };
  });
  broadcast('nukcoin_carregado', { cliente_id: clienteId, saldo_atual: out.saldo_atual }, tenantId);
  return { ...out, mensagem: `✅ ${v.toLocaleString('pt-AO')} Kz carregados com sucesso!` };
}

async function criarPedidoRestaurante({ tenantId, itens, mesa_ref, observacoes, cliente_id, metodo_pagamento, pin }) {
  if (!Array.isArray(itens) || itens.length === 0) throw erro(400, 'Itens do pedido são obrigatórios');
  if (itens.length > 50) throw erro(400, 'Máximo de 50 itens por pedido');
  const metodo = String(metodo_pagamento || 'CASH').toUpperCase();
  if (!METODOS.includes(metodo)) throw erro(400, `Método de pagamento inválido. Aceites: ${METODOS.join(', ')}`);
  for (const it of itens) {
    if (!Number.isInteger(it.quantidade) || it.quantidade < 1 || it.quantidade > 100) throw erro(400, 'Quantidade inválida (1-100 por item)');
  }
  if (metodo === 'NUKCOIN' && !cliente_id) throw erro(400, 'Pagamento Nuk-Coin exige um cliente registado');

  let alertasStock = [];
  const pedido = await withTx(async db => {
    // 1) preços sempre do servidor; qualquer produto inválido rejeita o pedido (não se cobra "só o que existe")
    let total = 0; const linhas = [];
    for (const it of itens) {
      const p = await db.query(`SELECT id, nome, preco FROM produtos WHERE id = $1 AND disponivel = true AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2)`, [it.produto_id, T(tenantId)]);
      if (!p.rows[0]) throw erro(400, 'Um dos produtos não existe ou não está disponível');
      const preco = parseFloat(p.rows[0].preco);
      total = arred(total + preco * it.quantidade);
      linhas.push({ produto_id: p.rows[0].id, nome: p.rows[0].nome, quantidade: it.quantidade, preco_unitario: preco });
    }
    const cfg = await configDe(db, tenantId, ['nukcoin_desconto_pct', 'estrelas_minimo_consumo', 'estrelas_para_desconto', 'desconto_estrelas_pct', 'desconto_estrelas_limite']);

    let totalFinal = total, desconto = 0, nukcoinPago = 0, saldoNovo = null, estrelasGastas = 0;
    let cli = null;
    if (cliente_id) {
      const c = await db.query(`SELECT id, nukcoin_saldo, estrelas, pin_hash FROM clientes WHERE id = $1 AND ativo = true AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE`, [cliente_id, T(tenantId)]);
      cli = c.rows[0];
      if (!cli) throw erro(400, 'Cliente não encontrado');
    }
    // Desconto de estrelas: qualquer método de pagamento, mas só com o PIN do cliente (consome as estrelas).
    const pinOk = !!(cli && cli.pin_hash && PIN_RE.test(String(pin || '')) && await bcrypt.compare(String(pin), cli.pin_hash));
    if (metodo === 'NUKCOIN' && !pinOk) throw erro(401, 'PIN inválido');
    const elegivelEstrelas = !!cli && cli.estrelas >= (cfg.estrelas_para_desconto || 5) && total <= (cfg.desconto_estrelas_limite || 25000);
    const usaEstrelas = elegivelEstrelas && pinOk;
    if (usaEstrelas || metodo === 'NUKCOIN') {
      const pct = usaEstrelas ? (cfg.desconto_estrelas_pct || 20) : (cfg.nukcoin_desconto_pct || 10);
      desconto = arred(total * pct / 100);
      totalFinal = arred(total - desconto);
      if (usaEstrelas) estrelasGastas = cfg.estrelas_para_desconto || 5;
    }
    if (metodo === 'NUKCOIN') {
      const saldo = parseFloat(cli.nukcoin_saldo);
      if (saldo < totalFinal) throw erro(400, 'Saldo Nuk-Coin insuficiente', { saldo_atual: saldo, total_necessario: totalFinal });
      saldoNovo = arred(saldo - totalFinal);
      nukcoinPago = totalFinal;
    }

    // Mesa indicada pelo cliente: se não existir, recusa-se (um pedido sem local não chega a quem o serve)
    let mesaId = null;
    if (mesa_ref) {
      const ref = String(mesa_ref).trim();
      const m = await db.query(`SELECT id FROM mesas WHERE UPPER(numero) = UPPER($1) AND ($2::uuid IS NULL OR tenant_id = $2)`, [ref, T(tenantId)]);
      if (!m.rows[0]) throw erro(400, `A mesa "${ref.slice(0, 10)}" não existe. Confirme o número da mesa.`);
      mesaId = m.rows[0].id;
    }
    const pedidoId = uuidv4();
    await db.query(
      `INSERT INTO pedidos (id, tenant_id, mesa_id, cliente_id, status, total, desconto, observacoes, metodo_pagamento, nukcoin_pago, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,'ABERTO',$5,$6,$7,$8,$9,NOW(),NOW())`,
      [pedidoId, T(tenantId), mesaId, cliente_id || null, totalFinal, desconto, observacoes || null, metodo, nukcoinPago]);
    for (const l of linhas) {
      await db.query(`INSERT INTO itens_pedido (id, pedido_id, produto_id, quantidade, preco_unitario) VALUES ($1,$2,$3,$4,$5)`, [uuidv4(), pedidoId, l.produto_id, l.quantidade, l.preco_unitario]);
    }
    // Abate o stock na mesma transacção: sem stock, o pedido (e o débito Nuk-Coin) não existem
    alertasStock = await stock.baixarStockPedido(db, { tenantId, pedidoId, linhas });
    if (metodo === 'NUKCOIN') {
      await db.query(`UPDATE clientes SET nukcoin_saldo = $1 WHERE id = $2`, [saldoNovo, cliente_id]);
      await db.query(
        `INSERT INTO movimentos_nukcoin (id, cliente_id, tipo, valor, saldo_antes, saldo_depois, descricao, pedido_id) VALUES ($1,$2,'CONSUMO',$3,$4,$5,'Pagamento pedido restaurante',$6)`,
        [uuidv4(), cliente_id, totalFinal, parseFloat(cli.nukcoin_saldo), saldoNovo, pedidoId]);
    }
    let estrelaGanha = false;
    if (cliente_id && total >= (cfg.estrelas_minimo_consumo || 25000)) estrelaGanha = true;
    if (cliente_id && (estrelaGanha || estrelasGastas)) {
      await db.query(`UPDATE clientes SET estrelas = GREATEST(0, estrelas + $1 - $2) WHERE id = $3`, [estrelaGanha ? 1 : 0, estrelasGastas, cliente_id]);
    }
    return { pedidoId, total, totalFinal, desconto, saldoNovo, estrelaGanha, estrelasGastas, linhas };
  });

  stock.avisarStockBaixo(alertasStock);
  const codigo = 'P' + crypto.randomBytes(3).toString('hex').toUpperCase();
  broadcast('novo_pedido_cliente', {
    pedido_id: pedido.pedidoId, codigo, mesa_ref: mesa_ref || null,
    itens: pedido.linhas.map(i => `${i.quantidade}x ${i.nome}`), total: pedido.totalFinal, metodo_pagamento: metodo, fonte: 'PORTAL_CLIENTE',
  }, tenantId);
  return {
    codigo, pedido_id: pedido.pedidoId, total_bruto: pedido.total, desconto: pedido.desconto, total_final: pedido.totalFinal,
    metodo_pagamento: metodo, estrela_ganha: pedido.estrelaGanha, estrelas_usadas: pedido.estrelasGastas,
    nukcoin_saldo_novo: pedido.saldoNovo, mensagem: 'Pedido enviado com sucesso!',
  };
}

async function criarPedidoHospedagem({ tenantId, fracao, quantidade, nome_hospede, telefone, observacoes, cliente_id }) {
  const FRACOES = ['DUAS_HORAS', 'PERNOITE', 'DIARIA'];
  if (!FRACOES.includes(fracao)) throw erro(400, `Fração inválida. Valores aceites: ${FRACOES.join(', ')}`);
  const qty = parseInt(quantidade) || 1;
  if (qty < 1 || qty > 20) throw erro(400, 'Quantidade inválida (1-20)');
  const id = uuidv4();
  const codigo = 'H' + crypto.randomBytes(2).toString('hex').toUpperCase();
  await pool.query(
    `INSERT INTO solicitacoes_hospedagem (id, tenant_id, cliente_id, tipo_fracao, quantidade_quartos, status, nome_responsavel, telefone_contacto, observacoes, criado_em, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,'PENDENTE',$6,$7,$8,NOW(),NOW())`,
    [id, T(tenantId), cliente_id || null, fracao, qty, nome_hospede || null, telefone || null, observacoes || null]);
  broadcast('nova_solicitacao_hospedagem', { id, codigo, fracao, quantidade: qty, nome_hospede: nome_hospede || 'Visitante', telefone: telefone || '—', fonte: 'PORTAL_CLIENTE' }, tenantId);
  return { codigo, solicitacao_id: id, mensagem: 'Solicitação enviada! A nossa equipa entrará em contacto brevemente.' };
}

/** Perfil e histórico exigem o PIN: o telefone/UUID sozinhos não são segredo. */
async function perfil({ tenantId, telefone, pin }) {
  const tel = limpaTel(telefone);
  if (!TEL_RE.test(tel)) throw erro(400, 'Telefone inválido');
  const { cliente } = await login({ tenantId, telefone: tel, pin });
  const cfg = await configDe(pool, tenantId, ['estrelas_para_desconto', 'desconto_estrelas_pct', 'desconto_estrelas_limite', 'nukcoin_desconto_pct']);
  return { cliente, config: cfg, desconto_ativo: cliente.estrelas >= (cfg.estrelas_para_desconto || 5) };
}

async function historico({ tenantId, clienteId, pin, limite = 20 }) {
  await exigirPin(pool, tenantId, clienteId, pin);
  const r = await pool.query(
    `SELECT tipo, valor, saldo_antes, saldo_depois, descricao, pedido_id, criado_em FROM movimentos_nukcoin WHERE cliente_id = $1 ORDER BY criado_em DESC, id LIMIT $2`,
    [clienteId, Math.min(100, Math.max(1, limite))]);
  return { movimentos: r.rows };
}

module.exports = { cardapio, eventos, login, definirPin, reporPin, cadastrar, carregar, criarPedidoRestaurante, criarPedidoHospedagem, perfil, historico, exigirPin };
