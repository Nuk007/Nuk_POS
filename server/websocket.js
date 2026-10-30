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

    socket.on('join_room', (room) => {
      // Apenas permitir entrar em salas genéricas (não em salas de outros tenants)
      if (typeof room === 'string' && !room.startsWith('tenant:')) {
        socket.join(room);
      }
    });

    socket.on('leave_room', (room) => {
      if (typeof room === 'string' && !room.startsWith('tenant:')) {
        socket.leave(room);
      }
    });

    socket.on('disconnect', () => {
      console.log('🔌 Cliente WebSocket desconectado:', socket.id);
    });
  });
}

module.exports = { initWebSocket };
