'use strict';

/**
 * Mapping consistency check: cruza los paths mapeados de cada perfil contra
 * snapshots REALES (GenieACS Todd) y reporta "mapeado pero nunca visto".
 * 100% pasivo: solo lecturas NBI (Mongo), cero contacto con CPEs.
 *
 * Por perfil: hasta SAMPLE_PER_PROFILE devices frescos del índice, 1 query NBI
 * c/u con proyección de todos los paths, evaluación local. `{i}` cuenta como
 * visto si ALGUNA instancia trae valor no vacío. Resultado en tabla
 * mapping_consistency + endpoint GET /api/v1/maintenance/mapping-consistency.
 */

const { getDb } = require('../config/db');
const { loadProfiles } = require('../catalog/profiles');
const { getDevice } = require('../services/genieacs');
const { getByPath, extractRaw } = require('../mapping/engine');

const DAY_MS = 24 * 3600 * 1000;
const SAMPLE_PER_PROFILE = 50;

function getConfig() {
  const intervalMs = parseInt(process.env.CONSISTENCY_INTERVAL_MS || String(7 * DAY_MS), 10);
  return { intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 7 * DAY_MS };
}

function isEmptySnapshotValue(v) {
  if (v === undefined || v === null || v === '') return true;
  if (v && typeof v === 'object' && '_object' in v && !('_value' in v)) return true;
  if (v && typeof v === 'object' && '_value' in v && (v._value === undefined || v._value === null || v._value === '')) return true;
  return false;
}

// ¿El path (concreto o con {i}) tiene valor no vacío en el snapshot?
function pathSeen(snapshot, tr069Path) {
  if (!tr069Path.includes('{i}')) {
    return !isEmptySnapshotValue(extractRaw(snapshot, tr069Path));
  }
  const star = tr069Path.indexOf('{i}');
  const prefix = tr069Path.slice(0, star).replace(/\.$/, '');
  const suffix = tr069Path.slice(star + '{i}'.length);
  const parent = getByPath(snapshot, prefix);
  if (!parent || typeof parent !== 'object') return false;
  for (const k of Object.keys(parent)) {
    if (k.startsWith('_')) continue;
    const cand = `${prefix}.${k}${suffix}`;
    // Sufijo puede contener otro {i} (raro): solo primer nivel, resto literal.
    if (cand.includes('{i}')) continue;
    if (!isEmptySnapshotValue(extractRaw(snapshot, cand))) return true;
  }
  return false;
}

function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS mapping_consistency (
    profile TEXT NOT NULL,
    canonical TEXT NOT NULL,
    path TEXT NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    sampled INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (profile, canonical)
  )`);
  db.exec('CREATE TABLE IF NOT EXISTS consistency_state (id INTEGER PRIMARY KEY CHECK(id=1), last_run TEXT)');
}

async function runConsistency() {
  const db = getDb();
  ensureTables(db);
  const profiles = loadProfiles();
  const summary = [];
  for (const [name, prof] of profiles.entries()) {
    const params = (prof && prof.params) || {};
    const canonicals = Object.keys(params);
    if (canonicals.length === 0) continue;
    const rows = db.prepare(
      `SELECT device_id FROM devices WHERE profile = ? ORDER BY last_inform DESC LIMIT ?`
    ).all(name, SAMPLE_PER_PROFILE);
    if (rows.length === 0) continue;
    // Una proyección con todos los paths (wildcard donde hay {i}).
    const projSet = new Set();
    for (const c of canonicals) {
      const p = params[c] && params[c].path;
      if (typeof p === 'string' && p) projSet.add(p.includes('{i}') ? p.replace('{i}', '*') : p);
    }
    const projection = Array.from(projSet).join(',');
    const seen = {};
    for (const c of canonicals) seen[c] = 0;
    let sampled = 0;
    for (const r of rows) {
      let snap;
      try {
        snap = await getDevice(r.device_id, projection);
      } catch (_) {
        continue; // equipo borrado o NBI hiccup: no cuenta como muestra
      }
      sampled++;
      for (const c of canonicals) {
        const p = params[c] && params[c].path;
        if (typeof p !== 'string' || !p) continue;
        try {
          if (pathSeen(snap, p)) seen[c]++;
        } catch (_) { /* path raro: queda no visto */ }
      }
    }
    const upsert = db.prepare(`INSERT INTO mapping_consistency (profile, canonical, path, seen, sampled)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile, canonical) DO UPDATE SET path = excluded.path, seen = excluded.seen,
        sampled = excluded.sampled, checked_at = datetime('now')`);
    const tx = db.transaction(() => {
      for (const c of canonicals) {
        upsert.run(name, c, params[c].path, seen[c], sampled);
      }
    });
    tx();
    const suspects = canonicals.filter((c) => seen[c] === 0);
    console.log(`[consistency] ${name}: ${sampled} muestreados, ${suspects.length} sospechosos (${suspects.join(', ') || 'ninguno'})`);
    summary.push({ profile: name, sampled, suspects });
  }
  try {
    db.prepare(`INSERT INTO consistency_state (id, last_run) VALUES (1, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET last_run = datetime('now')`).run();
  } catch (_) {}
  return summary;
}

function computeFirstDelay(nowMs) {
  const { intervalMs } = getConfig();
  const minDelay = 20 * 60 * 1000;
  try {
    const db = getDb();
    ensureTables(db);
    const row = db.prepare('SELECT last_run FROM consistency_state WHERE id=1').get();
    if (row && row.last_run) {
      const last = new Date(row.last_run).getTime();
      if (Number.isFinite(last)) {
        const next = last + intervalMs - nowMs;
        if (next > 0) return Math.max(next, minDelay);
      }
    }
  } catch (e) {
    console.error('[consistency] No se pudo leer last_run:', e.message);
  }
  return minDelay;
}

let timer = null;
let firstTimeout = null;
let isRunning = false;

async function tick() {
  if (isRunning) return;
  isRunning = true;
  try {
    await runConsistency();
  } catch (err) {
    console.error('[consistency] Error ciclo:', err.message);
  } finally {
    isRunning = false;
  }
}

function startConsistency() {
  const { intervalMs } = getConfig();
  const firstDelayMs = computeFirstDelay(Date.now());
  console.log(`[consistency] Check semanal (cada ${Math.round(intervalMs / DAY_MS)}d, primer pase en ${Math.round(firstDelayMs / 60000)}min)`);
  firstTimeout = setTimeout(() => { tick(); }, firstDelayMs);
  timer = setInterval(tick, intervalMs);
  console.log('[consistency] ✓ check activo');
}

function stopConsistency() {
  if (firstTimeout) clearTimeout(firstTimeout);
  if (timer) clearInterval(timer);
  firstTimeout = null;
  timer = null;
}

module.exports = { startConsistency, stopConsistency, runConsistency, pathSeen, getConfig, computeFirstDelay };
