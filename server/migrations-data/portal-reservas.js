'use strict';
/**
 * Pedidos de reserva de quarto pelo portal com o preço real (14/11/2026).
 * A solicitação de hospedagem passa a guardar o tipo de quarto, o serviço (Hora/Noite/Diária), o início,
 * o valor calculado pelo servidor e a reserva criada quando a equipa a confirma.
 * Partilhado pela migração 1751700000000 e por db.js.
 */
module.exports = [
  `ALTER TABLE solicitacoes_portal ADD COLUMN IF NOT EXISTS tipo_quarto VARCHAR(40)`,
  `ALTER TABLE solicitacoes_portal ADD COLUMN IF NOT EXISTS fracao VARCHAR(12)`,
  `ALTER TABLE solicitacoes_portal ADD COLUMN IF NOT EXISTS inicio TIMESTAMPTZ`,
  `ALTER TABLE solicitacoes_portal ADD COLUMN IF NOT EXISTS valor_estimado NUMERIC(12,2)`,
  `ALTER TABLE solicitacoes_portal ADD COLUMN IF NOT EXISTS reserva_id UUID REFERENCES reservas(id) ON DELETE SET NULL`,
];
