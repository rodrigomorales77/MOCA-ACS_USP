'use strict';

const express = require('express');
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

module.exports = router;
