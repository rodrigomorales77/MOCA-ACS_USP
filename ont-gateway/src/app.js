'use strict';

const express = require('express');
const { apiKeyAuth } = require('./middleware/api-key');
const { rateLimit } = require('./middleware/rate-limit');

const app = express();

app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));

// Health check (no auth)
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// All /api/v1 routes require API key + rate limit
app.use('/api/v1', apiKeyAuth, rateLimit);

app.use('/api/v1/onts', require('./routes/onts'));
app.use('/api/v1/tasks', require('./routes/tasks'));

// 404 for unknown /api/v1 routes (still behind auth)
app.use('/api/v1', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const body = { error: err.message || 'Error interno' };
  if (err.candidates) body.candidates = err.candidates;
  res.status(status).json(body);
});

module.exports = app;
