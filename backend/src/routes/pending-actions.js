'use strict';

const express = require('express');
const { getDb } = require('../config/db');
const { nbi } = require('../config/genieacs');
const { requireAdmin } = require('../middleware/authorize');
const { logAction } = require('../middleware/audit');

const router = express.Router();

// GET /api/pending-actions - Listar acciones pendientes (con paginación y filtros)
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const { limit = 25, skip = 0, status, deviceId, userId } = req.query;
    const isAdmin = req.user.role === 'admin';

    // Construir filtros
    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (deviceId) {
      whereClause += ' AND device_id = ?';
      params.push(deviceId);
    }

    // Los admins pueden filtrar por usuario, viewers ven todas
    if (userId && isAdmin) {
      whereClause += ' AND user_id = ?';
      params.push(userId);
    }

    // Total de registros
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM pending_actions WHERE ${whereClause}`);
    const { count } = countStmt.all(...params)[0];

    // Datos paginados
    const stmt = db.prepare(`
      SELECT * FROM pending_actions
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const actions = stmt.all(...params, parseInt(limit), parseInt(skip));

    // Convertir fechas a ISO 8601 para que el frontend las interprete como UTC
    const actionsWithISO = actions.map(a => ({
      ...a,
      created_at: a.created_at ? new Date(a.created_at).toISOString() : null,
      scheduled_for: a.scheduled_for ? new Date(a.scheduled_for).toISOString() : null,
      applied_at: a.applied_at ? new Date(a.applied_at).toISOString() : null
    }));

    res.json({ actions: actionsWithISO, total: count });
  } catch (err) {
    next(err);
  }
});

