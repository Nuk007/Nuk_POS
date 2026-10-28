// Nuk_POS — Base de dados PostgreSQL
// Arquitectura: igual ao ATC46/AviationMoney (Node + Express + pg)

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool PostgreSQL:', err);
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Funcionários (staff do sistema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS funcionarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome VARCHAR(200) NOT NULL,
        email VARCHAR(200) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        cargo VARCHAR(100),
        nivel_acesso VARCHAR(20) DEFAULT 'OPERADOR' CHECK (nivel_acesso IN ('ADMIN','GERENTE','OPERADOR')),
        salario NUMERIC(12,2) DEFAULT 0,
        media_avaliacao NUMERIC(3,2) DEFAULT 0,
        total_avaliacoes INTEGER DEFAULT 0,
        ativo BOOLEAN DEFAULT true,
        dois_fatores BOOLEAN DEFAULT false,
        ultimo_acesso TIMESTAMPTZ,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Clientes
    await client.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome VARCHAR(200) NOT NULL,
        telefone VARCHAR(20) UNIQUE,
        email VARCHAR(200) UNIQUE,
        provincia VARCHAR(100),
        nif VARCHAR(20),
        password_hash VARCHAR(255),
        nivel_fidelizacao VARCHAR(10) DEFAULT 'BRONZE' CHECK (nivel_fidelizacao IN ('BRONZE','PRATA','OURO','PLATINA')),
        saldo_carteira NUMERIC(15,2) DEFAULT 0,
        nukcoin_saldo NUMERIC(15,2) DEFAULT 0,
        estrelas INTEGER DEFAULT 0,
        pontos INTEGER DEFAULT 50,
        referido_por UUID REFERENCES clientes(id),
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Adicionar colunas a clientes existentes (migração segura)
    await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS provincia VARCHAR(100)`);
    await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nukcoin_saldo NUMERIC(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS estrelas INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pontos INTEGER DEFAULT 50`);
    await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS referido_por UUID REFERENCES clientes(id)`);

    // Mesas
    await client.query(`
      CREATE TABLE IF NOT EXISTS mesas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        numero VARCHAR(10) UNIQUE NOT NULL,
        capacidade INTEGER DEFAULT 4,
        zona VARCHAR(50),
        status VARCHAR(20) DEFAULT 'LIVRE' CHECK (status IN ('LIVRE','OCUPADA','RESERVADA','LIMPEZA','MANUTENCAO')),
        ultima_atividade TIMESTAMPTZ,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Produtos
    await client.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome VARCHAR(200) NOT NULL,
        descricao TEXT,
        categoria VARCHAR(30) CHECK (categoria IN ('CHURRASCO','PEIXE','BEBIDA','SOBREMESA','ACOMPANHAMENTO','COCKTAIL','ENTRADA','SHISHA')),
        preco NUMERIC(10,2) NOT NULL,
        disponivel BOOLEAN DEFAULT true,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Pedidos
    await client.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mesa_id UUID REFERENCES mesas(id),
        cliente_id UUID REFERENCES clientes(id),
        funcionario_id UUID REFERENCES funcionarios(id),
        status VARCHAR(20) DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','EM_PREPARO','PRONTO','FECHADO','CANCELADO')),
        total NUMERIC(15,2) DEFAULT 0,
        desconto NUMERIC(15,2) DEFAULT 0,
        observacoes TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pedidos_mesa ON pedidos(mesa_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pedidos_data ON pedidos(criado_em)`);

    // Itens de pedido
    await client.query(`
      CREATE TABLE IF NOT EXISTS itens_pedido (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        produto_id UUID NOT NULL REFERENCES produtos(id),
        quantidade NUMERIC(8,2) NOT NULL,
        preco_unitario NUMERIC(10,2) NOT NULL,
        status_cozinha VARCHAR(20) DEFAULT 'AGUARDANDO' CHECK (status_cozinha IN ('AGUARDANDO','PREPARANDO','PRONTO','ENTREGUE')),
        observacoes VARCHAR(300),
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_itens_pedido ON itens_pedido(pedido_id)`);

    // Quartos
    await client.query(`
      CREATE TABLE IF NOT EXISTS quartos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        numero VARCHAR(10) UNIQUE NOT NULL,
        tipo VARCHAR(20) CHECK (tipo IN ('STANDARD','SUPERIOR','SUITE','SUITE_PRESIDENCIAL','VIP_EXECUTIVO')),
        andar INTEGER DEFAULT 0,
        preco_2h NUMERIC(10,2) NOT NULL,
        preco_pernoite NUMERIC(10,2) NOT NULL,
        preco_diaria NUMERIC(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'DISPONIVEL' CHECK (status IN ('DISPONIVEL','OCUPADO','LIMPEZA','MANUTENCAO','BLOQUEADO')),
        descricao TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Reservas
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quarto_id UUID NOT NULL REFERENCES quartos(id),
        cliente_id UUID REFERENCES clientes(id),
        nome_hospede VARCHAR(200),
        fracao VARCHAR(20) CHECK (fracao IN ('DUAS_HORAS','PERNOITE','DIARIA')),
        checkin TIMESTAMPTZ NOT NULL,
        checkout TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) DEFAULT 'CONFIRMADA' CHECK (status IN ('CONFIRMADA','CHECKIN','CHECKOUT','CANCELADA','NO_SHOW')),
        valor_total NUMERIC(10,2) NOT NULL,
        observacoes TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_reservas_quarto ON reservas(quarto_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reservas_checkin ON reservas(checkin)`);

    // Solicitações de hospedagem (portal do cliente — sem quarto atribuído ainda)
    await client.query(`
      CREATE TABLE IF NOT EXISTS solicitacoes_hospedagem (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id UUID REFERENCES clientes(id),
        nome_responsavel VARCHAR(200),
        telefone_contacto VARCHAR(30),
        tipo_fracao VARCHAR(20) CHECK (tipo_fracao IN ('DUAS_HORAS','PERNOITE','DIARIA')),
        quantidade_quartos INTEGER NOT NULL DEFAULT 1,
        status VARCHAR(20) DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','CONFIRMADA','CANCELADA')),
        observacoes TEXT,
        reserva_id UUID REFERENCES reservas(id),
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_solicitacoes_status ON solicitacoes_hospedagem(status)`);

    // Stock (ingredientes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome VARCHAR(200) NOT NULL,
        categoria VARCHAR(30) CHECK (categoria IN ('CARNE','PEIXE','VEGETAL','TEMPERO','BEBIDA','CARVAO','LIMPEZA','OUTRO')),
        stock_atual NUMERIC(10,3) DEFAULT 0,
        stock_minimo NUMERIC(10,3) DEFAULT 0,
        stock_ideal NUMERIC(10,3) DEFAULT 0,
        unidade VARCHAR(5) CHECK (unidade IN ('g','kg','ml','L','un')),
        custo_unitario NUMERIC(10,4),
        fornecedor VARCHAR(200),
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Movimentos de Nuk-Coin
    await client.query(`
      CREATE TABLE IF NOT EXISTS movimentos_nukcoin (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id UUID NOT NULL REFERENCES clientes(id),
        tipo VARCHAR(20) CHECK (tipo IN ('CARREGAMENTO','CONSUMO','ESTORNO','BONUS')),
        valor NUMERIC(15,2) NOT NULL,
        saldo_antes NUMERIC(15,2),
        saldo_depois NUMERIC(15,2),
        descricao TEXT,
        pedido_id UUID REFERENCES pedidos(id),
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nukcoin_cliente ON movimentos_nukcoin(cliente_id)`);

    // Movimentos de stock
    await client.query(`
      CREATE TABLE IF NOT EXISTS movimentos_stock (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        stock_item_id UUID NOT NULL REFERENCES stock_items(id),
        tipo VARCHAR(20) CHECK (tipo IN ('VENDA','COMPRA','AJUSTE','DESPERDICIO','INVENTARIO')),
        quantidade NUMERIC(10,3) NOT NULL,
        quantidade_antes NUMERIC(10,3),
        motivo TEXT,
        operador_id UUID,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_mov_stock_item ON movimentos_stock(stock_item_id)`);

    // Faturas
    await client.query(`
      CREATE TABLE IF NOT EXISTS faturas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id UUID UNIQUE REFERENCES pedidos(id),
        reserva_id UUID REFERENCES reservas(id),
        cliente_id UUID REFERENCES clientes(id),
        serie VARCHAR(5) DEFAULT 'FT',
        ano INTEGER NOT NULL,
        sequencial INTEGER NOT NULL,
        numero_fatura VARCHAR(30) UNIQUE NOT NULL,
        nif_cliente VARCHAR(20),
        nome_cliente VARCHAR(200),
        total_sem_iva NUMERIC(15,2) NOT NULL,
        iva NUMERIC(15,2) NOT NULL,
        total NUMERIC(15,2) NOT NULL,
        taxa_iva NUMERIC(5,2) DEFAULT 14,
        hash_assinatura VARCHAR(64),
        emitida_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(serie, ano, sequencial)
      )
    `);

    // Avaliacoes de staff
    await client.query(`
      CREATE TABLE IF NOT EXISTS avaliacoes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id UUID NOT NULL REFERENCES pedidos(id),
        funcionario_id UUID NOT NULL REFERENCES funcionarios(id),
        nota INTEGER CHECK (nota BETWEEN 1 AND 5),
        comentario TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(pedido_id, funcionario_id)
      )
    `);

    // Chamadas de staff
    await client.query(`
      CREATE TABLE IF NOT EXISTS chamadas_staff (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mesa_id UUID NOT NULL REFERENCES mesas(id),
        funcionario_id UUID REFERENCES funcionarios(id),
        motivo VARCHAR(200),
        solicitado_em TIMESTAMPTZ DEFAULT NOW(),
        atendido_em TIMESTAMPTZ,
        tempo_resposta_seg INTEGER
      )
    `);

    // Configurações do sistema
    await client.query(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        chave VARCHAR(100) PRIMARY KEY,
        valor TEXT NOT NULL,
        descricao TEXT,
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Refresh tokens
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        funcionario_id UUID NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        token VARCHAR(500) UNIQUE NOT NULL,
        expira_em TIMESTAMPTZ NOT NULL,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('✅ Base de dados inicializada com sucesso');
    await seedDB(pool);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao inicializar base de dados:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function seedDB(pool) {
  const bcrypt = require('bcryptjs');

  // ADMIN
  const existeAdmin = await pool.query(`SELECT id FROM funcionarios WHERE email = 'admin@nukpos.ao' LIMIT 1`);
  if (existeAdmin.rows.length === 0) {
    const hash = await bcrypt.hash('Admin@NukPOS25!', 12);
    await pool.query(`
      INSERT INTO funcionarios (nome, email, password_hash, cargo, nivel_acesso, salario)
      VALUES ('Administrador', 'admin@nukpos.ao', $1, 'Administrador', 'ADMIN', 450000)
    `, [hash]);
    console.log('👤 Admin criado: admin@nukpos.ao / Admin@NukPOS25!');
  }

  // Mesas
  const existeMesa = await pool.query(`SELECT id FROM mesas LIMIT 1`);
  if (existeMesa.rows.length === 0) {
    const mesas = [
      ['M01', 4, 'Esplanada'], ['M02', 4, 'Esplanada'], ['M03', 6, 'Esplanada'],
      ['M04', 4, 'Esplanada'], ['M05', 2, 'Esplanada'], ['M06', 8, 'Salão'],
      ['M07', 4, 'Salão'], ['M08', 4, 'Salão'], ['M09', 6, 'Salão'],
      ['M10', 4, 'Salão'], ['P01', 6, 'Piscina'], ['P02', 4, 'Piscina'],
    ];
    for (const [num, cap, zona] of mesas) {
      await pool.query(`INSERT INTO mesas (numero, capacidade, zona) VALUES ($1, $2, $3)`, [num, cap, zona]);
    }
    console.log('🍽️  Mesas criadas');
  }

  // Produtos
  const existeProd = await pool.query(`SELECT id FROM produtos LIMIT 1`);
  if (existeProd.rows.length === 0) {
    const produtos = [
      ['Picanha Angus', 'Churrasco premium de picanha angus', 'CHURRASCO', 4500],
      ['Frango no Churrasco', 'Frango inteiro na brasa', 'CHURRASCO', 3200],
      ['Costeleta de Porco', 'Costeleta grelhada com molho', 'CHURRASCO', 3800],
      ['Gambas Grelhadas', 'Gambas frescas grelhadas com alho', 'PEIXE', 5200],
      ['Salada Mista', 'Salada com legumes frescos', 'ACOMPANHAMENTO', 1200],
      ['Batatas Fritas', 'Batatas fritas crocantes', 'ACOMPANHAMENTO', 800],
      ['Cuca 33cl', 'Cerveja Cuca garrafa 33cl', 'BEBIDA', 600],
      ['Vinho da Casa', 'Vinho tinto/branco 75cl', 'BEBIDA', 3500],
      ['Coca-Cola', 'Refrigerante Coca-Cola lata', 'BEBIDA', 400],
      ['Água Mineral', 'Água mineral 50cl', 'BEBIDA', 300],
      ['Cocktail Tropical', 'Cocktail da casa com frutas tropicais', 'COCKTAIL', 1800],
      ['Shisha', 'Narguilé com sabor à escolha', 'SHISHA', 2500],
    ];
    for (const [nome, desc, cat, preco] of produtos) {
      await pool.query(
        `INSERT INTO produtos (nome, descricao, categoria, preco) VALUES ($1, $2, $3, $4)`,
        [nome, desc, cat, preco]
      );
    }
    console.log('🍖 Produtos criados');
  }

  // Quartos
  const existeQuarto = await pool.query(`SELECT id FROM quartos LIMIT 1`);
  if (existeQuarto.rows.length === 0) {
    const quartos = [
      ['Q01', 'STANDARD', 1, 18000, 22000, 30000],
      ['Q02', 'STANDARD', 1, 18000, 22000, 30000],
      ['Q03', 'STANDARD', 1, 18000, 22000, 30000],
      ['Q04', 'SUPERIOR', 2, 25000, 30000, 40000],
      ['Q05', 'SUPERIOR', 2, 25000, 30000, 40000],
      ['Q06', 'SUPERIOR', 2, 25000, 30000, 40000],
      ['Q07', 'SUITE', 3, 40000, 50000, 65000],
      ['Q08', 'SUITE', 3, 40000, 50000, 65000],
      ['Q09', 'SUITE_PRESIDENCIAL', 4, 80000, 95000, 120000],
      ['Q10', 'VIP_EXECUTIVO', 3, 60000, 75000, 95000],
    ];
    for (const [num, tipo, andar, p2h, pp, pd] of quartos) {
      await pool.query(
        `INSERT INTO quartos (numero, tipo, andar, preco_2h, preco_pernoite, preco_diaria) VALUES ($1,$2,$3,$4,$5,$6)`,
        [num, tipo, andar, p2h, pp, pd]
      );
    }
    console.log('🛏️  Quartos criados');
  }

  // Configurações
  const configs = [
    ['nome_estabelecimento', 'Nuk_POS', 'Nome do estabelecimento'],
    ['iva_padrao', '14', 'Taxa de IVA padrão (%)'],
    ['moeda', 'Kz', 'Moeda utilizada'],
    ['timezone', 'Africa/Luanda', 'Fuso horário'],
    ['versao', '1.0.0', 'Versão do sistema'],
    ['nukcoin_desconto_pct', '10', 'Desconto (%) ao pagar com Nuk-Coin'],
    ['estrelas_minimo_consumo', '25000', 'Valor mínimo de consumo (Kz) para ganhar 1 estrela'],
    ['estrelas_para_desconto', '5', 'Número de estrelas para activar desconto'],
    ['desconto_estrelas_pct', '20', 'Desconto (%) ao atingir o número de estrelas'],
    ['desconto_estrelas_limite', '25000', 'Consumo máximo (Kz) que beneficia do desconto de estrelas'],
    ['pontos_boas_vindas', '50', 'Pontos atribuídos ao novo cliente no cadastro'],
    ['portal_url', '', 'URL pública do portal do cliente (para QR Code)'],
  ];
  for (const [chave, valor, desc] of configs) {
    await pool.query(
      `INSERT INTO configuracoes (chave, valor, descricao) VALUES ($1,$2,$3) ON CONFLICT (chave) DO NOTHING`,
      [chave, valor, desc]
    );
  }
}

module.exports = { pool, initDB };
