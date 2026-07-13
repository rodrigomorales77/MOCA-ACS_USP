'use strict';

const { nbi } = require('../config/genieacs');

async function setupGenieACSAuth() {
  try {
    // Configurar autenticación CWMP en GenieACS
    // Usar AUTH() function con credenciales globales

    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';
    const authExpression = `AUTH("admin", "${adminPassword}")`;

    console.log('[genieacs-auth-setup] Configurando autenticación CWMP...');

    // Nota: GenieACS no tiene un endpoint NBI para configurar parámetros globales.
    // La configuración debe hacerse manualmente en el UI o via MongoDB.
    // Para producción, considerar:
    // 1. Insertar directamente en MongoDB de GenieACS
    // 2. O usar el UI web de GenieACS (Admin -> Config)
    // 3. O crear un ext script en /opt/genieacs/ext/

    console.log(`[genieacs-auth-setup] Expresión de autenticación: ${authExpression}`);
    console.log('[genieacs-auth-setup] ⚠ Configurar manualmente en GenieACS UI:');
    console.log('  1. Ir a Admin -> Config');
    console.log('  2. Click "New config"');
    console.log('  3. Key: cwmp.auth');
    console.log(`  4. Value: ${authExpression}`);
    console.log('[genieacs-auth-setup] O insertar en MongoDB (requiere acceso directo)');

  } catch (err) {
    console.error('[genieacs-auth-setup] Error:', err.message);
  }
}

module.exports = { setupGenieACSAuth };
