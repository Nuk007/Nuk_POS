'use strict';
/**
 * Balcão e contas de mesa/quarto (20/11/2026, regras do dono). Partilhado pela migração 1752600000000 e por db.js
 * (corre em cada arranque: tudo idempotente).
 *  - Um pedido nunca é ao mesmo tempo de uma mesa e de um quarto (o consumo do quarto nunca vai para a mesa).
 *    NOT VALID: vale para as linhas novas e alteradas sem bloquear o arranque por causa de dados antigos.
 *  - Categoria PISCINA nas categorias de produto dos estabelecimentos que já têm a lista semeada (os novos recebem-na
 *    dos padrões em listas.service).
 */
module.exports = [
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_mesa_ou_quarto') THEN
       ALTER TABLE pedidos ADD CONSTRAINT pedidos_mesa_ou_quarto CHECK (mesa_id IS NULL OR quarto_id IS NULL) NOT VALID;
     END IF;
   END $$`,
  `INSERT INTO listas_opcoes (tenant_id, lista, valor, ordem)
   SELECT t.tenant_id, 'CATEGORIA_PRODUTO', 'PISCINA', COALESCE(MAX(l.ordem), 0) + 1
     FROM (SELECT DISTINCT tenant_id FROM listas_opcoes WHERE lista = 'CATEGORIA_PRODUTO') t
     JOIN listas_opcoes l ON l.tenant_id = t.tenant_id AND l.lista = 'CATEGORIA_PRODUTO'
    WHERE NOT EXISTS (SELECT 1 FROM listas_opcoes x WHERE x.tenant_id = t.tenant_id AND x.lista = 'CATEGORIA_PRODUTO' AND x.valor = 'PISCINA')
    GROUP BY t.tenant_id
   ON CONFLICT DO NOTHING`,
];
