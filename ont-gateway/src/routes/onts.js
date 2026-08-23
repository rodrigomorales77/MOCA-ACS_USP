'use strict';

const express = require('express');
const { getDb } = require('../config/db');
const { resolveDevice } = require('../resolver/device');
const { getProfile } = require('../catalog/profiles');
const { read } = require('../mapping/engine');

const router = express.Router();

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
    // If group specified, return that slice; otherwise return full
    if (group) {
      // For aggregate groups like "wifi" we return data as is
      // For single section, unwrap to just that section's fields
      // Keep structure { <section>: { field: {supported,value,reason} } } for consistency
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
    // wifi returns both radios if both exist; use engine read for each
    const result2g = await read('wifi.radio.2g', deviceRow);
    const result5g = await read('wifi.radio.5g', deviceRow);
    // Merge data
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

module.exports = router;
