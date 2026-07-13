'use strict';

const { getDb } = require('../config/db');
const { nbi } = require('../config/genieacs');

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos
const MAX_REFRESH_PER_CYCLE = 50; // Evitar tormenta de tareas contra GenieACS
let isRunning = false;

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

    console.log('[device-bootstrap] Iniciando análisis de dispositivos');

    // Projection: solo lo necesario. Sin esto, cada ciclo trae los documentos
    // completos de ~3000 devices (cientos de MB) y satura Mongo/NBI/Node.
    const projection = '_id,InternetGatewayDevice.DeviceInfo.Manufacturer';

    while (hasMore) {
      try {
        // Traer dispositivos en lotes
        const response = await nbi.get('/devices/', {
          params: {
            limit: BATCH_SIZE,
            skip,
            projection
          }
        });

        const batch = response.data || [];

        if (!batch || batch.length === 0) {
          hasMore = false;
          break;
        }

        totalProcessed += batch.length;

        for (const device of batch) {
          const deviceId = device._id;
          if (!deviceId) continue;

          // Verificar si tiene parámetros básicos
          const hasParams = device?.InternetGatewayDevice?.DeviceInfo?.Manufacturer;

          if (!hasParams) {
            // Verificar si ya se le envió refresh recientemente (en última hora)
            const lastBootstrap = db.prepare(`
              SELECT created_at FROM device_bootstrap_log
              WHERE device_id = ?
              AND datetime(created_at) > datetime('now', '-1 hour')
              LIMIT 1
            `).get(deviceId);

            if (!lastBootstrap && refreshCount < MAX_REFRESH_PER_CYCLE) {
              try {
                console.log(`[device-bootstrap] Enviando refreshObject a ${deviceId}`);
                await nbi.post(`/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, {
                  name: 'refreshObject',
                  objectName: ''
                });

                // Registrar en BD. OR REPLACE es clave: con OR IGNORE el created_at
                // nunca se actualizaba y el device recibía refresh en CADA ciclo.
                db.prepare(`
                  INSERT OR REPLACE INTO device_bootstrap_log (device_id, created_at)
                  VALUES (?, datetime('now'))
                `).run(deviceId);

                refreshCount++;
              } catch (err) {
                console.error(`[device-bootstrap] Error enviando refreshObject a ${deviceId}:`, err.message);
              }
            }
          }
        }

        if (batch.length < BATCH_SIZE) {
          hasMore = false;
        }

        skip += BATCH_SIZE;
        console.log(`[device-bootstrap] Procesados ${totalProcessed} dispositivos...`);

      } catch (err) {
        console.error(`[device-bootstrap] Error en lote skip=${skip}:`, err.message);
        hasMore = false;
      }
    }

    console.log(`[device-bootstrap] ✓ Análisis completado: ${totalProcessed} devices, ${refreshCount} refreshObject(s) enviados`);

  } catch (err) {
    console.error('[device-bootstrap] Error general:', err.message);
  } finally {
    isRunning = false;
  }
}

function startDeviceBootstrap() {
  console.log('[device-bootstrap] Iniciando monitor de dispositivos nuevos...');

  // Crear tabla de log si no existe
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_bootstrap_log (
      device_id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Ejecutar inmediatamente
  bootstrapNewDevices();

  // Luego ejecutar cada CHECK_INTERVAL
  setInterval(bootstrapNewDevices, CHECK_INTERVAL);

  console.log(`[device-bootstrap] ✓ Bootstrap monitor activo (verificando cada ${CHECK_INTERVAL / 1000}s)`);
}

module.exports = { startDeviceBootstrap };
