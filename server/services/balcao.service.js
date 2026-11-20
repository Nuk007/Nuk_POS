'use strict';
/**
 * Balcão (regra do dono, 20/11/2026): o Balcão só vende bebidas, piscina e a estadia dos quartos.
 * Desde 21/11/2026 é um dos fluxos configuráveis de `fluxos-venda.service` (mesma chave `balcao_categorias`);
 * este módulo fica por compatibilidade com quem o chama.
 */
const fluxos = require('./fluxos-venda.service');

const PADRAO = fluxos.FLUXOS.BALCAO.padrao;
const categorias = (db, tenantId) => fluxos.categorias(db, tenantId, 'BALCAO');
const definir = ({ tenantId, categorias: lista }) => fluxos.definir({ tenantId, fluxo: 'BALCAO', categorias: lista })
  .then(r => ({ categorias: r.categorias }));

module.exports = { categorias, definir, PADRAO };
