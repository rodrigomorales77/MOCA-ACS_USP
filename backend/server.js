'use strict';

const app = require('./src/app');
const { initDb } = require('./src/config/db');
const { ensureAdminPassword } = require('./src/config/seed-admin');
const { startScheduler } = require('./src/jobs/scheduler');
const { startFirmwareMonitor } = require('./src/jobs/firmware-monitor');
const { startDeviceBootstrap } = require('./src/jobs/device-bootstrap');

const PORT = process.env.PORT || 3000;

initDb();
ensureAdminPassword();

// Iniciar scheduler de acciones programadas
startScheduler();

// DESHABILITADO TEMPORALMENTE - Requiere optimización para 3634+ devices
// startFirmwareMonitor();

// Iniciar bootstrap de dispositivos nuevos (refresh automático) - optimizado con paginación
startDeviceBootstrap();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MOCA ACS Backend corriendo en puerto ${PORT}`);
});
