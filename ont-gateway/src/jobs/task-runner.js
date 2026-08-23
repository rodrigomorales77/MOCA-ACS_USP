'use strict';

const { getDb } = require('../config/db');
const { getProfile } = require('../catalog/profiles');
const transformers = require('../../../mapping/transformers');

const INTERVAL_MS = 60 * 1000;

let isRunning = false;
let timer = null;

function buildNbiTask(taskRow) {
  const profile = getProfile(taskRow.profile);
  const action = taskRow.action;
  let payload = null;
  try {
    payload = taskRow.payload_canonical ? JSON.parse(taskRow.payload_canonical) : null;
  } catch (_) {
    payload = null;
  }

  // Direct action tasks (reboot, factoryReset, refreshObject, diagPing etc.)
  const actions = profile.actions || {};

  if (action === 'reboot' || action === 'actions.reboot' || action === 'factoryReset' || action === 'actions.factory_reset' || action === 'factory_reset') {
    const key = action.includes('factory') ? 'factory_reset' : 'reboot';
    const def = actions[key] || actions.reboot || actions.factory_reset || {};
    return { name: def.task || (key === 'factory_reset' ? 'factoryReset' : 'reboot'), commandKey: def.command_key || def.commandKey || (key === 'reboot' ? 'gateway-reboot' : 'gateway-factory-reset') };
  }

  if (action === 'refresh' || action === 'actions.refresh') {
    const def = actions.refresh || {};
    return { name: def.task || 'refreshObject', objectName: def.object_name || def.objectName || 'InternetGatewayDevice.DeviceInfo.' };
  }

  if (action === 'diagPing' || action === 'ping' || action === 'actions.ping') {
    const target = payload && (payload.target || payload.host || payload.value) ? (payload.target || payload.host || payload.value) : null;
    if (!target && payload && typeof payload === 'string') {
      return { name: 'setParameterValues', parameterValues: [] };
    }
    // GenieACS diagnostics: use vendor specific? Map to setParameterValues for Diagnostics.IPPing
    // Simpler: return diag task if defined
    const def = actions.ping || {};
    if (def.task) {
      // Some profiles use ping task name
      return { name: def.task, host: target || '' };
    }
    // Fallback to setParameterValues for IPPing
    return { name: 'setParameterValues', parameterValues: [[ 'InternetGatewayDevice.IPPingDiagnostics.Host', target || '', 'xsd:string' ]] };
  }

  if (action === 'diagTraceRoute' || action === 'traceroute' || action === 'actions.traceroute') {
    const target = payload && (payload.target || payload.host) ? (payload.target || payload.host) : '';
    const def = actions.traceroute || {};
    return { name: def.task || 'traceRoute', host: target };
  }

  // Default: setParameterValues from payload_canonical
  // payload is object { canonicalKey: deviceValue }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const parameterValues = [];
    for (const [canon, deviceValue] of Object.entries(payload)) {
      const def = profile.params && profile.params[canon];
      if (!def) continue;
      let tr069Path = def.path;
      if (tr069Path.includes('{i}')) {
        // Resolve {i} best-effort: replace with 1 (WAN) or 1 for LANDevice
        tr069Path = tr069Path.replace('{i}', '1');
      }
      // Determine XSD type from profile type
      let xsdType = 'xsd:string';
      if (def.type === 'int') xsdType = 'xsd:int';
      else if (def.type === 'boolean' || def.type === 'bool') xsdType = 'xsd:boolean';
      else if (def.type === 'float') xsdType = 'xsd:float';
      // Value must be string for NBI setParameterValues (GenieACS expects string)
      let valStr = deviceValue;
      if (typeof valStr === 'boolean') valStr = valStr ? 'true' : 'false';
      else if (valStr !== null && valStr !== undefined) valStr = String(valStr);
      else valStr = '';
      parameterValues.push([tr069Path, valStr, xsdType]);
    }
    if (parameterValues.length === 0 && payload && Object.keys(payload).length > 0) {
      // Fallback: treat payload as already parameterValues array
      return { name: 'setParameterValues', parameterValues: Object.entries(payload).map(([k, v]) => [k, String(v), 'xsd:string']) };
    }
    return { name: 'setParameterValues', parameterValues };
  }

  // If payload is already array of parameterValues
  if (Array.isArray(payload)) {
    return { name: 'setParameterValues', parameterValues: payload };
  }

  // Empty payload
  return { name: 'setParameterValues', parameterValues: [] };
}

