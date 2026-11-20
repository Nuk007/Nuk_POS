'use strict';
/**
 * Livro do caixa à prova de alteração (20/11/2026, regra do dono: todos os movimentos do caixa ficam registados e
 * rastreáveis). Partilhado pela migração 1752200000000 e por db.js (corre em cada arranque: tudo idempotente).
 *
 *  - caixa_movimentos.numero: n.º sequencial por estabelecimento, sem buracos (atribuído por trigger, com advisory lock).
 *  - caixa_movimentos.hash / hash_anterior: cadeia SHA-256 (como a dos documentos fiscais). Mexer num movimento antigo
 *    directamente na base de dados parte a cadeia e a verificação aponta o número.
 *  - Imutabilidade: movimentos e movimentos de cartão não se alteram nem apagam (correcções = movimento contrário);
 *    uma sessão de caixa fechada não muda. Excepções: a cascata ao apagar o estabelecimento e o ON DELETE SET NULL
 *    das chaves estrangeiras (o resto da linha tem de ficar igual).
 */
module.exports = [
  // ── Cadeia ─────────────────────────────────────────────────
  `CREATE OR REPLACE FUNCTION nukpos_caixa_mov_hash(anterior TEXT, numero BIGINT, tenant UUID, sessao UUID, tipo TEXT, metodo TEXT,
       valor NUMERIC, descricao TEXT, criado_por UUID, criado_em TIMESTAMPTZ) RETURNS TEXT AS $$
     SELECT encode(sha256(convert_to(concat_ws('|', COALESCE(anterior, ''), numero::text, tenant::text, sessao::text, tipo, metodo,
       round(valor, 2)::text, COALESCE(descricao, ''), COALESCE(criado_por::text, ''),
       to_char(criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex')
   $$ LANGUAGE sql IMMUTABLE`,
  `ALTER TABLE caixa_movimentos ADD COLUMN IF NOT EXISTS numero BIGINT`,
  `ALTER TABLE caixa_movimentos ADD COLUMN IF NOT EXISTS hash_anterior CHAR(64)`,
  `ALTER TABLE caixa_movimentos ADD COLUMN IF NOT EXISTS hash CHAR(64)`,

  `CREATE OR REPLACE FUNCTION nukpos_caixa_mov_encadear() RETURNS trigger AS $$
   DECLARE n BIGINT; h TEXT;
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtext('caixa_mov:' || NEW.tenant_id::text));
     SELECT m.numero, m.hash INTO n, h FROM caixa_movimentos m
      WHERE m.tenant_id = NEW.tenant_id AND m.numero IS NOT NULL ORDER BY m.numero DESC LIMIT 1;
     NEW.numero := COALESCE(n, 0) + 1;
     NEW.hash_anterior := h;
     NEW.criado_em := COALESCE(NEW.criado_em, NOW());
     NEW.hash := nukpos_caixa_mov_hash(h, NEW.numero, NEW.tenant_id, NEW.sessao_id, NEW.tipo, NEW.metodo, NEW.valor,
                                       NEW.descricao, NEW.criado_por, NEW.criado_em);
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_caixa_mov_encadear ON caixa_movimentos`,
  `CREATE TRIGGER trg_caixa_mov_encadear BEFORE INSERT ON caixa_movimentos FOR EACH ROW EXECUTE FUNCTION nukpos_caixa_mov_encadear()`,

  // Movimentos anteriores a esta versão: selam-se uma vez, pela ordem em que aconteceram
  `DO $$
   DECLARE r RECORD; n BIGINT; h TEXT; t UUID := NULL; novo TEXT;
   BEGIN
     FOR r IN SELECT * FROM caixa_movimentos WHERE numero IS NULL ORDER BY tenant_id, criado_em, id LOOP
       IF t IS DISTINCT FROM r.tenant_id THEN
         t := r.tenant_id; n := NULL; h := NULL;
         SELECT m.numero, m.hash INTO n, h FROM caixa_movimentos m WHERE m.tenant_id = t AND m.numero IS NOT NULL ORDER BY m.numero DESC LIMIT 1;
         n := COALESCE(n, 0);
       END IF;
       n := n + 1;
       novo := nukpos_caixa_mov_hash(h, n, r.tenant_id, r.sessao_id, r.tipo, r.metodo, r.valor, r.descricao, r.criado_por, r.criado_em);
       UPDATE caixa_movimentos SET numero = n, hash_anterior = h, hash = novo WHERE id = r.id;
       h := novo;
     END LOOP;
   END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_mov_tenant_numero ON caixa_movimentos (tenant_id, numero)`,
  `CREATE INDEX IF NOT EXISTS idx_caixa_mov_tenant_data ON caixa_movimentos (tenant_id, criado_em DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_caixa_mov_cartao ON caixa_movimentos (cartao_id) WHERE cartao_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_caixa_mov_pedido ON caixa_movimentos (pedido_id) WHERE pedido_id IS NOT NULL`,

  // ── Imutabilidade ──────────────────────────────────────────
  `CREATE OR REPLACE FUNCTION nukpos_caixa_mov_imutavel() RETURNS trigger AS $$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
     ELSIF OLD.numero IS NULL THEN
       RETURN NEW; -- selagem dos movimentos antigos (uma só vez)
     ELSIF (NEW.tenant_id, NEW.sessao_id, NEW.numero, NEW.tipo, NEW.metodo, NEW.valor, NEW.descricao, NEW.criado_em, NEW.hash, NEW.hash_anterior)
           IS NOT DISTINCT FROM (OLD.tenant_id, OLD.sessao_id, OLD.numero, OLD.tipo, OLD.metodo, OLD.valor, OLD.descricao, OLD.criado_em, OLD.hash, OLD.hash_anterior)
       AND (NEW.criado_por IS NOT DISTINCT FROM OLD.criado_por OR NEW.criado_por IS NULL)
       AND (NEW.pedido_id IS NOT DISTINCT FROM OLD.pedido_id OR NEW.pedido_id IS NULL)
       AND (NEW.cliente_id IS NOT DISTINCT FROM OLD.cliente_id OR NEW.cliente_id IS NULL)
       AND (NEW.cartao_id IS NOT DISTINCT FROM OLD.cartao_id OR NEW.cartao_id IS NULL)
       AND (NEW.compra_id IS NOT DISTINCT FROM OLD.compra_id OR NEW.compra_id IS NULL)
       AND (NEW.despesa_id IS NOT DISTINCT FROM OLD.despesa_id OR NEW.despesa_id IS NULL) THEN
       RETURN NEW; -- ON DELETE SET NULL de uma chave estrangeira
     END IF;
     RAISE EXCEPTION 'Movimento de caixa não pode ser alterado nem apagado: corrija com um movimento contrário'
       USING ERRCODE = 'P0001', HINT = 'CAIXA_MOVIMENTO_IMUTAVEL';
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_caixa_mov_imutavel ON caixa_movimentos`,
  `CREATE TRIGGER trg_caixa_mov_imutavel BEFORE UPDATE OR DELETE ON caixa_movimentos FOR EACH ROW EXECUTE FUNCTION nukpos_caixa_mov_imutavel()`,

  `CREATE OR REPLACE FUNCTION nukpos_caixa_sessao_protegida() RETURNS trigger AS $$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
       RAISE EXCEPTION 'Sessão de caixa não pode ser apagada' USING ERRCODE = 'P0001', HINT = 'CAIXA_SESSAO_PROTEGIDA';
     END IF;
     IF (NEW.tenant_id, NEW.aberta_em, NEW.fundo_inicial) IS DISTINCT FROM (OLD.tenant_id, OLD.aberta_em, OLD.fundo_inicial)
        OR NOT (NEW.aberta_por IS NOT DISTINCT FROM OLD.aberta_por OR NEW.aberta_por IS NULL)
        OR (OLD.fechada_em IS NOT NULL AND (
              (NEW.fechada_em, NEW.esperado, NEW.contado, NEW.diferenca, NEW.observacoes)
                IS DISTINCT FROM (OLD.fechada_em, OLD.esperado, OLD.contado, OLD.diferenca, OLD.observacoes)
              OR NOT (NEW.fechada_por IS NOT DISTINCT FROM OLD.fechada_por OR NEW.fechada_por IS NULL))) THEN
       RAISE EXCEPTION 'Sessão de caixa: abertura e fecho não podem ser alterados' USING ERRCODE = 'P0001', HINT = 'CAIXA_SESSAO_PROTEGIDA';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_caixa_sessao_protegida ON caixa_sessoes`,
  `CREATE TRIGGER trg_caixa_sessao_protegida BEFORE UPDATE OR DELETE ON caixa_sessoes FOR EACH ROW EXECUTE FUNCTION nukpos_caixa_sessao_protegida()`,

  `CREATE OR REPLACE FUNCTION nukpos_mov_cartao_imutavel() RETURNS trigger AS $$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM cartoes_consumo WHERE id = OLD.cartao_id) THEN RETURN OLD; END IF;
     ELSIF (NEW.cartao_id, NEW.tipo, NEW.valor, NEW.saldo_antes, NEW.saldo_depois, NEW.criado_em)
           IS NOT DISTINCT FROM (OLD.cartao_id, OLD.tipo, OLD.valor, OLD.saldo_antes, OLD.saldo_depois, OLD.criado_em)
       AND (NEW.pedido_id IS NOT DISTINCT FROM OLD.pedido_id OR NEW.pedido_id IS NULL) THEN
       RETURN NEW;
     END IF;
     RAISE EXCEPTION 'Movimento de cartão de consumo não pode ser alterado nem apagado' USING ERRCODE = 'P0001', HINT = 'CARTAO_MOVIMENTO_IMUTAVEL';
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_mov_cartao_imutavel ON movimentos_cartao`,
  `CREATE TRIGGER trg_mov_cartao_imutavel BEFORE UPDATE OR DELETE ON movimentos_cartao FOR EACH ROW EXECUTE FUNCTION nukpos_mov_cartao_imutavel()`,
];
