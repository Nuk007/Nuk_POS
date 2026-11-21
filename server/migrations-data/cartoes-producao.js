'use strict';
/**
 * Produção de cartões a partir do Caixa (21/11/2026, pedido do dono).
 * Partilhado pela migração 1753000000000 e por db.js (corre em cada arranque: idempotente).
 *  - funcionarios.imprime_cartoes: perfil dado pelo Administrador a quem pode autorizar a impressão de lotes
 *    (o Administrador pode sempre);
 *  - cartoes_lotes.pedido_por: quem estava no Caixa quando o lote foi pedido (criado_por = quem autorizou).
 */
module.exports = [
  `ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS imprime_cartoes BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE cartoes_lotes ADD COLUMN IF NOT EXISTS pedido_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL`,
];
