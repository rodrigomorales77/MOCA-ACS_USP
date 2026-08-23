'use strict';

const { getDb } = require('../config/db');
const { getDevices } = require('../services/genieacs');

const INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 500;

let isRunning = false;
let timer = null;

function normalizeSerial(input) {
  return String(input).trim().toUpperCase().replace(/\s+/g, '');
}

function extractSerial(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') return null;
  // _deviceId format: OUI-PRODUCTCLASS-SERIAL  (PRODUCTCLASS may contain dots/dashes)
  // serial is last segment after last '-'
  const idx = deviceId.lastIndexOf('-');
  if (idx === -1) return normalizeSerial(deviceId);
  return normalizeSerial(deviceId.slice(idx + 1));
}

function detectProfile(device) {
  // Try to read Manufacturer/ModelName from snapshot
  let manufacturer = null;
  let model = null;
  let tree = 'tr098';

  const igd = device.InternetGatewayDevice && device.InternetGatewayDevice.DeviceInfo;
  const dev = device.Device && device.Device.DeviceInfo;

  function val(node, key) {
    if (!node || !node[key]) return null;
    const v = node[key];
    if (v && typeof v === 'object' && '_value' in v) return String(v._value);
    if (typeof v === 'string') return v;
    return null;
  }

  if (igd) {
    manufacturer = val(igd, 'Manufacturer');
    model = val(igd, 'ModelName');
    tree = 'tr098';
  } else if (dev) {
    manufacturer = val(dev, 'Manufacturer');
    model = val(dev, 'ModelName');
    tree = 'tr181';
  }

  // Fallback to _deviceId metadata
  if ((!manufacturer || manufacturer === 'Desconocido') && device._deviceId) {
    const meta = device._deviceId;
    if (meta._Manufacturer) manufacturer = String(meta._Manufacturer);
    else if (typeof meta === 'string') {
      // string form OUI-PRODUCTCLASS-SERIAL not structured
    }
  }
  if ((!model || model === 'Desconocido') && device._deviceId) {
    const meta = device._deviceId;
    if (meta._ProductClass) model = String(meta._ProductClass);
    if (meta._SerialNumber && !manufacturer) {
      // nothing
    }
  }

  manufacturer = manufacturer ? String(manufacturer).trim().toUpperCase() : '';
  model = model ? String(model).trim() : '';

  // Map to known profiles
  if (manufacturer.includes('ZHONE') || manufacturer.includes('DZS') || model.toUpperCase().includes('ZNID')) {
    return { profile: 'ZHONE_TR098', manufacturer: manufacturer || 'ZHONE', model: model || 'ZNID-GPON-24xx' };
  }
  if (manufacturer.includes('HUAWEI') || model.toUpperCase().includes('HS8145')) {
    return { profile: 'HUAWEI_HS8145X6_TR098', manufacturer: manufacturer || 'HUAWEI', model: model || 'HS8145X6' };
  }
  if (manufacturer.includes('ZTE') || manufacturer.includes('ZXIC') || model.toUpperCase().includes('F890')) {
    return { profile: 'ZXIC_F890L_TR098', manufacturer: manufacturer || 'ZXIC', model: model || 'F890L' };
  }

  // Generic fallback: try to load profiles and match manufacturer/model prefix
  try {
    const { loadProfiles } = require('../catalog/profiles');
    const profiles = loadProfiles();
    for (const [name, p] of profiles.entries()) {
      const pm = String(p.manufacturer || '').toUpperCase();
      const mo = String(p.model || '').toUpperCase();
      // model may be pattern ZNID-GPON-24xx -> check prefix
      if (manufacturer && pm && manufacturer.includes(pm)) {
        if (model && mo && (model.toUpperCase().includes(mo.split('-')[0]) || mo.includes(model.toUpperCase().split('-')[0]))) {
          return { profile: name, manufacturer, model };
        }
        return { profile: name, manufacturer, model: model || mo };
      }
    }
  } catch (_) {}

  // Last resort: default to ZHONE if tree is TR098, else first profile
  if (tree === 'tr098') {
    return { profile: 'ZHONE_TR098', manufacturer: manufacturer || 'UNKNOWN', model: model || 'UNKNOWN' };
  }
  return { profile: 'ZHONE_TR098', manufacturer: manufacturer || 'UNKNOWN', model: model || 'UNKNOWN' };
}

