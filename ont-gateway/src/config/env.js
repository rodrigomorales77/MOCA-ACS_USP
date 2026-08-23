'use strict';

const path = require('path');

function getEnv() {
  const portRaw = process.env.GATEWAY_PORT || '3001';
  const port = parseInt(portRaw, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`GATEWAY_PORT inválido: ${portRaw}`);
  }

  const dbPath = process.env.GATEWAY_DB_PATH || path.resolve(__dirname, '../../../data/gateway/gateway.db');
  // Inside Docker compose overrides to /app/data/gateway.db via GATEWAY_DB_PATH env;
  // local default is repo data/gateway/gateway.db (gitignored via data/).

  const nbiUrl = process.env.GENIEACS_NBI_URL || 'http://moca-genieacs:7557';
  try {
    const u = new URL(nbiUrl);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protocol');
  } catch {
    throw new Error(`GENIEACS_NBI_URL inválida: ${nbiUrl}`);
  }

  return { port, dbPath, nbiUrl };
}

module.exports = { getEnv };
