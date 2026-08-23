'use strict';

const express = require('express');
const { apiKeyAuth } = require('./middleware/api-key');
const { rateLimit } = require('./middleware/rate-limit');

const app = express();

app.set('trust proxy', 1);

app.use(express.json());

// Health check (no auth)
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// All /api/v1 routes require API key + rate limit
app.use('/api/v1', apiKeyAuth, rateLimit);

// Placeholder for future routes (resolver, engine, jobs not yet implemented)
// e.g. app.use('/api/v1/onts', require('./routes/onts'));

// 404 for unknown /api/v1 routes (still behind auth)
app.use('/api/v1', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Error interno' });
});

module.exports = app;
