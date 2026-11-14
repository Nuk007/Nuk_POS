'use strict';
/**
 * Saúde do serviço para /api/health e para o vigilante externo (GitHub Actions, .github/workflows/uptime.yml).
 * Além da base de dados, conta se o arranque (initDB) terminou e se o agendador dos quartos está vivo:
 * a 14/11/2026 um arranque falhado deixou o agendador parado sem nenhum sinal para fora.
 */
const { pool } = require('../db');

const estado = { arranque: 'a iniciar', arranqueEm: null, agendadorUltimo: null, agendadorIntervaloMs: null };

function arranqueOk() { estado.arranque = 'ok'; estado.arranqueEm = new Date(); }
function arranqueFalhou() { estado.arranque = 'erro'; estado.arranqueEm = new Date(); }
function agendadorIniciado(intervaloMs) { estado.agendadorIntervaloMs = intervaloMs; }
function agendadorVolta() { estado.agendadorUltimo = new Date(); }

/** O agendador conta como parado se ficar mais de 4 voltas sem correr (mínimo 2 min). */
function agendadorParado(agora = Date.now()) {
  if (!estado.agendadorIntervaloMs) return null; // não arrancou (testes, ou arranque ainda a correr)
  const limite = Math.max(120000, estado.agendadorIntervaloMs * 4);
  return !estado.agendadorUltimo || agora - estado.agendadorUltimo.getTime() > limite;
}

/** { http, corpo }: 503 se a base de dados não responde, se o arranque falhou ou se o agendador parou. */
async function verificar() {
  const inicio = Date.now();
  let db = 'ok';
  try { await pool.query('SELECT 1'); } catch (e) { db = 'offline'; }
  const latencia = Date.now() - inicio;
  const parado = agendadorParado();
  const problemas = [];
  if (db !== 'ok') problemas.push('base de dados sem resposta');
  if (estado.arranque === 'erro') problemas.push('o arranque (initDB) falhou');
  if (parado === true) problemas.push('o agendador dos quartos parou');
  return {
    http: problemas.length ? 503 : 200,
    corpo: {
      status: problemas.length ? 'degraded' : 'ok',
      problemas,
      db,
      arranque: estado.arranque,
      agendador: parado === null ? 'inactivo' : (parado ? 'parado' : 'ok'),
      agendador_ultimo: estado.agendadorUltimo,
      version: process.env.npm_package_version || '1.0.0',
      env: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime()),
      latency_ms: latencia,
      ts: new Date().toISOString(),
    },
  };
}

module.exports = { verificar, arranqueOk, arranqueFalhou, agendadorIniciado, agendadorVolta, agendadorParado, _estado: estado };
