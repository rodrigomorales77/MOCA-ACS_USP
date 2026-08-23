'use strict';

require('dotenv').config();

const app = require('./src/app');
const { initDb, seedApiKeys } = require('./src/config/db');
const { getEnv } = require('./src/config/env');
const { getCatalog } = require('./src/catalog');

const { port } = getEnv();

// Validate catalog on boot (fail-fast if invalid)
getCatalog();

// Init DB and seed keys
initDb();
seedApiKeys();

// Start background jobs (device index + task runner)
try {
  const { startDeviceIndex } = require('./src/jobs/device-index');
  startDeviceIndex();
} catch (e) {
  console.error('[gateway] device-index failed to start:', e.message);
}
try {
  const { startTaskRunner } = require('./src/jobs/task-runner');
  startTaskRunner();
} catch (e) {
  console.error('[gateway] task-runner failed to start:', e.message);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`[gateway] ont-gateway listening on ${port}`);
});
