'use strict';

const express = require('express');
const { nbi } = require('../config/genieacs');
const { extractMgmtIp } = require('../lib/mgmt-ip');
const { requireAdmin } = require('../middleware/authorize');
const { logAction } = require('../middleware/audit');

const router = express.Router();

// Proyección usada al resolver la IP de gestión: ConnectionRequestURL es una
// hoja en path fijo (viene en cada Inform TR-069), igual que ModelName.
const MGMT_IP_PROJECTION =
  'InternetGatewayDevice.DeviceInfo.ModelName,InternetGatewayDevice.ManagementServer.ConnectionRequestURL,_lastInform';

// GET /api/devices?limit=&skip=&query=&projection=&resolve=mgmt_ip
//
// resolve=mgmt_ip: resuelve la IP de gestión de cada dispositivo a partir de
// ConnectionRequestURL (la misma fuente que usa el detalle) y responde cada
// device con un campo plano `_mgmtIp`, sin exponer el parámetro crudo.
router.get('/', async (req, res, next) => {
  try {
    const resolveMgmtIp = req.query.resolve === 'mgmt_ip';
    const params = {};
    if (req.query.limit) params.limit = req.query.limit;
    if (req.query.skip) params.skip = req.query.skip;
    if (req.query.query) params.query = req.query.query;
    if (resolveMgmtIp) {
      params.projection = MGMT_IP_PROJECTION;
    } else if (req.query.projection) {
      params.projection = req.query.projection;
    }

    const { data } = await nbi.get('/devices/', { params });

    if (!resolveMgmtIp) return res.json(data);

    res.json(
      data.map(device => {
        const mgmtIp = extractMgmtIp(device);
        delete device.InternetGatewayDevice?.ManagementServer;
        return { ...device, _mgmtIp: mgmtIp };
      })
    );
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

          // Fabricante y modelo
          let manufacturer = 'Desconocido';
          let modelName = 'Desconocido';

          const deviceInfo = device.InternetGatewayDevice?.DeviceInfo;
          if (deviceInfo) {
            manufacturer = paramValue(deviceInfo.Manufacturer) || 'Desconocido';
            modelName = paramValue(deviceInfo.ModelName) || 'Desconocido';
          }

          // Fallback: algunos CPEs (p.ej. Zhone ZNID) no incluyen
          // DeviceInfo.Manufacturer/ModelName en el Inform, pero el header
          // DeviceId del SOAP (obligatorio en TR-069) siempre los trae.
          // GenieACS lo persiste como objeto _deviceId.
          const deviceIdMeta = device._deviceId || {};
          if (manufacturer === 'Desconocido' && deviceIdMeta._Manufacturer) {
            manufacturer = deviceIdMeta._Manufacturer;
          }
          if (modelName === 'Desconocido' && deviceIdMeta._ProductClass) {
            modelName = deviceIdMeta._ProductClass;
          }

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
