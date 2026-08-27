'use strict';

const express = require('express');
const { nbi } = require('../config/genieacs');
const { extractMgmtIp } = require('../lib/mgmt-ip');
const { lastInformMs, filterDevices } = require('../lib/device-filters');
const { normalizeManufacturer, normalizeModel, normalizeDevice } = require('../lib/device-normalizer');
const { getDb } = require('../config/db');
const { requireAdmin } = require('../middleware/authorize');
const { logAction } = require('../middleware/audit');

const router = express.Router();

// Snapshot de flota para el listado: filtrar/buscar server-side exige ver la
// flota completa ANTES de paginar (el filtro client-side sobre páginas ya
// recortadas mostraba tablas casi vacías con el filtro Offline). Escaneamos
// con proyección ligera en lotes y cacheamos 60s para no golpear el NBI en
// cada cambio de página o tecla de búsqueda.
const SNAPSHOT_TTL = 60 * 1000;
const SCAN_BATCH_SIZE = 500;

// ConnectionRequestURL es una hoja en path fijo (viene en cada Inform TR-069),
// igual que ModelName; _deviceId aporta el fallback de modelo (_ProductClass).
const SNAPSHOT_PROJECTION =
  '_id,_lastInform,_deviceId,InternetGatewayDevice.DeviceInfo.ModelName,InternetGatewayDevice.ManagementServer.ConnectionRequestURL';

let snapshotCache = null;
let snapshotPromise = null;

/**
 * Construye el snapshot enriquecido escaneando el NBI por lotes.
 * Ante error en cualquier lote se aborta TODO el build: servir media flota
 * haría que los filtros online/offline y la paginación mientan silenciosamente.
 */
async function buildSnapshot() {
  const startedAt = Date.now();
  const devices = [];
  let skip = 0;

  while (true) {
    const { data: batch } = await nbi.get('/devices/', {
      params: { limit: SCAN_BATCH_SIZE, skip, projection: SNAPSHOT_PROJECTION }
    });

    if (!batch || batch.length === 0) break;

    for (const device of batch) {
      // Documento liviano: lo justo para listar, filtrar y buscar.
      // Normalizamos manufacturer/modelo en capa de presentación (spec: 3 fabricantes, 5 buckets Zhone).
      const { manufacturer: normManufacturer, model: normModel } = normalizeDevice(device);
      devices.push({
        _id: device._id,
        _lastInform: device._lastInform,
        _lastInformMs: lastInformMs(device),
        _deviceId: device._deviceId,
        InternetGatewayDevice: {
          DeviceInfo: { ModelName: device.InternetGatewayDevice?.DeviceInfo?.ModelName }
        },
        _manufacturer: normManufacturer,
        // Fallback a _ProductClass + normalización a 5 buckets comerciales (2424/2424A/2424A1/2426A/2426A1)
        // + legacy ZNID24xx* -> bucket más cercano. "Otro" cuando vacío/desconocido.
        _model: normModel,
        _mgmtIp: extractMgmtIp(device)
      });
    }

    if (batch.length < SCAN_BATCH_SIZE) break;
    skip += SCAN_BATCH_SIZE;
  }

  console.log(
    `[devices] Snapshot de flota construido: ${devices.length} dispositivos en ${Date.now() - startedAt}ms`
  );
  return devices;
}

/**
 * Devuelve el snapshot vigente, deduplicando builds concurrentes: si llegan
 * varias requests mientras se escanea, todas esperan la MISMA promesa en
 * lugar de disparar scans paralelos contra el NBI.
 */
function getSnapshot() {
  if (snapshotCache && Date.now() - snapshotCache.ts < SNAPSHOT_TTL) {
    return Promise.resolve(snapshotCache.devices);
  }
  if (!snapshotPromise) {
    snapshotPromise = buildSnapshot()
      .then(devices => {
        snapshotCache = { devices, ts: Date.now() };
        return devices;
      })
      .finally(() => {
        // Un build fallido no debe envenenar las siguientes requests: sin
        // cache nuevo, la próxima request reintenta el scan desde cero.
        snapshotPromise = null;
      });
  }
  return snapshotPromise;
}

