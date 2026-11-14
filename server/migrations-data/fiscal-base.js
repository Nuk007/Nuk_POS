'use strict';
/**
 * Base do módulo fiscal (preparação para a certificação AGT, decisão do dono de 14/11/2026).
 * Partilhado pela migração 1750600000000 e pelo espelho em db.js. Todas as instruções são idempotentes.
 *
 *  - Numeração por estabelecimento: a 2.ª casa já não falha com «Factura duplicada» ao emitir a sua FT n.º 1.
 *  - Tipos de documento FT (factura), FR (factura-recibo) e NC (nota de crédito, sempre ligada ao documento de origem).
 *  - Linhas do documento (produto, quantidade, preço, taxa de IVA, motivo de isenção).
 *  - Documentos fiscais imutáveis: a base de dados recusa UPDATE e DELETE. Corrige-se com nota de crédito.
 *    Única excepção: apagar o próprio estabelecimento (cascata a partir de `tenants`).
 */
const SEM_TENANT = "'00000000-0000-0000-0000-000000000000'::uuid";

module.exports = [
  // Novas colunas do documento
  `ALTER TABLE faturas ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(2) NOT NULL DEFAULT 'FT'`,
  `ALTER TABLE faturas ADD COLUMN IF NOT EXISTS documento_origem_id UUID REFERENCES faturas(id)`,
  `ALTER TABLE faturas ADD COLUMN IF NOT EXISTS motivo TEXT`,
  `ALTER TABLE faturas ADD COLUMN IF NOT EXISTS total_bruto NUMERIC(15,2)`,
  `ALTER TABLE faturas ADD COLUMN IF NOT EXISTS desconto NUMERIC(15,2) NOT NULL DEFAULT 0`,
  // Sem FK de propósito: um ON DELETE SET NULL seria um UPDATE, que o trigger de imutabilidade recusa
  `ALTER TABLE faturas ADD COLUMN IF NOT EXISTS emitida_por UUID`,
  // A assinatura RSA (base64) não cabe em 64 caracteres
  `ALTER TABLE faturas ALTER COLUMN hash_assinatura TYPE TEXT`,
  `DO $$ BEGIN
     ALTER TABLE faturas ADD CONSTRAINT faturas_tipo_documento_check CHECK (tipo_documento IN ('FT','FR','NC'));
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     ALTER TABLE faturas ADD CONSTRAINT faturas_nc_origem_check CHECK (tipo_documento <> 'NC' OR documento_origem_id IS NOT NULL);
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // A unicidade antiga era GLOBAL (numero_fatura, serie+ano+sequencial, pedido_id): sai toda e passa a índices por estabelecimento
  `DO $$ DECLARE r record; BEGIN
     FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'faturas'::regclass AND contype = 'u' LOOP
       EXECUTE format('ALTER TABLE faturas DROP CONSTRAINT %I', r.conname);
     END LOOP;
   END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_faturas_tenant_serie_seq ON faturas (COALESCE(tenant_id, ${SEM_TENANT}), serie, ano, sequencial)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_faturas_tenant_numero ON faturas (COALESCE(tenant_id, ${SEM_TENANT}), numero_fatura)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_faturas_nc_origem ON faturas (documento_origem_id) WHERE tipo_documento = 'NC'`,
  `CREATE INDEX IF NOT EXISTS idx_faturas_pedido ON faturas (pedido_id)`,
  `CREATE INDEX IF NOT EXISTS idx_faturas_reserva ON faturas (reserva_id)`,

  // Linhas do documento (valores em Kz com IVA incluído; total_sem_iva + iva = total)
  `CREATE TABLE IF NOT EXISTS fatura_linhas (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     fatura_id UUID NOT NULL REFERENCES faturas(id) ON DELETE CASCADE,
     tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
     ordem INTEGER NOT NULL,
     produto_id UUID,
     descricao VARCHAR(250) NOT NULL,
     quantidade NUMERIC(10,2) NOT NULL CHECK (quantidade > 0),
     preco_unitario NUMERIC(15,2) NOT NULL CHECK (preco_unitario >= 0),
     taxa_iva NUMERIC(5,2) NOT NULL CHECK (taxa_iva >= 0),
     motivo_isencao VARCHAR(250),
     total NUMERIC(15,2) NOT NULL,
     total_sem_iva NUMERIC(15,2) NOT NULL,
     iva NUMERIC(15,2) NOT NULL,
     UNIQUE (fatura_id, ordem),
     CHECK (taxa_iva > 0 OR motivo_isencao IS NOT NULL)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_fatura_linhas_fatura ON fatura_linhas (fatura_id)`,

  // Imutabilidade
  `CREATE OR REPLACE FUNCTION nukpos_documento_fiscal_imutavel() RETURNS trigger AS $$
   BEGIN
     -- Apagar o estabelecimento inteiro: a cascata vem de tenants e a linha do tenant já não existe
     IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1
        AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
       RETURN OLD;
     END IF;
     RAISE EXCEPTION 'Documento fiscal não pode ser alterado nem apagado: corrija com uma nota de crédito'
       USING ERRCODE = 'P0001', HINT = 'DOCUMENTO_FISCAL_IMUTAVEL';
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_faturas_imutavel ON faturas`,
  `CREATE TRIGGER trg_faturas_imutavel BEFORE UPDATE OR DELETE ON faturas
     FOR EACH ROW EXECUTE FUNCTION nukpos_documento_fiscal_imutavel()`,
  `DROP TRIGGER IF EXISTS trg_fatura_linhas_imutavel ON fatura_linhas`,
  `CREATE TRIGGER trg_fatura_linhas_imutavel BEFORE UPDATE OR DELETE ON fatura_linhas
     FOR EACH ROW EXECUTE FUNCTION nukpos_documento_fiscal_imutavel()`,
];
