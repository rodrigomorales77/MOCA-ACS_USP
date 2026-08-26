'use strict';

const { getDb } = require('../config/db');
const { nbi } = require('../config/genieacs');

const CHECK_INTERVAL = 15 * 60 * 1000;
const MAX_REFRESH_PER_CYCLE = 50;

let isRunning = false;

function getDeviceInfo(device) {
  if (device?.InternetGatewayDevice?.DeviceInfo) {
    return {
      path: 'InternetGatewayDevice.DeviceInfo',
      info: device.InternetGatewayDevice.DeviceInfo
    };
  }

  if (device?.Device?.DeviceInfo) {
    return {
      path: 'Device.DeviceInfo',
      info: device.Device.DeviceInfo
    };
  }

  return null;
}

function normalizeObjectName(path) {
  return path ? path.replace(/\.$/, '') : path;
}

async function hasPendingRefreshTask(deviceId) {
  try {
    const query = JSON.stringify({ device: deviceId, name: 'refreshObject' });
    const resp = await nbi.get('/tasks', { params: { query } });
    const tasks = resp.data || [];
    return Array.isArray(tasks) && tasks.length > 0;
  } catch (_) {
    return false;
  }
}

async function bootstrapNewDevices() {
  if (isRunning) return;

  isRunning = true;

  try {
    const db = getDb();
    const BATCH_SIZE = 500;

    let totalProcessed = 0;
    let refreshCount = 0;
    let skip = 0;
    let hasMore = true;

    console.log(
      '[device-bootstrap] Iniciando análisis de dispositivos nuevos'
    );

    const projection = [
      '_id',
      '_lastBootstrap',
      'InternetGatewayDevice.DeviceInfo',
      'Device.DeviceInfo'
    ].join(',');

    while (hasMore) {
      try {
        const response = await nbi.get('/devices/', {
          params: {
            limit: BATCH_SIZE,
            skip,
            projection
          }
        });

        const batch = response.data || [];

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        totalProcessed += batch.length;

        for (const device of batch) {
          const deviceId = device._id;

          if (!deviceId) {
            continue;
          }

          // Bootstrap ya realizado.
          if (device._lastBootstrap) {
            continue;
          }

          const deviceInfo = getDeviceInfo(device);

          if (!deviceInfo) {
            console.log(
              `[device-bootstrap] ${deviceId} sin DeviceInfo detectable; se omite`
            );
            continue;
          }

          // Evitar repetir refresh para el mismo dispositivo durante una hora.
          const lastBootstrap = db.prepare(`
            SELECT created_at
            FROM device_bootstrap_log
            WHERE device_id = ?
            AND datetime(created_at) > datetime('now', '-1 hour')
            LIMIT 1
          `).get(deviceId);

          if (lastBootstrap || refreshCount >= MAX_REFRESH_PER_CYCLE) {
            continue;
          }

          try {
            console.log(
              `[device-bootstrap] Nuevo dispositivo detectado: ${deviceId}`
            );

            const objectName = normalizeObjectName(deviceInfo.path);

            console.log(
              `[device-bootstrap] Enviando refreshObject: ${objectName}`
            );

            if (await hasPendingRefreshTask(deviceId)) {
              console.log(
                `[device-bootstrap] ${deviceId} ya tiene refreshObject pendiente; se omite`
              );
              continue;
            }

            await nbi.post(
              `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
              {
                name: 'refreshObject',
                objectName
              }
            );

            db.prepare(`
              INSERT OR REPLACE INTO device_bootstrap_log
                (device_id, created_at)
              VALUES (?, datetime('now'))
            `).run(deviceId);

            refreshCount++;

          } catch (err) {
            console.error(
              `[device-bootstrap] Error enviando refreshObject a ${deviceId}:`,
              err.message
            );
          }
        }

        if (batch.length < BATCH_SIZE) {
          hasMore = false;
        }

        skip += BATCH_SIZE;

        console.log(
          `[device-bootstrap] Procesados ${totalProcessed} dispositivos...`
        );

      } catch (err) {
        console.error(
          `[device-bootstrap] Error en lote skip=${skip}:`,
          err.message
        );

        hasMore = false;
      }
    }

    console.log(
      `[device-bootstrap] ✓ Análisis completado: ` +
      `${totalProcessed} devices, ` +
      `${refreshCount} refreshObject(s) enviados`
    );

  } catch (err) {
    console.error(
      '[device-bootstrap] Error general:',
      err.message
    );

  } finally {
    isRunning = false;
  }
}

function startDeviceBootstrap() {
  console.log(
    '[device-bootstrap] Iniciando monitor de dispositivos nuevos...'
  );

  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS device_bootstrap_log (
      device_id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  bootstrapNewDevices();

  setInterval(
    bootstrapNewDevices,
    CHECK_INTERVAL
  );

  console.log(
    `[device-bootstrap] ✓ Bootstrap monitor activo ` +
    `(verificando cada ${CHECK_INTERVAL / 1000}s)`
  );
}

module.exports = {
  startDeviceBootstrap
};
