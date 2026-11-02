'use strict';
/** Agendador dos quartos: avisos de arrumação (5 min antes do fim), fecho de ocupações e escalada para a chefia (30 min). */
const { processarTick } = require('../services/quartos-vendas.service');
const { logger } = require('../monitoring');

let timer = null;
function iniciar(intervaloMs = 30000) {
  if (timer) return timer;
  const volta = () => processarTick().catch(err => logger.error({ err }, 'Agendador de quartos falhou'));
  timer = setInterval(volta, intervaloMs);
  timer.unref();
  volta();
  return timer;
}
function parar() { if (timer) clearInterval(timer); timer = null; }
module.exports = { iniciar, parar };
