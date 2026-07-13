'use strict';

const express = require('express');
const { getDb } = require('../config/db');
const { requireAdmin } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAdmin);

// GET /api/audit?limit=50&skip=0&username=&action=
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const skip = parseInt(req.query.skip) || 0;

  let where = '1=1';
  const params = [];

  if (req.query.username) {
    where += ' AND username = ?';
    params.push(req.query.username);
  }
  if (req.query.action) {
    where += ' AND action LIKE ?';
    params.push(`%${req.query.action}%`);
  }
  if (req.query.target) {
    where += ' AND target LIKE ?';
    params.push(`%${req.query.target}%`);
  }
  if (req.query.search) {
    where += ' AND (action LIKE ? OR target LIKE ? OR username LIKE ?)';
    params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
  }

  const logs = getDb().prepare(
    `SELECT * FROM audit_log WHERE ${where} ORDER BY COALESCE(created_at, '1970-01-01') DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, skip);

  // Convertir fechas a ISO 8601 para que el frontend las interprete como UTC
  const logsWithISO = logs.map(log => ({
    ...log,
    created_at: log.created_at ? new Date(log.created_at).toISOString() : null
  }));

  const total = getDb().prepare(
    `SELECT COUNT(*) as count FROM audit_log WHERE ${where}`
  ).get(...params);

  res.json({ data: logsWithISO, total: total.count });
});

module.exports = router;
