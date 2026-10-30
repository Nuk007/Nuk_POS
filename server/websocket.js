'use strict';
const { JWT_SECRET_EFFECTIVE } = require('./middleware/auth');
const jwt = require('jsonwebtoken');

function initWebSocket(io) {
  // Autenticação JWT na ligação WebSocket
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Não autenticado'));
    try {
      socket.user = jwt.verify(token, JWT_SECRET_EFFECTIVE);
      next();
    } catch {
      next(new Error('Token inválido ou expirado'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 WebSocket conectado: ${socket.id} (${socket.user?.email})`);

    // Entrar automaticamente na sala do tenant
    if (socket.user?.tenantId) {
      socket.join(`tenant:${socket.user.tenantId}`);
    }

    // B-03 fix: join_room restrito à sala do próprio tenant do utilizador.
    // Impede que um cliente entre em salas de outros tenants ou salas arbitrárias.
    socket.on('join_room', (room) => {
      const tenantRoom = `tenant:${socket.user?.tenantId}`;
      if (typeof room === 'string' && room === tenantRoom) {
        socket.join(room);
      } else {
        console.warn(`[WS] join_room bloqueado: ${socket.user?.email} tentou entrar em '${room}'`);
      }
    });

    socket.on('leave_room', (room) => {
      // Permitir sair de qualquer sala — não há risco de segurança em deixar uma sala
      if (typeof room === 'string') {
        socket.leave(room);
      }
    });

    socket.on('disconnect', () => {
      console.log('🔌 Cliente WebSocket desconectado:', socket.id);
    });
  });
}

module.exports = { initWebSocket };
