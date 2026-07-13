'use strict';

const { getDb } = require('../config/db');
const { nbi } = require('../config/genieacs');

// Intervalo en milisegundos (60 segundos = 1 minuto)
const CHECK_INTERVAL = 60 * 1000;

let isRunning = false;

async function executeScheduledAction(action, db) {
  try {
    console.log(`[scheduler] Ejecutando acción programada #${action.id}: ${action.device_id}`);

    const parameters = [
      [action.parameter_path, action.new_value, action.parameter_type || 'xsd:string']
    ];

    const task = {
      name: 'setParameterValues',
      parameterValues: parameters
    };

    const response = await nbi.post(`/devices/${encodeURIComponent(action.device_id)}/tasks?connection_request`, task);
    console.log(`[scheduler] ✓ Acción aplicada #${action.id}:`, response.status);

    // Marcar como aplicada
    db.prepare(`
      UPDATE pending_actions
      SET status = 'applied', applied_at = datetime('now')
      WHERE id = ?
    `).run(action.id);

    return { success: true, id: action.id };
  } catch (err) {
    console.error(`[scheduler] ✗ Error en acción #${action.id}:`, err.message);

    // Registrar el error en la BD
    db.prepare(`
      UPDATE pending_actions
      SET status = 'failed', error = ?
      WHERE id = ?
    `).run(err.message, action.id);

    return { success: false, id: action.id, error: err.message };
  }
}

async function checkAndExecuteScheduledActions() {
  if (isRunning) return;
  isRunning = true;

  try {
    const db = getDb();

    // Obtener acciones programadas cuya hora ya pasó
    const actions = db.prepare(`
      SELECT * FROM pending_actions
      WHERE status = 'scheduled'
      AND scheduled_for IS NOT NULL
      AND datetime(scheduled_for) <= datetime('now')
      ORDER BY scheduled_for ASC
    `).all();

    if (actions.length === 0) {
      isRunning = false;
      return;
    }

    console.log(`[scheduler] Encontradas ${actions.length} acción(es) para ejecutar`);

    const results = [];
    for (const action of actions) {
      const result = await executeScheduledAction(action, db);
      results.push(result);
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    console.log(`[scheduler] Resultados: ${successCount} exitosa(s), ${failCount} error(es)`);

  } catch (err) {
    console.error('[scheduler] Error general:', err.message);
  } finally {
    isRunning = false;
  }
}

function startScheduler() {
  console.log('[scheduler] Iniciando verificador de acciones programadas...');

  // Ejecutar inmediatamente
  checkAndExecuteScheduledActions();

  // Luego ejecutar cada CHECK_INTERVAL
  setInterval(checkAndExecuteScheduledActions, CHECK_INTERVAL);

  console.log(`[scheduler] ✓ Scheduler activo (verificando cada ${CHECK_INTERVAL / 1000}s)`);
}

module.exports = { startScheduler };