/**
 * IDs con acciones pendientes en SQLite. better-sqlite3 es síncrono, así que
 * la consulta es barata comparada con el scan del NBI.
 */
function loadPendingIds() {
  const rows = getDb()
    .prepare("SELECT DISTINCT device_id FROM pending_actions WHERE status = 'pending'")
    .all();
  return new Set(rows.map(row => row.device_id));
}

// GET /api/devices?search=&status=&limit=&skip=
//
// Filtra y pagina sobre el snapshot de flota: search (substring insensible a
// mayúsculas sobre ID/modelo/IP MGMT), status (online/offline/pending) y luego
// slice skip..skip+limit. El filtrado ocurre SIEMPRE antes de paginar, así que
// las páginas son coherentes con el filtro activo.
//
// Responde { total, skip, limit, devices }: total es el tamaño del conjunto
// FILTRADO completo, no el de la página — la UI lo usa para el contador y el
// paginador ("1–25 de N").
router.get('/', async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const manufacturerFilter = typeof req.query.manufacturer === 'string' ? req.query.manufacturer.trim() : '';
    const modelFilter = typeof req.query.model === 'string' ? req.query.model.trim() : '';

    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 25, 200);
    const parsedSkip = parseInt(req.query.skip, 10);
    const skip = Number.isFinite(parsedSkip) && parsedSkip > 0 ? parsedSkip : 0;

    const snapshot = await getSnapshot();

    // El set de pendientes solo se consulta cuando el filtro lo necesita.
    const pendingIds = status === 'pending' ? loadPendingIds() : null;

    let filtered = filterDevices(snapshot, { search, status, pendingIds, now: Date.now() });
    // Filtros normalizados por fabricante/modelo (presentation-only, compara contra valores normalizados del snapshot)
    if (manufacturerFilter) {
      const normMan = normalizeManufacturer(manufacturerFilter);
      filtered = filtered.filter(d => d._manufacturer === normMan);
    }
    if (modelFilter) {
      filtered = filtered.filter(d => {
        const normForDevice = normalizeModel(modelFilter, d._manufacturer);
        return d._model === normForDevice || d._model.toLowerCase() === modelFilter.trim().toLowerCase();
      });
    }

    res.json({
      total: filtered.length,
      skip,
      limit,
      devices: filtered.slice(skip, skip + limit)
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/devices/:id — parámetros completos del dispositivo
router.get('/:id', async (req, res, next) => {
  try {
    const query = JSON.stringify({ _id: req.params.id });
    const { data } = await nbi.get('/devices/', { params: { query } });
    if (!data.length) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    res.json(data[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/devices/:id/tasks  (admin)
router.post(
  '/:id/tasks',
  requireAdmin,
  (req, res, next) => logAction('device_task', () => req.params.id)(req, res, next),
  async (req, res, next) => {
    try {
      const connReq = req.query.connection_request !== undefined ? '?connection_request' : '';
      const { data, status } = await nbi.post(
        `/devices/${encodeURIComponent(req.params.id)}/tasks${connReq}`,
        req.body
      );
      res.status(status).json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/devices/stats/summary - Estadísticas de dispositivos para el dashboard
// Optimizado: projection (solo 4 campos por device en vez del documento completo)
// + cache en memoria de 60s para no golpear el NBI en cada carga del dashboard.
let statsCache = { data: null, ts: 0 };
const STATS_CACHE_TTL = 60 * 1000;

// Normaliza un parámetro TR-069 a string: puede venir como
// {_value, _type}, como valor crudo o no venir.
function paramValue(param) {
  if (param == null) return '';
  if (typeof param === 'object') return String(param._value ?? '');
  return String(param);
}

router.get('/stats/summary', async (req, res, next) => {
  if (statsCache.data && Date.now() - statsCache.ts < STATS_CACHE_TTL) {
    return res.json(statsCache.data);
  }
  try {
    const BATCH_SIZE = 500;
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const projection = '_id,_lastInform,_deviceId,InternetGatewayDevice.DeviceInfo.Manufacturer,InternetGatewayDevice.DeviceInfo.ModelName';

    let totalDevices = 0;
    let onlineCount = 0;
    const manufacturers = new Set();
    const models = new Set();
    const brands = new Map();

    // Procesar dispositivos en lotes de 500
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const { data: batch } = await nbi.get('/devices/', {
          params: {
            limit: BATCH_SIZE,
            skip,
            projection
          }
        });

        if (!batch || batch.length === 0) {
          hasMore = false;
          break;
        }

        totalDevices += batch.length;

        batch.forEach(device => {
          // Verificar si está online
          const lastInform = device._lastInform;
          if (lastInform) {
            let t;
            try {
              if (typeof lastInform === 'object' && lastInform.$date) {
                t = new Date(lastInform.$date).getTime();
              } else if (typeof lastInform === 'string') {
                t = new Date(lastInform).getTime();
              } else if (typeof lastInform === 'number') {
                t = lastInform;
              } else {
                t = 0;
              }
            } catch (e) {
              t = 0;
            }

            if (t > fiveMinAgo) {
              onlineCount++;
            }
          }

          // Fabricante y modelo — normalizados a capa de presentación (spec: 3 fabricantes, 5 buckets Zhone)
          let rawManufacturer = 'Desconocido';
          let rawModelName = 'Desconocido';

          const deviceInfo = device.InternetGatewayDevice?.DeviceInfo;
          if (deviceInfo) {
            rawManufacturer = paramValue(deviceInfo.Manufacturer) || 'Desconocido';
            rawModelName = paramValue(deviceInfo.ModelName) || 'Desconocido';
          }

          // Fallback: algunos CPEs (p.ej. Zhone ZNID) no incluyen
          // DeviceInfo.Manufacturer/ModelName en el Inform, pero el header
          // DeviceId del SOAP (obligatorio en TR-069) siempre los trae.
          const deviceIdMeta = device._deviceId || {};
          if (rawManufacturer === 'Desconocido' && deviceIdMeta._Manufacturer) {
            rawManufacturer = deviceIdMeta._Manufacturer;
          }
          if (rawModelName === 'Desconocido' && deviceIdMeta._ProductClass) {
            rawModelName = deviceIdMeta._ProductClass;
          }

          const manufacturer = normalizeManufacturer(rawManufacturer);
          const modelName = normalizeModel(rawModelName, manufacturer);

          manufacturers.add(manufacturer);
          models.add(modelName);

          const count = brands.get(manufacturer) || 0;
          brands.set(manufacturer, count + 1);
        });

        // Si recibimos menos que BATCH_SIZE, no hay más
        if (batch.length < BATCH_SIZE) {
          hasMore = false;
        }

        skip += BATCH_SIZE;

        console.log(`[stats/summary] Procesados ${totalDevices} dispositivos...`);
      } catch (err) {
        console.error(`[stats/summary] Error en lote skip=${skip}:`, err.message);
        hasMore = false;
      }
    }

    const offlineCount = totalDevices - onlineCount;

    const result = {
      total: totalDevices,
      online: onlineCount,
      offline: offlineCount,
      manufacturerCount: manufacturers.size,
      modelCount: models.size,
      brands: Array.from(brands, ([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
    };

    statsCache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('[stats/summary error]', err.message);
    next(err);
  }
});

// DELETE /api/devices/:id  (admin)
router.delete(
  '/:id',
  requireAdmin,
  (req, res, next) => logAction('device_delete', () => req.params.id)(req, res, next),
  async (req, res, next) => {
    try {
      await nbi.delete(`/devices/${encodeURIComponent(req.params.id)}`);
      res.json({ message: 'Dispositivo eliminado' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
