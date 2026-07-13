'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-inseguro';
const EXPIRY = '8h';

// Fail-fast en producción: nunca arrancar con un secret débil o por defecto
const isWeakSecret = !process.env.JWT_SECRET || SECRET.length < 32;
if (process.env.NODE_ENV === 'production' && isWeakSecret) {
  console.error('[jwt] FATAL: JWT_SECRET no configurado o demasiado corto (mínimo 32 caracteres)');
  process.exit(1);
}
if (isWeakSecret) {
  console.warn('[jwt] ⚠ JWT_SECRET débil o por defecto — solo aceptable en desarrollo');
}

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRY });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
