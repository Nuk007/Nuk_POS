'use strict';
/**
 * Jest setup — mock do módulo db.js para evitar ligação real à PostgreSQL.
 * Os testes usam um pool falso cujo comportamento é controlado por jest.fn().
 */

// Pool mock partilhado por todos os testes
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
};

// Mock do cliente de transacção
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
mockPool.connect.mockResolvedValue(mockClient);

jest.mock('../server/db', () => ({
  pool: mockPool,
  initDB: jest.fn().mockResolvedValue(),
}));

// Mock do broadcast para não tentar ligar ao Socket.io
jest.mock('../server/middleware/broadcast', () => ({
  init: jest.fn(),
  broadcast: jest.fn(),
}));

// Mock do websocket
jest.mock('../server/websocket', () => ({
  initWebSocket: jest.fn(),
}));

// Mock do módulo saas — verificarLicencaTenant e resolverTenant passam sempre
jest.mock('../server/saas', () => {
  const express = require('express');
  const passThrough = (req, res, next) => next();
  return {
    router: express.Router(),
    verificarLicencaTenant: passThrough,
    resolverTenant: passThrough,
    resolverTenantPublico: passThrough,
  };
});

// Expõe o mockPool e mockClient globalmente para uso nos testes
global.mockPool = mockPool;
global.mockClient = mockClient;

// JWT_SECRET necessário para o middleware de auth
process.env.JWT_SECRET = 'test-secret-jwt-jest-nukpos';
process.env.NODE_ENV = 'test';

afterEach(() => {
  jest.clearAllMocks();
  // Restaura o comportamento padrão do connect após cada teste
  mockPool.connect.mockResolvedValue(mockClient);
});
