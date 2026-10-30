'use strict';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET não definido. Definir a variável de ambiente JWT_SECRET antes de iniciar.');
  process.exit(1);
}

const JWT_SECRET_EFFECTIVE = JWT_SECRET;
const JWT_EXPIRY = '8h';

function gerarToken(payload) {
  return jwt.sign(payload, JWT_SECRET_EFFECTIVE, { expiresIn: JWT_EXPIRY });
}

function isUUID(val) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

function validarUUID(paramName) {
  return (req, res, next) => {
    if (!isUUID(req.params[paramName])) {
      return res.status(400).json({ erro: `${paramName} inválido` });
    }
    next();
  };
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET_EFFECTIVE);
    req.user = decoded;
    req.tenantId = decoded.tenantId || null;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado' });
    }
    return res.status(401).json({ erro: 'Token inválido' });
  }
}

function requerNivel(niveis) {
  return (req, res, next) => {
    if (!niveis.includes(req.user.nivel_acesso)) {
      return res.status(403).json({ erro: 'Permissão insuficiente' });
    }
    next();
  };
}

module.exports = {
  JWT_SECRET_EFFECTIVE,
  JWT_EXPIRY,
  gerarToken,
  isUUID,
  validarUUID,
  authMiddleware,
  requerNivel,
};
