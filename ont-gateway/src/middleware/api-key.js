'use strict';

const crypto = require('crypto');
const { getDb } = require('../config/db');

function apiKeyAuth(req, res, next) {
  const raw = req.headers['x-api-key'];
  if (!raw || typeof raw !== 'string') {
    return res.status(401).json({ error: 'X-API-Key requerida' });
  }

  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const row = getDb().prepare(
    'SELECT id, name FROM api_keys WHERE key_hash = ? AND active = 1'
  ).get(hash);

  if (!row) {
    return res.status(401).json({ error: 'API key inválida' });
  }

  // Update last_used opportunistically (best-effort, ignore errors)
  try {
    getDb().prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?").run(row.id);
  } catch (_) {
    // ignore
  }

  req.apiKey = { id: row.id, name: row.name };
  next();
}

module.exports = { apiKeyAuth };
