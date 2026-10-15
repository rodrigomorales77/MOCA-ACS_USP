'use strict';

const express = require('express');
const { getDb } = require('../config/db');
const { listCandidates, getConfig } = require('../jobs/stale-sweeper');
const { extractSerial } = require('../jobs/device-index');

const router = express.Router();

// GET /api/v1/maintenance/stale — preview read-only de candidatos a purga.
// No borra nada: la purga la ejecuta el sweeper semanal automáticamente.
router.get('/stale', async (req, res, next) => {
  try {
    const { days, cap } = getConfig();
    const { candidates } = await listCandidates(days);
    const list = candidates
      .map((c) => ({
        device_id: c.device_id,
        serial: extractSerial(c.device_id),
        last_inform: c.last_inform,
        age_days: Math.round(c.age_days * 10) / 10,
      }))
      .sort((a, b) => b.age_days - a.age_days)
      .slice(0, 500);
    res.json({ threshold_days: days, cap, count: candidates.length, over_cap: candidates.length > cap, candidates: list });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/maintenance/mapping-consistency — último reporte del check
// (sospechosos = mapeados pero nunca vistos en la muestra). Read-only.
router.get('/mapping-consistency', (req, res, next) => {
  try {
    const db = getDb();
    let rows = [];
    try {
      rows = db.prepare('SELECT profile, canonical, path, seen, sampled, checked_at FROM mapping_consistency ORDER BY profile, canonical').all();
    } catch (_) {
      res.json({ status: 'pending', message: 'Aún sin primer pase (corre a los 20 min del boot)' });
      return;
    }
    if (rows.length === 0) {
      res.json({ status: 'pending', message: 'Aún sin primer pase (corre a los 20 min del boot)' });
      return;
    }
    const suspects = rows.filter((r) => r.seen === 0);
    res.json({ status: 'ok', checked_at: rows[0].checked_at, total: rows.length, suspects });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
