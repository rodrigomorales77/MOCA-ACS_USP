#!/usr/bin/env node
'use strict';

/**
 * Setup script para configurar autenticación CWMP en GenieACS
 * Ejecutar: node src/scripts/setup-genieacs-auth.js
 */

const { MongoClient } = require('mongodb');

const GENIEACS_DB = process.env.GENIEACS_MONGODB_CONNECTION_URL || 'mongodb://moca-mongodb:27017/genieacs';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin1234!';

async function setupAuth() {
  let client;
  try {
    console.log('[setup] Conectando a MongoDB de GenieACS...');
    client = new MongoClient(GENIEACS_DB);
    await client.connect();

    const db = client.db('genieacs');

    // Preparar configuración de autenticación
    const authConfig = {
      _id: 'cwmp.auth',
      value: `AUTH("admin", "${ADMIN_PASSWORD}")`
    };

    // Insertar o actualizar configuración en colección 'config'
    const result = await db.collection('config').updateOne(
      { _id: 'cwmp.auth' },
      { $set: authConfig },
      { upsert: true }
    );

    console.log('[setup] ✓ Configuración de autenticación CWMP actualizada');
    console.log(`[setup] Credenciales configuradas:`);
    console.log(`  - Username: admin`);
    console.log(`  - Password: ${ADMIN_PASSWORD}`);
    console.log(`[setup] Todas las ONTs/CPEs deben usar estas credenciales para conectarse`);

    process.exit(0);

  } catch (err) {
    console.error('[setup] Error:', err.message);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

setupAuth();
