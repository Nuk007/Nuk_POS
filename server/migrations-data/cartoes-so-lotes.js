'use strict';
/**
 * Regra do dono (20/11/2026): nenhum código de cartão de consumo é gerado fora da via do Administrador.
 * A única via é o lote (Configurações → Cartões de consumo); a BD recusa qualquer cartão novo sem lote.
 * Partilhado pela migração 1752400000000 e por db.js.
 */
module.exports = [
  `CREATE OR REPLACE FUNCTION nukpos_cartao_so_por_lote() RETURNS trigger AS $$
   BEGIN
     IF NEW.lote_id IS NULL THEN
       RAISE EXCEPTION 'Os códigos de cartão só são gerados pelo Administrador, por lotes' USING ERRCODE = 'P0001', HINT = 'GERAR_SO_ADMIN';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_cartao_so_por_lote ON cartoes_consumo`,
  `CREATE TRIGGER trg_cartao_so_por_lote BEFORE INSERT ON cartoes_consumo FOR EACH ROW EXECUTE FUNCTION nukpos_cartao_so_por_lote()`,
];
