'use strict';

const express = require('express');
const { getDb } = require('../config/db');
const { resolveDevice } = require('../resolver/device');
const { getProfile } = require('../catalog/profiles');
const { getCatalog } = require('../catalog');
const { read } = require('../mapping/engine');

const router = express.Router();

// Helpers shared with write paths
function getTtlSeconds(req) {
  if (req.query.ttl !== undefined) {
    const v = parseInt(req.query.ttl, 10);
    if (Number.isFinite(v) && v > 0 && v <= 7 * 24 * 3600) return v;
    const err = new Error('ttl inválido (segundos, 1..604800)');
    err.status = 400;
    throw err;
  }
  return 24 * 3600;
}

function buildExpiresAt(ttlSeconds) {
  // SQLite datetime('now', '+X seconds')
  return `datetime('now','+${ttlSeconds} seconds')`;
}

function auditInsert(db, req, action, target, detail) {
  try {
    const apiKeyName = req.apiKey ? req.apiKey.name : null;
    const ip = req.ip || req.socket.remoteAddress || null;
    db.prepare('INSERT INTO audit_log (api_key_name, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)').run(apiKeyName, action, target, detail ? JSON.stringify(detail).slice(0, 2000) : null, ip);
  } catch (_) {}
}

function getAllCanonicalSet() {
  const catalog = getCatalog();
  const set = new Set();
  for (const section of Object.values(catalog.sections)) {
    const entries = section.params || section.actions || {};
    for (const k of Object.keys(entries)) set.add(k);
  }
  return set;
}

function validateAndTransformBody(body, profile, allowedPrefixes, catalogSet) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    const err = new Error('Body vacío o inválido');
    err.status = 400;
    throw err;
  }
  const transformers = require('../../../mapping/transformers');
  const payloadCanonical = {};
  for (const [key, rawVal] of Object.entries(body)) {
    // 400 if not in catalog
    if (!catalogSet.has(key)) {
      const err = new Error(`Campo no existe en catálogo: ${key}`);
      err.status = 400;
      throw err;
    }
    // Check prefix allowed for this endpoint
    if (allowedPrefixes && allowedPrefixes.length) {
      const ok = allowedPrefixes.some((p) => key === p || key.startsWith(p + '.'));
      if (!ok) {
        const err = new Error(`Campo ${key} no pertenece a este endpoint`);
        err.status = 400;
        throw err;
      }
    }
    const def = profile.params[key];
    if (!def) {
      const err = new Error(`Campo no soportado por perfil ${profile.profile}: ${key}`);
      err.status = 422;
      throw err;
    }
    if (def.mode === 'ro') {
      const err = new Error(`Campo solo lectura: ${key}`);
      err.status = 422;
      throw err;
    }
    // Enum validation (canonical enum)
    if (def.enum && Array.isArray(def.enum)) {
      if (!def.enum.includes(String(rawVal)) && !def.enum.includes(rawVal)) {
        const err = new Error(`Valor fuera de enum para ${key}: ${rawVal}`);
        err.status = 422;
        throw err;
      }
    }
    // Catalog enum also check if profile enum not set but catalog has enum
    // get catalog def
    try {
      const catalog = getCatalog();
      for (const sec of Object.values(catalog.sections)) {
        if (sec.params && sec.params[key] && sec.params[key].enum) {
          const enums = sec.params[key].enum;
          if (enums && !enums.includes(String(rawVal)) && !enums.includes(rawVal)) {
            const err = new Error(`Valor fuera de enum para ${key}: ${rawVal}`);
            err.status = 422;
            throw err;
          }
        }
      }
    } catch (_) {}

    // Transform to_device
    let deviceVal = rawVal;
    if (def.transform) {
      const fn = transformers[def.transform];
      if (!fn) {
        const err = new Error(`Transformer no encontrado: ${def.transform}`);
        err.status = 500;
        throw err;
      }
      try {
        deviceVal = fn(rawVal, 'to_device');
      } catch (e) {
        const err = new Error(`Validación falló para ${key}: ${e.message}`);
        err.status = 400;
        throw err;
      }
    }
    payloadCanonical[key] = deviceVal;
  }
  return payloadCanonical;
}

