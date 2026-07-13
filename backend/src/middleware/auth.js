'use strict';

const crypto = require('crypto');
const { verifyToken } = require('../config/jwt');
const { getDb } = require('../config/db');

function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = header.slice(7);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // Verificar que la sesión existe y no expiró
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = getDb().prepare(
    "SELECT id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')"
  ).get(tokenHash);

  if (!session) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  req.user = { id: payload.id, username: payload.username, role: payload.role };
  next();
}

module.exports = { authenticate };
