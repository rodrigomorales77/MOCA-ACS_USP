'use strict';

const express = require('express');
const { getDb } = require('../config/db');

const router = express.Router();

// GET /api/v1/tasks?serial=&status=&page=&limit=
router.get('/', (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 25;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    const serial = typeof req.query.serial === 'string' ? req.query.serial.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    const where = [];
    const params = [];
    if (serial) {
      where.push('serial = ? COLLATE NOCASE');
      params.push(serial);
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const db = getDb();
    const totalRow = db.prepare(`SELECT COUNT(*) as c FROM tasks ${whereClause}`).get(...params);
    const total = totalRow.c;
    const tasks = db.prepare(
      `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    // Parse JSON fields for response
    const mapped = tasks.map((t) => ({
      ...t,
      payload_canonical: t.payload_canonical ? JSON.parse(t.payload_canonical) : null,
      result: t.result ? JSON.parse(t.result) : null,
    }));

    res.json({ tasks: mapped, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/tasks/:id
router.get('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      const err = new Error('ID inválido');
      err.status = 400;
      throw err;
    }
    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) {
      const err = new Error('Tarea no encontrada');
      err.status = 404;
      throw err;
    }
    const mapped = {
      ...task,
      payload_canonical: task.payload_canonical ? JSON.parse(task.payload_canonical) : null,
      result: task.result ? JSON.parse(task.result) : null,
    };
    res.json(mapped);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
