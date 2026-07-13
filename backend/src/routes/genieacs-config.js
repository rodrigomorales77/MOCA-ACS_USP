'use strict';

const express = require('express');
const { nbi } = require('../config/genieacs');
const { requireAdmin } = require('../middleware/authorize');

const router = express.Router();

// Todas las rutas son solo para admin
router.use(requireAdmin);

// POST /api/genieacs/auth - Configurar autenticación CWMP
router.post('/auth', async (req, res, next) => {
  try {
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';
    const authExpression = `AUTH("admin", "${adminPassword}")`;

    console.log('[genieacs-config] Intentando configurar autenticación CWMP...');

    // Nota: GenieACS no expone un endpoint NBI para configurar cwmp.auth
    // Esto requiere acceso directo a MongoDB o uso del UI web de GenieACS
    //
    // Instrucciones para usuario:
    // 1. Acceder a GenieACS UI (http://server:3000)
    // 2. Admin tab -> Config
    // 3. New config button
    // 4. Key: cwmp.auth
    // 5. Value: AUTH("admin", "PASSWORD")

    res.json({
      message: 'Autenticación CWMP debe configurarse manualmente en GenieACS UI',
      instructions: {
        step1: 'Acceder a http://genieacs-ip:3000 (UI de GenieACS)',
        step2: 'Ir a Admin tab',
        step3: 'Click en Config',
        step4: 'Click en "New config"',
        step5: 'Key: cwmp.auth',
        step6: `Value: ${authExpression}`,
        step7: 'Click Save'
      },
      authExpression,
      credentials: {
        username: 'admin',
        password: adminPassword
      },
      note: 'Todos los dispositivos (ONT, CPE, etc) deben usar estas credenciales en sus parámetros ManagementServer.Username y ManagementServer.Password'
    });

  } catch (err) {
    next(err);
  }
});

// GET /api/genieacs/status - Ver estado de GenieACS
router.get('/status', async (req, res, next) => {
  try {
    // Intentar obtener dispositivos para verificar conexión
    const response = await nbi.get('/devices/', { params: { limit: 1 } });

    res.json({
      status: 'connected',
      message: 'GenieACS está disponible',
      nbiUrl: process.env.GENIEACS_NBI_URL || 'N/A'
    });

  } catch (err) {
    res.status(503).json({
      status: 'disconnected',
      message: 'No se puede conectar a GenieACS',
      error: err.message
    });
  }
});

module.exports = router;
