'use strict';

const express = require('express');
const { nbi } = require('../config/genieacs');
const { requireAdmin } = require('../middleware/authorize');
const { logAction } = require('../middleware/audit');

const router = express.Router();

// GET /api/faults?limit=&skip=&query=
router.get('/', async (req, res, next) => {
  try {
    const params = {};
    if (req.query.limit) params.limit = req.query.limit;
    if (req.query.skip) params.skip = req.query.skip;
    if (req.query.query) params.query = req.query.query;

    const { data } = await nbi.get('/faults/', { params });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/faults/:id  — id formato "deviceId:channel"
router.delete(
  '/:id',
  requireAdmin,
  (req, res, next) => logAction('fault_delete', () => req.params.id)(req, res, next),
  async (req, res, next) => {
    try {
      await nbi.delete(`/faults/${encodeURIComponent(req.params.id)}`);
      res.json({ message: 'Falla eliminada' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
