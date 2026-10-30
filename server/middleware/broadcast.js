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
    _io.emit(evento, dados);
  }
}

module.exports = { init, broadcast };
