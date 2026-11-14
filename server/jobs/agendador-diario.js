'use strict';
/** Agendador das tarefas diárias (5 em 5 min): resumo diário para o dono. Só arranca fora dos testes (app.js). */
const { logger } = require('../monitoring');

let timer = null;
function iniciar(intervaloMs = 5 * 60000) {
  if (timer) return timer;
  const volta = () => require('../services/resumo-diario.service').processarTick()
    .catch(err => logger.error({ err }, 'Agendador diário falhou'));
  timer = setInterval(volta, intervaloMs);
  timer.unref();
  setTimeout(volta, 60000).unref(); // primeira volta um minuto depois do arranque
  return timer;
}
function parar() { if (timer) clearInterval(timer); timer = null; }
module.exports = { iniciar, parar };
