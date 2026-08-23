'use strict';

const { getDb } = require('../config/db');

function normalizeSerial(input) {
  return String(input).trim().toUpperCase().replace(/\s+/g, '');
}

function resolveDevice(serial) {
  const normalized = normalizeSerial(serial);
  const len = normalized.length;

  if (len !== 16 && len !== 12 && len !== 8) {
    const err = new Error('Serial debe tener 16, 12 (ZNTS+8) o sufijo de 8 caracteres');
    err.status = 400;
    throw err;
  }

  const db = getDb();

  let rows;
  if (len === 16 || len === 12) {
    rows = db.prepare(
      'SELECT * FROM devices WHERE serial = ? COLLATE NOCASE'
    ).all(normalized);
  } else {
    // len === 8: suffix search (cubre tanto 16 hex como ZNTS+8)
    rows = db.prepare(
      "SELECT * FROM devices WHERE serial LIKE '%' || ? COLLATE NOCASE"
    ).all(normalized);
  }

  if (rows.length === 0) {
    const err = new Error(`Dispositivo no encontrado (serial: ${normalized}, suffix: ${len === 8})`);
    err.status = 404;
    throw err;
  }

  if (rows.length > 1) {
    // Order by last_inform desc (nulls last)
    rows.sort((a, b) => {
      const ta = a.last_inform ? new Date(a.last_inform).getTime() : 0;
      const tb = b.last_inform ? new Date(b.last_inform).getTime() : 0;
      return tb - ta;
    });
    const err = new Error('Serial ambiguo: múltiples candidatos');
    err.status = 409;
    err.candidates = rows.map((r) => ({
      device_id: r.device_id,
      model: r.model,
      last_inform: r.last_inform,
    }));
    throw err;
  }

  return rows[0];
}

module.exports = { resolveDevice, normalizeSerial };