async function tick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const db = getDb();

    // Expire vencidas
    try {
      const expired = db.prepare(`UPDATE tasks SET status='expired' WHERE status='pending' AND datetime('now') >= expires_at`).run();
      if (expired.changes > 0) console.log(`[task-runner] ${expired.changes} tarea(s) expirada(s)`);
    } catch (e) {
      console.error('[task-runner] Error expirando tareas:', e.message);
    }

    const pending = db.prepare(`SELECT * FROM tasks WHERE status='pending' AND datetime('now') < expires_at ORDER BY created_at ASC`).all();

    if (pending.length === 0) return;

    console.log(`[task-runner] Procesando ${pending.length} tarea(s) pending`);

    const { createTask } = require('../services/genieacs');

    for (const task of pending) {
      // max_attempts check for reboot/factoryReset
      const isDestructive = task.action === 'reboot' || task.action === 'factoryReset' || task.action === 'factory_reset' || task.action === 'actions.reboot' || task.action === 'actions.factory_reset';
      let maxAttempts = task.max_attempts;
      if (isDestructive && (maxAttempts === null || maxAttempts === undefined)) maxAttempts = 3;
      if (isDestructive && maxAttempts !== null && task.attempt_count >= maxAttempts) {
        db.prepare(`UPDATE tasks SET status='failed', error='max_attempts' WHERE id=?`).run(task.id);
        console.warn(`[task-runner] Tarea ${task.id} failed por max_attempts`);
        continue;
      }

      // Increment attempt_count
      db.prepare(`UPDATE tasks SET attempt_count = attempt_count + 1 WHERE id=?`).run(task.id);
      const updated = db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);

      let nbiPayload;
      try {
        nbiPayload = buildNbiTask(updated);
      } catch (e) {
        db.prepare(`UPDATE tasks SET status='failed', error=? WHERE id=?`).run(e.message.slice(0, 500), task.id);
        continue;
      }

      // Skip empty setParameterValues
      if (nbiPayload.name === 'setParameterValues' && (!nbiPayload.parameterValues || nbiPayload.parameterValues.length === 0)) {
        db.prepare(`UPDATE tasks SET status='failed', error='empty_parameterValues' WHERE id=?`).run(task.id);
        continue;
      }

      try {
        await createTask(updated.device_id, nbiPayload, true);
        db.prepare(`UPDATE tasks SET status='applied', applied_at=datetime('now'), result=? WHERE id=?`).run(JSON.stringify({ nbiPayload }), task.id);
        console.log(`[task-runner] Tarea ${task.id} applied -> ${updated.device_id}`);
      } catch (err) {
        const msg = (err.message || 'nbi_error').slice(0, 500);
        // Si es destructiva y ya alcanzó max_attempts tras este intento -> failed
        const currentAttempts = updated.attempt_count;
        if (isDestructive && maxAttempts !== null && currentAttempts >= maxAttempts) {
          db.prepare(`UPDATE tasks SET status='failed', error=? WHERE id=?`).run('max_attempts:' + msg, task.id);
          console.warn(`[task-runner] Tarea ${task.id} failed max_attempts tras fault: ${msg}`);
        } else {
          // permanece pending, guarda error temporal
          db.prepare(`UPDATE tasks SET error=? WHERE id=?`).run(msg, task.id);
          console.warn(`[task-runner] Tarea ${task.id} fault (reintento próximo ciclo): ${msg}`);
        }
      }
    }
  } catch (err) {
    console.error('[task-runner] Error ciclo:', err.message);
  } finally {
    isRunning = false;
  }
}

function startTaskRunner() {
  console.log('[task-runner] Iniciando task-runner (cada 60s)');
  // Ensure indexes
  try {
    const db = getDb();
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_serial ON tasks(serial);
    `);
  } catch (_) {}
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  console.log(`[task-runner] ✓ task-runner activo (intervalo ${INTERVAL_MS / 1000}s)`);
}

function stopTaskRunner() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startTaskRunner, stopTaskRunner, tick, buildNbiTask };
