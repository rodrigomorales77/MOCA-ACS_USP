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

app.listen(port, '0.0.0.0', () => {
  console.log(`[gateway] ont-gateway listening on ${port}`);
});
