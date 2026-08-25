'use strict';

const express = require('express');
const { nbi } = require('../config/genieacs');
const { requireAdmin } = require('../middleware/authorize');
const { logAction } = require('../middleware/audit');

const router = express.Router();

// GET /api/faults?limit=&skip=&query=&sort=
router.get('/', async (req, res, next) => {
  try {
    const params = {};
    if (req.query.limit) params.limit = req.query.limit;
    if (req.query.skip) params.skip = req.query.skip;
    if (req.query.query) params.query = req.query.query;
    if (req.query.projection) params.projection = req.query.projection;
    // GenieACS NBI soporta ?sort={"timestamp":-1} — ordenar por más reciente primero
    params.sort = req.query.sort || '{"timestamp":-1}';

    const { data, headers } = await nbi.get('/faults/', { params });

    let faults = Array.isArray(data) ? data : [];

    // Fallback: si el NBI no ordenó (o versión sin sort), ordenar localmente desc por timestamp
    const needsLocalSort = !req.query.sort || req.query.sort.includes('"timestamp"');
    if (needsLocalSort && faults.length > 1) {
      const ts = (f) => {
        const v = f.timestamp;
        if (!v) return 0;
        if (typeof v === 'object' && v.$date) return new Date(v.$date).getTime() || 0;
        if (typeof v === 'string') return new Date(v).getTime() || 0;
        if (typeof v === 'number') return v;
        return 0;
      };
      // Solo aplicar si parece desordenado: verificar si algún elemento posterior es más nuevo
      let ordered = true;
      for (let i = 1; i < faults.length; i++) {
        if (ts(faults[i]) > ts(faults[i - 1])) { ordered = false; break; }
      }
      if (!ordered) faults = [...faults].sort((a, b) => ts(b) - ts(a));
    }

    // Total real vía header `total` del NBI (GenieACS 1.2.x lo envía); fallback a length
    let total = null;
    if (headers) {
      const raw = headers.total ?? headers.Total ?? headers['x-total'];
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) total = n;
      }
    }
    if (total == null) total = faults.length;

    // Compatibilidad: si el NBI devuelve total mayor que el batch, informar paginación real
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : faults.length;
    const parsedSkip = parseInt(req.query.skip, 10);
    const skip = Number.isFinite(parsedSkip) && parsedSkip > 0 ? parsedSkip : 0;

    // Si el header no estuvo y hay paginación activa (limit/skip), el total anterior
    // es solo el tamaño del batch. Intentar obtener count real con segunda query sin paginar
    // solo si el NBI no envió total y el batch parece truncado.
    if (headers && (headers.total == null && headers.Total == null) && req.query.limit && faults.length === limit) {
      try {
        const countParams = {};
        if (req.query.query) countParams.query = req.query.query;
        // Pedir solo 1 para no traer todo: el header total igualmente refleja el count
        const countRes = await nbi.get('/faults/', { params: { ...countParams, limit: 1 } });
        const ct = countRes.headers?.total ?? countRes.headers?.Total;
        if (ct != null) {
          const n = parseInt(ct, 10);
          if (Number.isFinite(n)) total = n;
        }
      } catch (_) { /* fallback ya definido */ }
    }

    res.json({ faults, total, skip, limit });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/faults/:id  — id formato "deviceId:channel"
router.delete(
  '/:id',
  requireAdmin,
  (req, res, next) => logAction('fault_delete', () => req.params.id)(req, res, next),
  async (req, res, next) => {
    try {
      await nbi.delete(`/faults/${encodeURIComponent(req.params.id)}`);
      res.json({ message: 'Falla eliminada' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
