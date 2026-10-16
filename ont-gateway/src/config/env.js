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

  // Frescura auto-refresh por sección (segundos). El GET refresca solo si el
  // snapshot está más viejo que esto; 0 = nunca auto-refrescar esa sección.
  // Valores desde comportamiento real: DeviceInfo viene en cada inform (1h de
  // margen), WAN cambia por reconexiones/DHCP (4h), GPON deriva óptica útil
  // para fallas (1h), wifi/LAN casi no cambian (24h/12h), diagnostics solo a demanda.
  const DEFAULT_MAX_AGE = { device: 3600, wan: 14400, gpon: 3600, wifi: 86400, lan: 43200, diagnostics: 0 };
  let sectionMaxAge = { ...DEFAULT_MAX_AGE };
  // Override global explícito (si se define, vale para todas salvo JSON por sección).
  if (process.env.GATEWAY_MAX_AGE_DEFAULT !== undefined) {
    const globalDefault = parseInt(process.env.GATEWAY_MAX_AGE_DEFAULT, 10);
    if (Number.isFinite(globalDefault) && globalDefault >= 0) {
      for (const k of Object.keys(sectionMaxAge)) sectionMaxAge[k] = globalDefault;
    } else {
      console.error('[gateway] GATEWAY_MAX_AGE_DEFAULT inválido, uso defaults por sección');
    }
  }
  if (process.env.GATEWAY_SECTION_MAX_AGE) {
    try {
      const parsed = JSON.parse(process.env.GATEWAY_SECTION_MAX_AGE);
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && v >= 0) sectionMaxAge[k] = Math.floor(v);
      }
    } catch (_) {
      console.error('[gateway] GATEWAY_SECTION_MAX_AGE inválido, uso defaults');
    }
  }

  return { port, dbPath, nbiUrl, sectionMaxAge };
}

module.exports = { getEnv };