// POST /api/pending-actions - Crear nueva acción pendiente
router.post('/', async (req, res, next) => {
  try {
    const { deviceId, deviceIp, parameterPath, parameterType, oldValue, newValue, scheduledFor } = req.body;

    if (!deviceId || !parameterPath || newValue === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO pending_actions (user_id, username, device_id, device_ip, parameter_path, parameter_type, old_value, new_value, status, scheduled_for)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const status = scheduledFor ? 'scheduled' : 'pending';
    const result = stmt.run(
      req.user.id,
      req.user.username,
      deviceId,
      deviceIp,
      parameterPath,
      parameterType,
      oldValue ?? null,
      String(newValue),
      status,
      scheduledFor || null
    );

    logAction('action_create', () => `${deviceId}:${parameterPath}`)(req, res, () => {});

    res.status(201).json({ id: result.lastInsertRowid, message: 'Acción creada' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/pending-actions/:id - Eliminar una acción
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const isAdmin = req.user.role === 'admin';

    // Verificar que existe y que el usuario tiene permiso
    const action = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(req.params.id);
    if (!action) return res.status(404).json({ error: 'Acción no encontrada' });

    if (!isAdmin && action.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta acción' });
    }

    db.prepare('DELETE FROM pending_actions WHERE id = ?').run(req.params.id);

    logAction('action_delete', () => `${action.device_id}:${action.parameter_path}`)(req, res, () => {});

    res.json({ message: 'Acción eliminada' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/pending-actions/:id - Actualizar fecha de ejecución
router.patch('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const { scheduledFor } = req.body;
    const isAdmin = req.user.role === 'admin';

    const action = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(req.params.id);
    if (!action) return res.status(404).json({ error: 'Acción no encontrada' });

    if (!isAdmin && action.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso para modificar esta acción' });
    }

    const status = scheduledFor ? 'scheduled' : 'pending';
    db.prepare('UPDATE pending_actions SET scheduled_for = ?, status = ? WHERE id = ?').run(
      scheduledFor || null,
      status,
      req.params.id
    );

    res.json({ message: 'Acción actualizada' });
  } catch (err) {
    next(err);
  }
});

// POST /api/pending-actions/:id/apply - Aplicar una acción individual
router.post('/:id/apply', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const action = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(req.params.id);

    if (!action) return res.status(404).json({ error: 'Acción no encontrada' });

    await applyAction(action, db);

    res.json({ message: 'Acción aplicada' });
  } catch (err) {
    next(err);
  }
});

// POST /api/pending-actions/apply-batch - Aplicar múltiples acciones
router.post('/apply-batch', requireAdmin, async (req, res, next) => {
  try {
    const { actionIds } = req.body;

    if (!Array.isArray(actionIds) || actionIds.length === 0) {
      return res.status(400).json({ error: 'actionIds debe ser un array no vacío' });
    }

    const db = getDb();
    const results = [];

    // Agrupar por dispositivo
    const placeholders = actionIds.map(() => '?').join(',');
    const actions = db.prepare(`
      SELECT * FROM pending_actions
      WHERE id IN (${placeholders}) AND status != 'applied'
    `).all(...actionIds);

    // Agrupar por deviceId
    const byDevice = {};
    for (const action of actions) {
      if (!byDevice[action.device_id]) byDevice[action.device_id] = [];
      byDevice[action.device_id].push(action);
    }

    // Aplicar por dispositivo
    for (const [deviceId, deviceActions] of Object.entries(byDevice)) {
      try {
        console.log(`[pending-actions] Aplicando ${deviceActions.length} acción(es) al dispositivo ${deviceId}`);
        await applyActionsForDevice(deviceId, deviceActions, db);
        console.log(`[pending-actions] ✓ Acciones aplicadas para ${deviceId}`);
        results.push({ deviceId, success: true });
      } catch (err) {
        console.error(`[pending-actions] ✗ Error aplicando acciones a ${deviceId}:`, err.message, err.response?.data || '');
        results.push({ deviceId, success: false, error: err.message });
      }
    }

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// Función auxiliar: Aplicar una acción individual
async function applyAction(action, db) {
  // Formato correcto: array de arrays [nombre, valor, tipo]
  const parameters = [
    [action.parameter_path, action.new_value, action.parameter_type || 'xsd:string']
  ];

  const task = {
    name: 'setParameterValues',
    parameterValues: parameters
  };

  try {
    console.log(`[nbi] POST /devices/${encodeURIComponent(action.device_id)}/tasks?connection_request`, JSON.stringify(task));
    const response = await nbi.post(`/devices/${encodeURIComponent(action.device_id)}/tasks?connection_request`, task);
    console.log(`[nbi] Response:`, response.status, response.data);
  } catch (err) {
    console.error(`[nbi] Error:`, err.code, err.message);
    if (err.response) {
      console.error(`[nbi] Response status:`, err.response.status, err.response.data);
    }
    throw err;
  }

  db.prepare(`
    UPDATE pending_actions
    SET status = 'applied', applied_at = datetime('now')
    WHERE id = ?
  `).run(action.id);
}

// Función auxiliar: Aplicar múltiples acciones para un dispositivo
async function applyActionsForDevice(deviceId, actions, db) {
  // Formato correcto: array de arrays [nombre, valor, tipo]
  const parameters = actions.map(a => [
    a.parameter_path,
    a.new_value,
    a.parameter_type || 'xsd:string'
  ]);

  const task = {
    name: 'setParameterValues',
    parameterValues: parameters
  };

  try {
    console.log(`[nbi] POST /devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, JSON.stringify(task));
    const response = await nbi.post(`/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, task);
    console.log(`[nbi] Response:`, response.status, response.data);
  } catch (err) {
    console.error(`[nbi] Error code: ${err.code}, message: ${err.message}`);
    if (err.response) {
      console.error(`[nbi] Response status: ${err.response.status}`, err.response.data);
    }
    throw err;
  }

  // Marcar todas como aplicadas
  const ids = actions.map(a => a.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`
    UPDATE pending_actions
    SET status = 'applied', applied_at = datetime('now')
    WHERE id IN (${placeholders})
  `).run(...ids);
}

module.exports = router;