async function refreshDeviceIndex() {
  if (isRunning) return;
  isRunning = true;
  try {
    const db = getDb();
    // Ensure index exists
    db.exec('CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial)');

    const projection = [
      '_id',
      '_deviceId',
      '_lastInform',
      'InternetGatewayDevice.DeviceInfo.Manufacturer',
      'InternetGatewayDevice.DeviceInfo.ModelName',
      'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
      'Device.DeviceInfo.Manufacturer',
      'Device.DeviceInfo.ModelName',
      'Device.DeviceInfo.SoftwareVersion',
    ].join(',');

    let skip = 0;
    let totalProcessed = 0;
    let hasMore = true;
    const serialSeen = new Map(); // serial -> device_id first seen

    console.log('[device-index] Iniciando refresco de índice de devices');

    // Prepare upsert statement
    const upsert = db.prepare(`
      INSERT INTO devices (device_id, serial, manufacturer, model, profile, software_version, last_inform, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(device_id) DO UPDATE SET
        serial = excluded.serial,
        manufacturer = excluded.manufacturer,
        model = excluded.model,
        profile = excluded.profile,
        software_version = excluded.software_version,
        last_inform = CASE WHEN excluded.last_inform > devices.last_inform THEN excluded.last_inform ELSE devices.last_inform END,
        updated_at = datetime('now')
    `);

    while (hasMore) {
      let batch;
      try {
        batch = await getDevices(null, projection, BATCH_SIZE, skip);
      } catch (err) {
        console.error(`[device-index] Error en lote skip=${skip}: ${err.message}`);
        hasMore = false;
        break;
      }

      if (!Array.isArray(batch) || batch.length === 0) {
        hasMore = false;
        break;
      }

      totalProcessed += batch.length;

      for (const device of batch) {
        const deviceId = device._id;
        if (!deviceId) continue;

        const serial = extractSerial(device._deviceId && device._deviceId._SerialNumber ? String(device._deviceId._SerialNumber) : deviceId) || extractSerial(device._deviceId && typeof device._deviceId === 'string' ? device._deviceId : deviceId);
        // Prefer extraction from _deviceId string form; fallback to _id
        let s = null;
        if (device._deviceId) {
          if (typeof device._deviceId === 'string') s = extractSerial(device._deviceId);
          else if (device._deviceId._SerialNumber) s = normalizeSerial(device._deviceId._SerialNumber);
          else if (device._deviceId._ID) s = extractSerial(String(device._deviceId._ID));
        }
        if (!s) s = extractSerial(deviceId);
        if (!s) continue;

        const { profile, manufacturer, model } = detectProfile(device);
        const softwareVersion = (() => {
          const igd = device.InternetGatewayDevice && device.InternetGatewayDevice.DeviceInfo;
          const dev = device.Device && device.Device.DeviceInfo;
          function v(node, key) {
            if (!node || !node[key]) return null;
            const val = node[key];
            if (val && typeof val === 'object' && '_value' in val) return String(val._value);
            return null;
          }
          return (igd && v(igd, 'SoftwareVersion')) || (dev && v(dev, 'SoftwareVersion')) || null;
        })();

        const lastInform = device._lastInform || null;

        // Detect duplicate serial with different device_id
        if (serialSeen.has(s) && serialSeen.get(s) !== deviceId) {
          console.warn(`[device-index] Duplicado serial ${s}: ${serialSeen.get(s)} vs ${deviceId}`);
        } else if (!serialSeen.has(s)) {
          // also check DB for existing different device_id with same serial
          const existing = db.prepare('SELECT device_id FROM devices WHERE serial = ? COLLATE NOCASE AND device_id != ?').get(s, deviceId);
          if (existing) {
            console.warn(`[device-index] Duplicado serial en DB ${s}: ${existing.device_id} vs ${deviceId}`);
          }
        }
        serialSeen.set(s, deviceId);

        try {
          upsert.run(deviceId, s, manufacturer, model, profile, softwareVersion, lastInform);
        } catch (e) {
          console.error(`[device-index] Upsert fallo ${deviceId}: ${e.message}`);
        }
      }

      if (batch.length < BATCH_SIZE) hasMore = false;
      else skip += BATCH_SIZE;

      console.log(`[device-index] Procesados ${totalProcessed} devices...`);
    }

    console.log(`[device-index] ✓ Refresco completado: ${totalProcessed} devices`);
  } catch (err) {
    console.error('[device-index] Error general:', err.message);
  } finally {
    isRunning = false;
  }
}

function startDeviceIndex() {
  console.log('[device-index] Iniciando índice de devices (cada 5 min)');
  // Ensure table exists (initDb already did, but safe)
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        serial TEXT NOT NULL,
        manufacturer TEXT,
        model TEXT,
        profile TEXT NOT NULL,
        software_version TEXT,
        last_inform TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial);
    `);
  } catch (_) {}
  refreshDeviceIndex();
  timer = setInterval(refreshDeviceIndex, INTERVAL_MS);
  console.log(`[device-index] ✓ Índice activo (intervalo ${INTERVAL_MS / 1000}s)`);
}

function stopDeviceIndex() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startDeviceIndex, stopDeviceIndex, refreshDeviceIndex, extractSerial, normalizeSerial };
