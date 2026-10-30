'use strict';

let _io = null;

function init(io) {
  _io = io;
}

function broadcast(evento, dados, tenantId) {
  if (!_io) return;
  if (tenantId) {
    _io.to(`tenant:${tenantId}`).emit(evento, dados);
  } else {
    // M-06 fix: sem tenantId, NÃO emitir para todos — registar aviso e ignorar
    // para evitar fuga de dados entre tenants
    console.warn(`[broadcast] Evento '${evento}' ignorado: tenantId em falta. Passar sempre tenantId para evitar fuga cross-tenant.`);
  }
}

module.exports = { init, broadcast };