function createPendingTask({ serial, deviceRow, profile, action, payloadCanonical, ttlSeconds, req }) {
  const db = getDb();
  const expiresExpr = buildExpiresAt(ttlSeconds);
  const maxAttempts = (action === 'reboot' || action === 'factoryReset' || action === 'factory_reset') ? 3 : null;
  const apiKeyId = req.apiKey ? req.apiKey.id : null;
  const payloadStr = payloadCanonical ? JSON.stringify(payloadCanonical) : null;
  // Use SQLite datetime expression via SQL, but need to compute expires_at in JS for return? Use SQL expression directly.
  const stmt = db.prepare(`
    INSERT INTO tasks (serial, device_id, profile, action, payload_canonical, status, expires_at, max_attempts, api_key_id)
    VALUES (?, ?, ?, ?, ?, 'pending', ${expiresExpr}, ?, ?)
  `);
  const info = stmt.run(serial, deviceRow.device_id, profile.profile || deviceRow.profile, action, payloadStr, maxAttempts, apiKeyId);
  const taskId = info.lastInsertRowid;
  auditInsert(db, req, action, serial, { taskId, payloadCanonical });
  return taskId;
}

// GET /api/v1/onts?page=&limit=&query=
router.get('/', (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 25;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';

    const db = getDb();
    let where = '';
    let params = [];
    if (query) {
      where = 'WHERE serial LIKE ? COLLATE NOCASE OR manufacturer LIKE ? COLLATE NOCASE OR model LIKE ? COLLATE NOCASE';
      const like = `%${query}%`;
      params = [like, like, like];
    }

    const totalRow = db.prepare(`SELECT COUNT(*) as c FROM devices ${where}`).get(...params);
    const total = totalRow.c;

    const devices = db.prepare(
      `SELECT device_id, serial, manufacturer, model, profile, software_version, last_inform FROM devices ${where} ORDER BY last_inform DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ devices, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/onts/:serial/capabilities
router.get('/:serial/capabilities', (req, res, next) => {
  try {
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    res.json({ serial: deviceRow.serial, device_id: deviceRow.device_id, profile: deviceRow.profile, capabilities: profile.capabilities || {} });
  } catch (err) {
    next(err);
  }
});

// Helper to handle read for group(s)
async function handleRead(req, res, next, group) {
  try {
    const deviceRow = resolveDevice(req.params.serial);
    const { data, capabilities } = await read(group, deviceRow);
    if (group) {
      res.json({ serial: deviceRow.serial, device_id: deviceRow.device_id, profile: deviceRow.profile, data, capabilities });
    } else {
      res.json({ serial: deviceRow.serial, device_id: deviceRow.device_id, profile: deviceRow.profile, data, capabilities });
    }
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/onts/:serial  -> all sections
router.get('/:serial', (req, res, next) => handleRead(req, res, next, null));

// Subgroups
router.get('/:serial/device', (req, res, next) => handleRead(req, res, next, 'device'));
router.get('/:serial/wifi', async (req, res, next) => {
  try {
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    const result2g = await read('wifi.radio.2g', deviceRow);
    const result5g = await read('wifi.radio.5g', deviceRow);
    const data = { ...result2g.data, ...result5g.data };
    res.json({ serial: deviceRow.serial, device_id: deviceRow.device_id, profile: deviceRow.profile, data, capabilities: profile.capabilities });
  } catch (err) {
    next(err);
  }
});
router.get('/:serial/wan', (req, res, next) => handleRead(req, res, next, 'wan'));
router.get('/:serial/lan', (req, res, next) => handleRead(req, res, next, 'lan'));
router.get('/:serial/gpon', (req, res, next) => handleRead(req, res, next, 'gpon'));
router.get('/:serial/diagnostics', (req, res, next) => handleRead(req, res, next, 'diagnostics'));

// ── Escrituras ──

// PATCH /:serial/wifi
router.patch('/:serial/wifi', (req, res, next) => {
  try {
    const ttlSeconds = getTtlSeconds(req);
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    const catalogSet = getAllCanonicalSet();
    const payloadCanonical = validateAndTransformBody(req.body, profile, ['wifi.radio.2g', 'wifi.radio.5g'], catalogSet);
    const taskId = createPendingTask({ serial: deviceRow.serial, deviceRow, profile, action: 'wifi.update', payloadCanonical, ttlSeconds, req });
    res.status(202).json({ taskId });
  } catch (err) {
    next(err);
  }
});

// PATCH /:serial/wan
router.patch('/:serial/wan', (req, res, next) => {
  try {
    const ttlSeconds = getTtlSeconds(req);
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    const catalogSet = getAllCanonicalSet();
    const payloadCanonical = validateAndTransformBody(req.body, profile, ['wan'], catalogSet);
    const taskId = createPendingTask({ serial: deviceRow.serial, deviceRow, profile, action: 'wan.update', payloadCanonical, ttlSeconds, req });
    res.status(202).json({ taskId });
  } catch (err) {
    next(err);
  }
});

// PATCH /:serial/lan
router.patch('/:serial/lan', (req, res, next) => {
  try {
    const ttlSeconds = getTtlSeconds(req);
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    const catalogSet = getAllCanonicalSet();
    const payloadCanonical = validateAndTransformBody(req.body, profile, ['lan'], catalogSet);
    const taskId = createPendingTask({ serial: deviceRow.serial, deviceRow, profile, action: 'lan.update', payloadCanonical, ttlSeconds, req });
    res.status(202).json({ taskId });
  } catch (err) {
    next(err);
  }
});

// POST /:serial/reboot
router.post('/:serial/reboot', (req, res, next) => {
  try {
    const ttlSeconds = getTtlSeconds(req);
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    const taskId = createPendingTask({ serial: deviceRow.serial, deviceRow, profile, action: 'reboot', payloadCanonical: {}, ttlSeconds, req });
    res.status(202).json({ taskId });
  } catch (err) {
    next(err);
  }
});

// POST /:serial/factory-reset
router.post('/:serial/factory-reset', (req, res, next) => {
  try {
    if (req.body?.confirm !== true) {
      const err = new Error('factory-reset requiere confirm:true en body');
      err.status = 400;
      throw err;
    }
    const ttlSeconds = getTtlSeconds(req);
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    const taskId = createPendingTask({ serial: deviceRow.serial, deviceRow, profile, action: 'factoryReset', payloadCanonical: {}, ttlSeconds, req });
    res.status(202).json({ taskId });
  } catch (err) {
    next(err);
  }
});

// POST /:serial/refresh
router.post('/:serial/refresh', (req, res, next) => {
  try {
    const ttlSeconds = getTtlSeconds(req);
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    // Valida last_inform vs TTL
    if (deviceRow.last_inform) {
      const last = new Date(deviceRow.last_inform).getTime();
      if (Number.isFinite(last)) {
        const ageSec = (Date.now() - last) / 1000;
        if (ageSec > ttlSeconds) {
          const err = new Error('Equipo offline: last_inform excede TTL');
          err.status = 409;
          throw err;
        }
      }
    }
    const taskId = createPendingTask({ serial: deviceRow.serial, deviceRow, profile, action: 'refresh', payloadCanonical: {}, ttlSeconds, req });
    res.status(202).json({ taskId });
  } catch (err) {
    next(err);
  }
});

// POST /:serial/diagnostics/ping
router.post('/:serial/diagnostics/ping', (req, res, next) => {
  try {
    const ttlSeconds = getTtlSeconds(req);
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    const target = req.body && typeof req.body.target === 'string' ? req.body.target.trim() : null;
    if (!target) {
      const err = new Error('target requerido');
      err.status = 400;
      throw err;
    }
    const taskId = createPendingTask({ serial: deviceRow.serial, deviceRow, profile, action: 'diagPing', payloadCanonical: { target }, ttlSeconds, req });
    res.status(202).json({ taskId });
  } catch (err) {
    next(err);
  }
});

// POST /:serial/diagnostics/traceroute
router.post('/:serial/diagnostics/traceroute', (req, res, next) => {
  try {
    const ttlSeconds = getTtlSeconds(req);
    const deviceRow = resolveDevice(req.params.serial);
    const profile = getProfile(deviceRow.profile);
    const target = req.body && typeof req.body.target === 'string' ? req.body.target.trim() : null;
    if (!target) {
      const err = new Error('target requerido');
      err.status = 400;
      throw err;
    }
    const taskId = createPendingTask({ serial: deviceRow.serial, deviceRow, profile, action: 'diagTraceRoute', payloadCanonical: { target }, ttlSeconds, req });
    res.status(202).json({ taskId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
