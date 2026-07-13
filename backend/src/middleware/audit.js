'use strict';

const { getDb } = require('../config/db');

function logAction(action, getTarget) {
  return (req, _res, next) => {
    const target = typeof getTarget === 'function' ? getTarget(req) : getTarget;

    // req.ip ya resuelve X-Forwarded-For correctamente vía 'trust proxy'.
    // Leer el header crudo permitía falsificar la IP en el log de auditoría.
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    getDb().prepare(
      'INSERT INTO audit_log (user_id, username, action, target, ip) VALUES (?, ?, ?, ?, ?)'
    ).run(
      req.user?.id || null,
      req.user?.username || 'anonymous',
      action,
      target || null,
      clientIp
    );
    next();
  };
}

module.exports = { logAction };
