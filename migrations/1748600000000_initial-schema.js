'use strict';
/**
 * Migração inicial — esquema completo do Nuk_POS
 * Captura o estado actual do initDB() de db.js.
 *
 * node-pg-migrate aplica esta migração quando a base de dados
 * ainda não tem registos na tabela 'pgmigrations'.
 */

exports.up = (pgm) => {
  // ─── SaaS — infra-estrutura ───────────────────────────────────

  pgm.createTable('planos_assinatura', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    nome:             { type: 'varchar(50)', notNull: true, unique: true },
    descricao:        { type: 'text' },
    max_funcionarios: { type: 'integer', default: 3 },
    max_produtos:     { type: 'integer', default: 50 },
    max_mesas:        { type: 'integer', default: 20 },
    preco_mensal:     { type: 'numeric(12,2)', default: 0 },
    preco_anual:      { type: 'numeric(12,2)', default: 0 },
    ativo:            { type: 'boolean', default: true },
    criado_em:        { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  pgm.createTable('tenants', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    nome:             { type: 'varchar(200)', notNull: true },
    nif:              { type: 'varchar(30)' },
    telefone_whatsapp:{ type: 'varchar(30)', notNull: true },
    email:            { type: 'varchar(200)' },
    pais:             { type: 'varchar(60)', default: "'Angola'" },
    moeda:            { type: 'varchar(10)', default: "'Kz'" },
    timezone:         { type: 'varchar(60)', default: "'Africa/Luanda'" },
    plano_id:         { type: 'uuid', references: 'planos_assinatura' },
    estado:           {
      type: 'varchar(20)', default: "'PENDENTE'",
      check: "estado IN ('PENDENTE','ACTIVA','SUSPENSA','EXPIRADA','CANCELADA')",
    },
    slug:             { type: 'varchar(60)', unique: true },
    logo_url:         { type: 'text' },
    criado_em:        { type: 'timestamptz', default: pgm.func('NOW()') },
    atualizado_em:    { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('tenants', 'estado', { ifNotExists: true, name: 'idx_tenants_estado' });

  pgm.createTable('licencas', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    license_key:      { type: 'varchar(40)', notNull: true, unique: true },
    plano_id:         { type: 'uuid', references: 'planos_assinatura' },
    duracao_dias:     { type: 'integer', notNull: true, default: 30 },
    inicio:           { type: 'timestamptz' },
    fim:              { type: 'timestamptz' },
    estado:           {
      type: 'varchar(20)', default: "'PENDENTE'",
      check: "estado IN ('PENDENTE','ACTIVA','EXPIRADA','REVOGADA')",
    },
    whatsapp_enviado_em: { type: 'timestamptz' },
    activado_em:      { type: 'timestamptz' },
    activado_por_ip:  { type: 'varchar(50)' },
    gerado_por:       { type: 'varchar(200)', default: "'superadmin'" },
    notas:            { type: 'text' },
    criado_em:        { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('licencas', 'license_key', { ifNotExists: true, name: 'idx_licencas_key' });
  pgm.createIndex('licencas', 'tenant_id',   { ifNotExists: true, name: 'idx_licencas_tenant' });

  pgm.createTable('tenant_admins', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:    { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    nome:         { type: 'varchar(200)', notNull: true },
    email:        { type: 'varchar(200)' },
    telefone:     { type: 'varchar(30)' },
    password_hash:{ type: 'varchar(255)' },
    estado:       {
      type: 'varchar(20)', default: "'PENDENTE'",
      check: "estado IN ('PENDENTE','ACTIVO','BLOQUEADO')",
    },
    ultimo_acesso:{ type: 'timestamptz' },
    criado_em:    { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('tenant_admins', 'tenant_id', { ifNotExists: true, name: 'idx_tenant_admins_tenant' });

  // ─── Tabelas operacionais ─────────────────────────────────────

  pgm.createTable('funcionarios', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:       { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    nome:            { type: 'varchar(200)', notNull: true },
    email:           { type: 'varchar(200)', notNull: true },
    password_hash:   { type: 'varchar(255)', notNull: true },
    cargo:           { type: 'varchar(100)' },
    nivel_acesso:    {
      type: 'varchar(20)', default: "'OPERADOR'",
      check: "nivel_acesso IN ('ADMIN','GERENTE','OPERADOR')",
    },
    salario:         { type: 'numeric(12,2)', default: 0 },
    media_avaliacao: { type: 'numeric(3,2)', default: 0 },
    total_avaliacoes:{ type: 'integer', default: 0 },
    ativo:           { type: 'boolean', default: true },
    dois_fatores:    { type: 'boolean', default: false },
    ultimo_acesso:   { type: 'timestamptz' },
    criado_em:       { type: 'timestamptz', default: pgm.func('NOW()') },
    atualizado_em:   { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true, constraints: { unique: ['tenant_id', 'email'] } });
  pgm.createIndex('funcionarios', 'tenant_id', { ifNotExists: true, name: 'idx_func_tenant' });

  pgm.createTable('clientes', {
    id:                { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:         { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    nome:              { type: 'varchar(200)', notNull: true },
    telefone:          { type: 'varchar(20)' },
    email:             { type: 'varchar(200)' },
    provincia:         { type: 'varchar(100)' },
    nif:               { type: 'varchar(20)' },
    password_hash:     { type: 'varchar(255)' },
    pin_hash:          { type: 'varchar(255)' },
    nivel_fidelizacao: {
      type: 'varchar(10)', default: "'BRONZE'",
      check: "nivel_fidelizacao IN ('BRONZE','PRATA','OURO','PLATINA')",
    },
    saldo_carteira:    { type: 'numeric(15,2)', default: 0 },
    nukcoin_saldo:     { type: 'numeric(15,2)', default: 0 },
    estrelas:          { type: 'integer', default: 0 },
    pontos:            { type: 'integer', default: 50 },
    referido_por:      { type: 'uuid', references: 'clientes' },
    ativo:             { type: 'boolean', default: true },
    criado_em:         { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true, constraints: { unique: ['tenant_id', 'telefone'] } });
  pgm.createIndex('clientes', 'tenant_id', { ifNotExists: true, name: 'idx_clientes_tenant' });
  pgm.createIndex('clientes', 'telefone',  { ifNotExists: true, name: 'idx_clientes_tel' });

  pgm.createTable('mesas', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:        { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    numero:           { type: 'varchar(10)', notNull: true },
    capacidade:       { type: 'integer', default: 4 },
    zona:             { type: 'varchar(50)' },
    status:           {
      type: 'varchar(20)', default: "'LIVRE'",
      check: "status IN ('LIVRE','OCUPADA','RESERVADA','LIMPEZA','MANUTENCAO')",
    },
    ultima_atividade: { type: 'timestamptz' },
    criado_em:        { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true, constraints: { unique: ['tenant_id', 'numero'] } });
  pgm.createIndex('mesas', 'tenant_id', { ifNotExists: true, name: 'idx_mesas_tenant' });

  pgm.createTable('produtos', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:   { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    nome:        { type: 'varchar(200)', notNull: true },
    descricao:   { type: 'text' },
    categoria:   {
      type: 'varchar(30)',
      check: "categoria IN ('CHURRASCO','PEIXE','BEBIDA','SOBREMESA','ACOMPANHAMENTO','COCKTAIL','ENTRADA','SHISHA','PRATO','OUTRO')",
    },
    preco:       { type: 'numeric(10,2)', notNull: true },
    disponivel:  { type: 'boolean', default: true },
    ativo:       { type: 'boolean', default: true },
    criado_em:   { type: 'timestamptz', default: pgm.func('NOW()') },
    atualizado_em:{ type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('produtos', 'tenant_id', { ifNotExists: true, name: 'idx_produtos_tenant' });

  pgm.createTable('pedidos', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:     { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    mesa_id:       { type: 'uuid', references: 'mesas' },
    cliente_id:    { type: 'uuid', references: 'clientes' },
    funcionario_id:{ type: 'uuid', references: 'funcionarios' },
    status:        {
      type: 'varchar(20)', default: "'ABERTO'",
      check: "status IN ('ABERTO','EM_PREPARO','PRONTO','FECHADO','CANCELADO')",
    },
    total:         { type: 'numeric(15,2)', default: 0 },
    desconto:      { type: 'numeric(15,2)', default: 0 },
    observacoes:   { type: 'text' },
    criado_em:     { type: 'timestamptz', default: pgm.func('NOW()') },
    atualizado_em: { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('pedidos', 'status',    { ifNotExists: true, name: 'idx_pedidos_status' });
  pgm.createIndex('pedidos', 'mesa_id',   { ifNotExists: true, name: 'idx_pedidos_mesa' });
  pgm.createIndex('pedidos', 'criado_em', { ifNotExists: true, name: 'idx_pedidos_data' });

  pgm.createTable('itens_pedido', {
    id:             { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    pedido_id:      { type: 'uuid', notNull: true, references: 'pedidos', onDelete: 'CASCADE' },
    produto_id:     { type: 'uuid', notNull: true, references: 'produtos' },
    quantidade:     { type: 'numeric(8,2)', notNull: true },
    preco_unitario: { type: 'numeric(10,2)', notNull: true },
    status_cozinha: {
      type: 'varchar(20)', default: "'AGUARDANDO'",
      check: "status_cozinha IN ('AGUARDANDO','PREPARANDO','PRONTO','ENTREGUE')",
    },
    observacoes:    { type: 'varchar(300)' },
    criado_em:      { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('itens_pedido', 'pedido_id', { ifNotExists: true, name: 'idx_itens_pedido' });

  pgm.createTable('quartos', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:       { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    numero:          { type: 'varchar(10)', notNull: true },
    tipo:            {
      type: 'varchar(20)',
      check: "tipo IN ('STANDARD','SUPERIOR','SUITE','SUITE_PRESIDENCIAL','VIP_EXECUTIVO')",
    },
    andar:           { type: 'integer', default: 0 },
    preco_2h:        { type: 'numeric(10,2)', notNull: true },
    preco_pernoite:  { type: 'numeric(10,2)', notNull: true },
    preco_diaria:    { type: 'numeric(10,2)', notNull: true },
    status:          {
      type: 'varchar(20)', default: "'DISPONIVEL'",
      check: "status IN ('DISPONIVEL','OCUPADO','LIMPEZA','MANUTENCAO','BLOQUEADO')",
    },
    descricao:       { type: 'text' },
    criado_em:       { type: 'timestamptz', default: pgm.func('NOW()') },
    atualizado_em:   { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true, constraints: { unique: ['tenant_id', 'numero'] } });
  pgm.createIndex('quartos', 'tenant_id', { ifNotExists: true, name: 'idx_quartos_tenant' });

  pgm.createTable('reservas', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:     { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    quarto_id:     { type: 'uuid', notNull: true, references: 'quartos' },
    cliente_id:    { type: 'uuid', references: 'clientes' },
    nome_hospede:  { type: 'varchar(200)' },
    fracao:        {
      type: 'varchar(20)',
      check: "fracao IN ('DUAS_HORAS','PERNOITE','DIARIA')",
    },
    checkin:       { type: 'timestamptz', notNull: true },
    checkout:      { type: 'timestamptz', notNull: true },
    status:        {
      type: 'varchar(20)', default: "'CONFIRMADA'",
      check: "status IN ('CONFIRMADA','CHECKIN','CHECKOUT','CANCELADA','NO_SHOW')",
    },
    valor_total:   { type: 'numeric(10,2)', notNull: true },
    observacoes:   { type: 'text' },
    criado_em:     { type: 'timestamptz', default: pgm.func('NOW()') },
    atualizado_em: { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('reservas', 'tenant_id', { ifNotExists: true, name: 'idx_reservas_tenant' });
  pgm.createIndex('reservas', 'quarto_id', { ifNotExists: true, name: 'idx_reservas_quarto' });
  pgm.createIndex('reservas', 'checkin',   { ifNotExists: true, name: 'idx_reservas_checkin' });

  pgm.createTable('solicitacoes_hospedagem', {
    id:                  { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:           { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    cliente_id:          { type: 'uuid', references: 'clientes' },
    nome_responsavel:    { type: 'varchar(200)' },
    telefone_contacto:   { type: 'varchar(30)' },
    tipo_fracao:         {
      type: 'varchar(20)',
      check: "tipo_fracao IN ('DUAS_HORAS','PERNOITE','DIARIA')",
    },
    quantidade_quartos:  { type: 'integer', notNull: true, default: 1 },
    status:              {
      type: 'varchar(20)', default: "'PENDENTE'",
      check: "status IN ('PENDENTE','CONFIRMADA','CANCELADA')",
    },
    observacoes:         { type: 'text' },
    reserva_id:          { type: 'uuid', references: 'reservas' },
    criado_em:           { type: 'timestamptz', default: pgm.func('NOW()') },
    atualizado_em:       { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('solicitacoes_hospedagem', 'status',    { ifNotExists: true, name: 'idx_solicitacoes_status' });
  pgm.createIndex('solicitacoes_hospedagem', 'tenant_id', { ifNotExists: true, name: 'idx_solicitacoes_tenant' });

  pgm.createTable('stock_items', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:     { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    nome:          { type: 'varchar(200)', notNull: true },
    categoria:     {
      type: 'varchar(30)',
      check: "categoria IN ('CARNE','PEIXE','VEGETAL','TEMPERO','BEBIDA','CARVAO','LIMPEZA','OUTRO')",
    },
    stock_atual:   { type: 'numeric(10,3)', default: 0 },
    stock_minimo:  { type: 'numeric(10,3)', default: 0 },
    stock_ideal:   { type: 'numeric(10,3)', default: 0 },
    unidade:       {
      type: 'varchar(5)',
      check: "unidade IN ('g','kg','ml','L','un')",
    },
    custo_unitario:{ type: 'numeric(10,4)' },
    fornecedor:    { type: 'varchar(200)' },
    ativo:         { type: 'boolean', default: true },
    criado_em:     { type: 'timestamptz', default: pgm.func('NOW()') },
    atualizado_em: { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('stock_items', 'tenant_id', { ifNotExists: true, name: 'idx_stock_tenant' });
  pgm.createIndex('stock_items', ['tenant_id', 'ativo'], { ifNotExists: true, name: 'idx_stock_tenant_ativo' });

  pgm.createTable('movimentos_nukcoin', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    cliente_id:   { type: 'uuid', notNull: true, references: 'clientes' },
    tipo:         {
      type: 'varchar(20)',
      check: "tipo IN ('CARREGAMENTO','CONSUMO','ESTORNO','BONUS')",
    },
    valor:        { type: 'numeric(15,2)', notNull: true },
    saldo_antes:  { type: 'numeric(15,2)' },
    saldo_depois: { type: 'numeric(15,2)' },
    descricao:    { type: 'text' },
    pedido_id:    { type: 'uuid', references: 'pedidos' },
    criado_em:    { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('movimentos_nukcoin', 'cliente_id', { ifNotExists: true, name: 'idx_nukcoin_cliente' });

  pgm.createTable('movimentos_stock', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    stock_item_id:   { type: 'uuid', notNull: true, references: 'stock_items' },
    tipo:            {
      type: 'varchar(20)',
      check: "tipo IN ('VENDA','COMPRA','AJUSTE','DESPERDICIO','INVENTARIO')",
    },
    quantidade:      { type: 'numeric(10,3)', notNull: true },
    quantidade_antes:{ type: 'numeric(10,3)' },
    motivo:          { type: 'text' },
    operador_id:     { type: 'uuid' },
    criado_em:       { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
  pgm.createIndex('movimentos_stock', 'stock_item_id', { ifNotExists: true, name: 'idx_mov_stock_item' });

  pgm.createTable('faturas', {
    id:             { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:      { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    pedido_id:      { type: 'uuid', unique: true, references: 'pedidos' },
    reserva_id:     { type: 'uuid', references: 'reservas' },
    cliente_id:     { type: 'uuid', references: 'clientes' },
    serie:          { type: 'varchar(5)', default: "'FT'" },
    ano:            { type: 'integer', notNull: true },
    sequencial:     { type: 'integer', notNull: true },
    numero_fatura:  { type: 'varchar(30)', notNull: true, unique: true },
    nif_cliente:    { type: 'varchar(20)' },
    nome_cliente:   { type: 'varchar(200)' },
    total_sem_iva:  { type: 'numeric(15,2)', notNull: true },
    iva:            { type: 'numeric(15,2)', notNull: true },
    total:          { type: 'numeric(15,2)', notNull: true },
    taxa_iva:       { type: 'numeric(5,2)', default: 14 },
    hash_assinatura:{ type: 'varchar(64)' },
    emitida_em:     { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true, constraints: { unique: ['serie', 'ano', 'sequencial'] } });
  pgm.createIndex('faturas', 'tenant_id', { ifNotExists: true, name: 'idx_faturas_tenant' });

  pgm.createTable('avaliacoes', {
    id:             { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    pedido_id:      { type: 'uuid', notNull: true, references: 'pedidos' },
    funcionario_id: { type: 'uuid', notNull: true, references: 'funcionarios' },
    nota:           { type: 'integer', check: 'nota BETWEEN 1 AND 5' },
    comentario:     { type: 'text' },
    criado_em:      { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true, constraints: { unique: ['pedido_id', 'funcionario_id'] } });

  pgm.createTable('chamadas_staff', {
    id:                 { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:          { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    mesa_id:            { type: 'uuid', notNull: true, references: 'mesas' },
    funcionario_id:     { type: 'uuid', references: 'funcionarios' },
    motivo:             { type: 'varchar(200)' },
    solicitado_em:      { type: 'timestamptz', default: pgm.func('NOW()') },
    atendido_em:        { type: 'timestamptz' },
    tempo_resposta_seg: { type: 'integer' },
  }, { ifNotExists: true });
  pgm.createIndex('chamadas_staff', 'tenant_id', { ifNotExists: true, name: 'idx_chamadas_tenant' });

  pgm.createTable('configuracoes', {
    tenant_id:    { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    chave:        { type: 'varchar(100)', notNull: true },
    valor:        { type: 'text', notNull: true },
    descricao:    { type: 'text' },
    atualizado_em:{ type: 'timestamptz', default: pgm.func('NOW()') },
  }, {
    ifNotExists: true,
    constraints: { primaryKey: ['tenant_id', 'chave'] },
  });
  pgm.createIndex('configuracoes', 'tenant_id', { ifNotExists: true, name: 'idx_config_tenant' });

  pgm.createTable('refresh_tokens', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id:     { type: 'uuid', references: 'tenants', onDelete: 'CASCADE' },
    funcionario_id:{ type: 'uuid', notNull: true, references: 'funcionarios', onDelete: 'CASCADE' },
    token:         { type: 'varchar(500)', notNull: true, unique: true },
    expira_em:     { type: 'timestamptz', notNull: true },
    criado_em:     { type: 'timestamptz', default: pgm.func('NOW()') },
  }, { ifNotExists: true });
};

exports.down = (pgm) => {
  // Apagar em ordem inversa (respeitar dependências FK)
  pgm.dropTable('refresh_tokens',          { ifExists: true, cascade: true });
  pgm.dropTable('configuracoes',           { ifExists: true, cascade: true });
  pgm.dropTable('chamadas_staff',          { ifExists: true, cascade: true });
  pgm.dropTable('avaliacoes',              { ifExists: true, cascade: true });
  pgm.dropTable('faturas',                 { ifExists: true, cascade: true });
  pgm.dropTable('movimentos_stock',        { ifExists: true, cascade: true });
  pgm.dropTable('movimentos_nukcoin',      { ifExists: true, cascade: true });
  pgm.dropTable('stock_items',             { ifExists: true, cascade: true });
  pgm.dropTable('solicitacoes_hospedagem', { ifExists: true, cascade: true });
  pgm.dropTable('reservas',                { ifExists: true, cascade: true });
  pgm.dropTable('quartos',                 { ifExists: true, cascade: true });
  pgm.dropTable('itens_pedido',            { ifExists: true, cascade: true });
  pgm.dropTable('pedidos',                 { ifExists: true, cascade: true });
  pgm.dropTable('produtos',                { ifExists: true, cascade: true });
  pgm.dropTable('mesas',                   { ifExists: true, cascade: true });
  pgm.dropTable('clientes',                { ifExists: true, cascade: true });
  pgm.dropTable('funcionarios',            { ifExists: true, cascade: true });
  pgm.dropTable('tenant_admins',           { ifExists: true, cascade: true });
  pgm.dropTable('licencas',                { ifExists: true, cascade: true });
  pgm.dropTable('tenants',                 { ifExists: true, cascade: true });
  pgm.dropTable('planos_assinatura',       { ifExists: true, cascade: true });
};
