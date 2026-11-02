'use strict';
/**
 * Migração de dados (corre uma só vez, não altera regras):
 *  1. Estabelecimentos com um único utilizador activo: o titular fica com os perfis «vender» e «arrumar quartos»
 *     (antes não existiam, e quem é o único utilizador ficava sem poder vender). Nos outros, o titular escolhe.
 *  2. Reservas feitas pelo fluxo antigo (que marcava o quarto OCUPADO ao reservar): as que estão em curso passam a
 *     CHECKIN (o quarto mostra a hora em que fica livre); as já terminadas mandam o quarto arrumar; as futuras
 *     deixam o quarto DISPONÍVEL com a ★ de reservado.
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE funcionarios f SET pode_vender_quartos = true, arruma_quartos = true, atualizado_em = NOW()
    WHERE f.titular AND f.ativo AND f.tenant_id IS NOT NULL
      AND (SELECT COUNT(*) FROM funcionarios x WHERE x.tenant_id = f.tenant_id AND x.ativo) = 1;

    UPDATE reservas r SET status = 'CHECKIN', atualizado_em = NOW()
    FROM quartos q
    WHERE q.id = r.quarto_id AND q.status = 'OCUPADO' AND r.status = 'CONFIRMADA' AND r.checkin <= NOW() AND r.checkout > NOW()
      AND NOT EXISTS (SELECT 1 FROM reservas x WHERE x.quarto_id = q.id AND x.status = 'CHECKIN');

    WITH velhas AS (
      UPDATE reservas r SET status = 'CHECKOUT', atualizado_em = NOW()
      FROM quartos q
      WHERE q.id = r.quarto_id AND q.status = 'OCUPADO' AND r.status = 'CONFIRMADA' AND r.checkout <= NOW()
        AND NOT EXISTS (SELECT 1 FROM reservas x WHERE x.quarto_id = q.id AND x.status = 'CHECKIN')
      RETURNING r.quarto_id, r.tenant_id
    ), ids AS (SELECT DISTINCT quarto_id, tenant_id FROM velhas WHERE tenant_id IS NOT NULL),
    tarefas AS (
      INSERT INTO quarto_limpezas (tenant_id, quarto_id, origem, prazo_em)
      SELECT tenant_id, quarto_id, 'ABERTO', NOW() + interval '30 minutes' FROM ids
      ON CONFLICT (quarto_id) WHERE limpo_em IS NULL DO NOTHING RETURNING quarto_id
    )
    UPDATE quartos SET status = 'LIMPEZA', atualizado_em = NOW() WHERE id IN (SELECT quarto_id FROM ids);

    UPDATE quartos q SET status = 'DISPONIVEL', atualizado_em = NOW()
    WHERE q.status = 'OCUPADO'
      AND NOT EXISTS (SELECT 1 FROM reservas x WHERE x.quarto_id = q.id AND x.status = 'CHECKIN')
      AND EXISTS (SELECT 1 FROM reservas y WHERE y.quarto_id = q.id AND y.status = 'CONFIRMADA' AND y.checkin > NOW());`);
};
exports.down = () => {};
