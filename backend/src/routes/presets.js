'use strict';

const express = require('express');
const { nbi } = require('../config/genieacs');

const router = express.Router();

// GET /api/presets
router.get('/', async (_req, res, next) => {
  try {
    const { data } = await nbi.get('/presets/');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/presets/provisions
router.get('/provisions', async (_req, res, next) => {
  try {
    const { data } = await nbi.get('/provisions/');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
