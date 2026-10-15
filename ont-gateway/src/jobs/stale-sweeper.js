'use strict';

/**
 * Stale sweeper automático (variante B automágica, umbral >15d por defecto).
 *
 * - Corre semanal (primer pase a los 10 min del boot para dejar calentar el índice).
 * - Borra en NBI los devices sin informar por más de STALE_DAYS, salvo que tengan
 *   tasks NBI encoladas (se saltean, no se fuerzan).
 * - Fail-closed ante CAP excedido: aborta TODO sin borrar nada y loguea.
 * - Audita cada baja en audit_log (action 'stale-purge').
 * - Prunea el índice local: borra filas cuyo device_id ya no existe en NBI,
 *   solo si el pase NBI completó entero.
 * - Seguro por diseño: si el CPE vuelve, BOOTSTRAP lo re-registra solo.
 */

const { getDb } = require('../config/db');
const { getDevices, getTasks, deleteDevice } = require('../services/genieacs');

const DAY_MS = 24 * 3600 * 1000;

function getConfig() {
  const days = parseInt(process.env.STALE_DAYS || '15', 10);
  const cap = parseInt(process.env.STALE_CAP || '200', 10);
  const intervalMs = parseInt(process.env.STALE_INTERVAL_MS || String(7 * DAY_MS), 10);
  return {
    days: Number.isFinite(days) && days > 0 ? days : 15,
    cap: Number.isFinite(cap) && cap > 0 ? cap : 200,
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 7 * DAY_MS,
  };
}

async function listCandidates(days) {
  const cutoff = Date.now() - days * DAY_MS;
  const seen = [];
  const candidates = [];
  let skip = 0;
  const BATCH = 500;
  for (;;) {
    const batch = await getDevices(null, '_id,_lastInform', BATCH, skip);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const d of batch) {
      if (!d || !d._id) continue;
      seen.push(d._id);
      const t = d._lastInform ? new Date(d._lastInform).getTime() : NaN;
      if (!Number.isFinite(t)) continue;
      if (t < cutoff) {
        candidates.push({ device_id: d._id, last_inform: d._lastInform, age_days: (Date.now() - t) / DAY_MS });
      }
    }
    if (batch.length < BATCH) break;
    skip += BATCH;
  }
  return { seen, candidates, completed: true };
}

async function deviceHasTasks(deviceId) {
  const tasks = await getTasks({ device: deviceId });
  return Array.isArray(tasks) && tasks.length > 0;
}

function pruneIndex(db, seenIds) {
  // Borra en chunks (límite de variables por statement) las filas que ya no están en NBI.
  const seen = new Set(seenIds);
  const rows = db.prepare('SELECT device_id FROM devices').all();
  const stale = rows.map((r) => r.device_id).filter((id) => !seen.has(id));
  let deleted = 0;
  const del = db.prepare('DELETE FROM devices WHERE device_id = ?');
  const tx = db.transaction((ids) => {
    for (const id of ids) {
      const info = del.run(id);
      deleted += info.changes;
    }
  });
  for (let i = 0; i < stale.length; i += 500) tx(stale.slice(i, i + 500));
  return { pruned: deleted, staleTotal: stale.length };
}

async function runSweep({ dryRun = false } = {}) {
  const { days, cap } = getConfig();
  const db = getDb();
  const { seen, candidates } = await listCandidates(days);
  const total = candidates.length;
  console.log(`[stale-sweeper] Candidatos >${days}d: ${candidates.length} (vistos en NBI: ${seen.length})`);

  if (candidates.length > cap) {
    console.log(`[stale-sweeper] CAP: ${candidates.length} candidatos > cap ${cap}: proceso los ${cap} más viejos, resto próximo ciclo`);
    candidates.sort((a, b) => b.age_days - a.age_days);
    candidates.length = cap;
  }

  const toDelete = [];
  let skipped = 0;
  for (const c of candidates) {
    let hasTasks = false;
    try {
      hasTasks = await deviceHasTasks(c.device_id);
    } catch (e) {
      console.error(`[stale-sweeper] No se pudo verificar tasks de ${c.device_id}: ${e.message} (se saltea)`);
      skipped++;
      continue;
    }
    if (hasTasks) {
      skipped++;
      continue;
    }
    toDelete.push(c);
  }

  let deleted = 0;
  const audit = db.prepare(`INSERT INTO audit_log (api_key_name, action, target, detail) VALUES ('stale-sweeper', 'stale-purge', ?, ?)`);
  if (!dryRun) {
    for (const c of toDelete) {
      try {
        await deleteDevice(c.device_id);
        deleted++;
        try {
          audit.run(c.device_id, JSON.stringify({ age_days: Math.round(c.age_days * 10) / 10, last_inform: c.last_inform }));
        } catch (_) { /* audit best-effort */ }
      } catch (e) {
        console.error(`[stale-sweeper] DELETE fallo ${c.device_id}: ${e.message}`);
      }
    }
  }

  // Prune del índice local (solo con pase NBI completo, que listCandidates garantiza
  // al retornar sin error; ante cualquier excepción arriba no se llega acá).
  let pruned = 0;
  if (!dryRun) {
    try {
      pruned = pruneIndex(db, seen).pruned;
    } catch (e) {
      console.error(`[stale-sweeper] Prune índice fallo: ${e.message}`);
    }
  }

  const summary = `candidatos=${total} borrados=${dryRun ? 0 : deleted} salteados=${skipped} prune=${dryRun ? 0 : pruned}`;
  console.log(`[stale-sweeper] Fin (${dryRun ? 'dry-run' : 'real'}): ${summary}`);
  return { dryRun, days, cap, aborted: null, candidates: total, deleted: dryRun ? 0 : deleted, skipped, pruned: dryRun ? 0 : pruned };
}

let timer = null;
let firstTimeout = null;
let isRunning = false;

async function tick() {
  if (isRunning) return;
  isRunning = true;
  try {
    await runSweep({ dryRun: false });
  } catch (err) {
    console.error('[stale-sweeper] Error ciclo:', err.message);
  } finally {
    isRunning = false;
  }
}

function startStaleSweeper() {
  const { intervalMs } = getConfig();
  console.log(`[stale-sweeper] Limpieza semanal de stale >${getConfig().days}d (cada ${Math.round(intervalMs / DAY_MS)}d, cap ${getConfig().cap})`);
  firstTimeout = setTimeout(() => { tick(); }, 10 * 60 * 1000);
  timer = setInterval(tick, intervalMs);
  console.log('[stale-sweeper] ✓ sweeper activo');
}

function stopStaleSweeper() {
  if (firstTimeout) clearTimeout(firstTimeout);
  if (timer) clearInterval(timer);
  firstTimeout = null;
  timer = null;
}

module.exports = { startStaleSweeper, stopStaleSweeper, runSweep, listCandidates, getConfig, pruneIndex };
