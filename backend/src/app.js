'use strict';

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const devicesRoutes = require('./routes/devices');
const faultsRoutes = require('./routes/faults');
const presetsRoutes = require('./routes/presets');
const usersRoutes = require('./routes/users');
const auditRoutes = require('./routes/audit');
const pendingActionsRoutes = require('./routes/pending-actions');
const firmwaresRoutes = require('./routes/firmwares');
const mocaacsProxyRoutes = require('./routes/mocaacs-proxy');
const genieacsConfigRoutes = require('./routes/genieacs-config');
const { authenticate } = require('./middleware/auth');

const app = express();

// Trust proxy for correct client IP detection
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Health check (sin auth)
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Auth (login no requiere token)
app.use('/api/auth', authRoutes);

// MOCA ACS Proxy API (solo desde IP privada, sin JWT requerido)
app.use('/api/mocaacs', mocaacsProxyRoutes);

// Todas las siguientes rutas requieren JWT válido
app.use(authenticate);
app.use('/api/devices', devicesRoutes);
app.use('/api/faults', faultsRoutes);
app.use('/api/presets', presetsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/pending-actions', pendingActionsRoutes);
app.use('/api/firmwares', firmwaresRoutes);
app.use('/api/genieacs', genieacsConfigRoutes);
// Upload middleware aplicado dentro de la ruta en firmwares.js

// Error handler global
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Error interno' });
});

module.exports = app;
