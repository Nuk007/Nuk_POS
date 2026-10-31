'use strict';
/**
 * Migração: índices compostos para optimizar queries multi-tenant com filtros.
 *
 * Padrão de acesso identificado no código:
 *   WHERE tenant_id = $1 AND status = $2 (pedidos)
 *   WHERE tenant_id = $1 AND ativo = true ORDER BY categoria, nome (stock)
 *   WHERE tenant_id = $1 AND emitida_em/criado_em DESC (faturas, clientes)
 *   WHERE tenant_id = $1 AND disponivel = true AND ativo = true (produtos)
 *   WHERE tenant_id = $1 ORDER BY criado_em DESC (queries gerais)
 */

exports.up = (pgm) => {
  // ── pedidos ──────────────────────────────────────────────────────────────
  // Filtros mais comuns: listar por tenant+status, ou paginar por tenant+data
  pgm.createIndex('pedidos', ['tenant_id', 'status'], {
    name: 'idx_pedidos_tenant_status',
    ifNotExists: true,
  });
  pgm.createIndex('pedidos', ['tenant_id', 'criado_em'], {
    name: 'idx_pedidos_tenant_criado_em',
    ifNotExists: true,
  });
  pgm.createIndex('pedidos', ['tenant_id', 'mesa_id'], {
    name: 'idx_pedidos_tenant_mesa_id',
    ifNotExists: true,
  });

  // ── itens_pedido ─────────────────────────────────────────────────────────
  // JOIN frequente pedido_id → LEFT JOIN itens_pedido ip ON p.id = ip.pedido_id
  pgm.createIndex('itens_pedido', ['pedido_id', 'produto_id'], {
    name: 'idx_itens_pedido_pedido_produto',
    ifNotExists: true,
  });

  // ── stock_items ──────────────────────────────────────────────────────────
  // ORDER BY categoria, nome com filtro tenant+ativo
  pgm.createIndex('stock_items', ['tenant_id', 'ativo', 'categoria', 'nome'], {
    name: 'idx_stock_tenant_ativo_cat_nome',
    ifNotExists: true,
  });
  // Alertas de stock: tenant_id + stock_atual <= stock_minimo
  pgm.createIndex('stock_items', ['tenant_id', 'stock_atual', 'stock_minimo'], {
    name: 'idx_stock_tenant_niveis',
    ifNotExists: true,
  });

  // ── movimentos_stock ─────────────────────────────────────────────────────
  pgm.createIndex('movimentos_stock', ['stock_item_id', 'criado_em'], {
    name: 'idx_movimentos_item_criado_em',
    ifNotExists: true,
  });

  // ── produtos ─────────────────────────────────────────────────────────────
  // Filtro: disponivel = true AND ativo = true (para criação de pedido)
  pgm.createIndex('produtos', ['tenant_id', 'disponivel', 'ativo'], {
    name: 'idx_produtos_tenant_disp_ativo',
    ifNotExists: true,
  });
  pgm.createIndex('produtos', ['tenant_id', 'categoria'], {
    name: 'idx_produtos_tenant_categoria',
    ifNotExists: true,
  });

  // ── funcionarios ─────────────────────────────────────────────────────────
  // Login: LOWER(email) — índice funcional
  pgm.createIndex('funcionarios', pgm.func('LOWER(email)'), {
    name: 'idx_funcionarios_email_lower',
    ifNotExists: true,
  });
  pgm.createIndex('funcionarios', ['tenant_id', 'nivel_acesso'], {
    name: 'idx_funcionarios_tenant_nivel',
    ifNotExists: true,
  });

  // ── mesas ────────────────────────────────────────────────────────────────
  pgm.createIndex('mesas', ['tenant_id', 'status'], {
    name: 'idx_mesas_tenant_status',
    ifNotExists: true,
  });

  // ── clientes ─────────────────────────────────────────────────────────────
  pgm.createIndex('clientes', ['tenant_id', 'criado_em'], {
    name: 'idx_clientes_tenant_criado_em',
    ifNotExists: true,
  });

  // ── faturas ──────────────────────────────────────────────────────────────
  // Relatórios financeiros: por tenant e período de emissão
  pgm.createIndex('faturas', ['tenant_id', 'emitida_em'], {
    name: 'idx_faturas_tenant_emitida_em',
    ifNotExists: true,
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('pedidos',                'idx_pedidos_tenant_status',         { ifExists: true, name: 'idx_pedidos_tenant_status' });
  pgm.dropIndex('pedidos',                'idx_pedidos_tenant_criado_em',      { ifExists: true, name: 'idx_pedidos_tenant_criado_em' });
  pgm.dropIndex('pedidos',                'idx_pedidos_tenant_mesa_id',        { ifExists: true, name: 'idx_pedidos_tenant_mesa_id' });
  pgm.dropIndex('itens_pedido',           'idx_itens_pedido_pedido_produto',   { ifExists: true, name: 'idx_itens_pedido_pedido_produto' });
  pgm.dropIndex('stock_items',            'idx_stock_tenant_ativo_cat_nome',   { ifExists: true, name: 'idx_stock_tenant_ativo_cat_nome' });
  pgm.dropIndex('stock_items',            'idx_stock_tenant_niveis',           { ifExists: true, name: 'idx_stock_tenant_niveis' });
  pgm.dropIndex('movimentos_stock',       'idx_movimentos_item_criado_em',     { ifExists: true, name: 'idx_movimentos_item_criado_em' });
  pgm.dropIndex('produtos',               'idx_produtos_tenant_disp_ativo',    { ifExists: true, name: 'idx_produtos_tenant_disp_ativo' });
  pgm.dropIndex('produtos',               'idx_produtos_tenant_categoria',     { ifExists: true, name: 'idx_produtos_tenant_categoria' });
  pgm.dropIndex('funcionarios',           'idx_funcionarios_email_lower',      { ifExists: true, name: 'idx_funcionarios_email_lower' });
  pgm.dropIndex('funcionarios',           'idx_funcionarios_tenant_nivel',     { ifExists: true, name: 'idx_funcionarios_tenant_nivel' });
  pgm.dropIndex('mesas',                  'idx_mesas_tenant_status',           { ifExists: true, name: 'idx_mesas_tenant_status' });
  pgm.dropIndex('clientes',               'idx_clientes_tenant_criado_em',     { ifExists: true, name: 'idx_clientes_tenant_criado_em' });
  pgm.dropIndex('faturas',                'idx_faturas_tenant_emitida_em',     { ifExists: true, name: 'idx_faturas_tenant_emitida_em' });
};
