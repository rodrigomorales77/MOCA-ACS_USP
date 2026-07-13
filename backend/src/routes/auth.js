'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../config/db');
const { signToken } = require('../config/jwt');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Rate limiting simple en memoria para login (sin dependencias externas).
// Máx 10 intentos fallidos por IP cada 15 minutos.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map(); // ip -> { count, windowStart }

function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) return false;
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function registerFailedAttempt(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
  // Evitar crecimiento indefinido del Map
  if (loginAttempts.size > 10000) {
    for (const [key, val] of loginAttempts) {
      if (now - val.windowStart > LOGIN_WINDOW_MS) loginAttempts.delete(key);
    }
  }
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username y password requeridos' });
  }

  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Intentá de nuevo en unos minutos.' });
  }

  const user = getDb().prepare(
    'SELECT * FROM users WHERE username = ? AND active = 1'
  ).get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    registerFailedAttempt(req.ip);
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  // Login exitoso: resetear contador de intentos
  loginAttempts.delete(req.ip);

  // Limpieza oportunista de sesiones expiradas (antes crecían sin límite)
  getDb().prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

  const payload = { id: user.id, username: user.username, role: user.role };
  const token = signToken(payload);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Guardar sesión (expira en 8h)
  getDb().prepare(
    "INSERT INTO sessions (user_id, token_hash, expires_at, ip) VALUES (?, ?, datetime('now', '+8 hours'), ?)"
  ).run(user.id, tokenHash, req.ip);

  // Actualizar last_login
  getDb().prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  // Log de auditoría
  getDb().prepare(
    'INSERT INTO audit_log (user_id, username, action, target, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user.id, user.username, 'Inició sesión', user.username, req.ip, new Date().toISOString());

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nombre: user.nombre,
      apellido: user.apellido,
      correo: user.correo,
      telefono: user.telefono,
      role: user.role
    }
  });
});

// POST /api/auth/logout  (requiere token válido)
router.post('/logout', authenticate, (req, res) => {
  const token = req.headers['authorization'].slice(7);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);

  getDb().prepare(
    'INSERT INTO audit_log (user_id, username, action, target, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, req.user.username, 'Cerró sesión', req.user.username, req.ip, new Date().toISOString());

  res.json({ message: 'Sesión cerrada' });
});

// GET /api/auth/me  (requiere token válido)
router.get('/me', authenticate, (req, res) => {
  const user = getDb().prepare(
    'SELECT id, username, nombre, apellido, correo, telefono, role, last_login FROM users WHERE id = ?'
  ).get(req.user.id);

  // Convertir fecha a ISO 8601
  if (user && user.last_login) {
    user.last_login = new Date(user.last_login).toISOString();
  }

  res.json(user);
});

module.exports = router;
