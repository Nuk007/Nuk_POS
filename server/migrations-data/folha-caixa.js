'use strict';
/**
 * Folha de Caixa diária (21/11/2026, a partir da folha em papel do Clube 3D Resort). Partilhado pela migração
 * 1753100000000 e por db.js (corre em cada arranque: tudo idempotente).
 *  - compras_pontuais.area / despesas.area: área da saída (Esplanada/Bar, Cozinha, Piscina, Hotel, Técnica, Diversos),
 *    valor da lista configurável AREA_SAIDA do estabelecimento (sem CHECK na BD, como as outras listas).
 *  - compras_pontuais.fornecedor_nif / documento: NIF e n.º da factura/recibo do fornecedor (conferência com o papel).
 */
module.exports = [
  `ALTER TABLE compras_pontuais ADD COLUMN IF NOT EXISTS area VARCHAR(30)`,
  `ALTER TABLE compras_pontuais ADD COLUMN IF NOT EXISTS fornecedor_nif VARCHAR(20)`,
  `ALTER TABLE compras_pontuais ADD COLUMN IF NOT EXISTS documento VARCHAR(60)`,
  `ALTER TABLE despesas ADD COLUMN IF NOT EXISTS area VARCHAR(30)`,
  `CREATE INDEX IF NOT EXISTS idx_compras_pontuais_dia ON compras_pontuais (tenant_id, criado_em)`,
];
