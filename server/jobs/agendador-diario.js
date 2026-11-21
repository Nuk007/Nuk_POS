'use strict';
/** Agendador das tarefas diárias (5 em 5 min): resumo diário para o dono e relatórios automáticos (21/11/2026). Só arranca fora dos testes (app.js). */
const { logger } = require('../monitoring');

let timer = null;
function iniciar(intervaloMs = 5 * 60000) {
  if (timer) return timer;
  const volta = () => {
    require('../services/resumo-diario.service').processarTick()
      .catch(err => logger.error({ err }, 'Agendador diário falhou'));
    require('../services/relatorios-auto.service').processarTick()
      .catch(err => logger.error({ err }, 'Relatórios automáticos falharam'));
  };
  timer = setInterval(volta, intervaloMs);
  timer.unref();
  setTimeout(volta, 60000).unref(); // primeira volta um minuto depois do arranque
  return timer;
}
function parar() { if (timer) clearInterval(timer); timer = null; }
module.exports = { iniciar, parar };
