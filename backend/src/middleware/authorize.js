'use strict';

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acción reservada para administradores' });
  }
  next();
}

module.exports = { requireAdmin };
