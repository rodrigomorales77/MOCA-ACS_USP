'use strict';

const { resolveDevice } = require('../resolver/device');
const { getProfile } = require('../catalog/profiles');
const { getDevice } = require('../services/genieacs');
const transformers = require('../../../mapping/transformers');

// Map catalog section keys to capabilities keys
// capabilities declaradas en perfil: device, wifi.radio.2g, wifi.radio.5g, wan, lan, gpon, diagnostics

function sectionFromCanonical(canonical) {
  // canonical e.g. "device.serial" -> "device", "wifi.radio.2g.ssid" -> "wifi.radio.2g"
  if (canonical.startsWith('wifi.radio.2g')) return 'wifi.radio.2g';
  if (canonical.startsWith('wifi.radio.5g')) return 'wifi.radio.5g';
  if (canonical.startsWith('wan.')) return 'wan';
  if (canonical.startsWith('lan.')) return 'lan';
  if (canonical.startsWith('gpon.')) return 'gpon';
  if (canonical.startsWith('diagnostics.')) return 'diagnostics';
  if (canonical.startsWith('device.')) return 'device';
  if (canonical.startsWith('actions.')) return 'actions';
  return canonical.split('.')[0];
}

function leafName(canonical) {
  // For nested canons like wan.nat.enabled -> "nat.enabled", wan.pppoe.username -> "pppoe.username"
  // Keep suffix after first section dot
  const section = sectionFromCanonical(canonical);
  if (canonical.startsWith(section + '.')) {
    return canonical.slice(section.length + 1);
  }
  const idx = canonical.lastIndexOf('.');
  return idx >= 0 ? canonical.slice(idx + 1) : canonical;
}

// Navigate nested snapshot: "InternetGatewayDevice.DeviceInfo.SerialNumber" -> value or { _value }
function getByPath(obj, tr069Path) {
  if (!obj || !tr069Path) return undefined;
  const parts = tr069Path.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function extractRaw(snapshot, tr069Path) {
  const node = getByPath(snapshot, tr069Path);
  if (node === undefined) return undefined;
  if (node !== null && typeof node === 'object' && '_value' in node) {
    return node._value;
  }
  // Intermediate object (e.g. wildcard expansion parent) or primitive
  return node;
}

// Scan snapshot for wildcard pattern: by_status like "InternetGatewayDevice.LANDevice.*.LANHostConfigManagement.IPInterface.1.X_ZHONE_COM_PPPoEStatus.ConnectionStatus"
// Returns replacement string for {i} or null if not found
function detectInstance(snapshot, byStatusPattern, equals) {
  // byStatusPattern contains '*' placeholder for instance index
  // We need to find numeric child keys under the parent.
  // Approach: split pattern at '*', traverse to parent, enumerate keys.
  const starIdx = byStatusPattern.indexOf('*');
  if (starIdx === -1) {
    // No wildcard: direct check
    const raw = extractRaw(snapshot, byStatusPattern);
    if (String(raw) === String(equals)) return null; // no substitution needed
    return null;
  }

  const prefix = byStatusPattern.slice(0, starIdx); // e.g. "InternetGatewayDevice.LANDevice."
  const suffix = byStatusPattern.slice(starIdx + 1); // e.g. ".LANHostConfigManagement.IPInterface.1.X_ZHONE_COM_PPPoEStatus.ConnectionStatus"
  // prefix ends with '.' ; suffix starts with '.' (or '')

  const cleanPrefix = prefix.replace(/\.$/, ''); // remove trailing dot
  const parentNode = getByPath(snapshot, cleanPrefix);
  if (!parentNode || typeof parentNode !== 'object') return null;

  // Enumerate numeric keys under LANDevice
  for (const key of Object.keys(parentNode)) {
    // skip GenieACS metadata keys starting with _
    if (key.startsWith('_')) continue;
    const candidatePath = cleanPrefix + '.' + key + suffix;
    const raw = extractRaw(snapshot, candidatePath);
    if (raw !== undefined && String(raw) === String(equals)) {
      return key;
    }
  }
  return null;
}

function isEmptyValue(v) {
  return v === undefined || v === null || v === '';
}

async function read(group, deviceRow, nbiSnapshotOverride) {
  const profile = getProfile(deviceRow.profile);

  // Determine canonical list
  let canonicals;
  if (group) {
    // group is section key like "device", "wifi", "wifi.radio.2g", "wan", etc.
    // Normalize: allow "wifi" -> expand both radios? but spec has separate subroutes.
    // Supported groups: device, wifi, wifi.radio.2g, wifi.radio.5g, wan, lan, gpon, diagnostics
    const g = group;
    if (profile.groups && profile.groups[g]) {
      canonicals = profile.groups[g];
    } else if (g === 'wifi' && profile.groups) {
      // aggregate both radios
      const a = profile.groups['wifi.radio.2g'] || [];
      const b = profile.groups['wifi.radio.5g'] || [];
      canonicals = [...a, ...b];
    } else {
      // fallback: use params keys that belong to section
      canonicals = Object.keys(profile.params).filter((k) => sectionFromCanonical(k) === g || k.startsWith(g + '.'));
      if (canonicals.length === 0) {
        // If no params but capability says not supported, return catalog section as not_supported
        const cap = profile.capabilities && profile.capabilities[g];
        if (cap && cap.supported === false) {
          // Load catalog section to enumerate expected fields
          try {
            const { getCatalog } = require('../catalog');
            const catalog = getCatalog();
            const catSection = catalog.sections[g];
            if (catSection && catSection.params) {
              canonicals = Object.keys(catSection.params);
            } else {
              canonicals = [];
            }
          } catch (_) {
            canonicals = [];
          }
          if (canonicals.length === 0) {
            const err = new Error(`Grupo no soportado: ${g}`);
            err.status = 422;
            throw err;
          }
        } else {
          const err = new Error(`Grupo no soportado: ${g}`);
          err.status = 422;
          throw err;
        }
      }
    }
  } else {
    // all groups
    if (profile.groups) {
      const all = [];
      for (const arr of Object.values(profile.groups)) {
        for (const c of arr) if (!all.includes(c)) all.push(c);
      }
      canonicals = all;
    } else {
      canonicals = Object.keys(profile.params);
    }
  }

  // Build projection set (exclude WO)
  const projectionSet = new Set();
  const mappings = {}; // canonical -> def

  for (const canon of canonicals) {
    const def = profile.params[canon];
    mappings[canon] = def || null;
    if (!def) continue; // will be marked not_supported
    if (def.mode === 'wo') continue; // WO omitted from reads entirely
    if (def.select && def.select.by_status) {
      projectionSet.add(def.select.by_status);
    }
    // For select params, we don't add the template path directly; the actual instance path
    // will be resolved from snapshot. But to ensure snapshot contains that instance data,
    // we also need to ensure the parent wildcard is covered — by_status already covers it.
    // Additionally, include a wildcard variant for the param itself so snapshot brings all instances
    // if available. Simpler: add a wildcard projection for the path's parent.
    // We add the concrete template replaced with '*' to fetch all instances.
    if (def.select) {
      const wildcardPath = def.path.replace('{i}', '*');
      projectionSet.add(wildcardPath);
    } else {
      projectionSet.add(def.path);
    }
    if (def.read_paths) {
      for (const rp of def.read_paths) projectionSet.add(rp);
    }
  }

  // Also always include _id and _deviceId for debug
  // Not needed in projection but harmless

  const projection = Array.from(projectionSet).join(',');

  let snapshot;
  if (nbiSnapshotOverride !== undefined) {
    snapshot = nbiSnapshotOverride;
  } else if (projection) {
    snapshot = await getDevice(deviceRow.device_id, projection);
  } else {
    snapshot = {};
  }

  // Detect instances per unique select rule
  const selectCache = new Map(); // by_status+equals -> instance string or null
  function getInstanceFor(def) {
    if (!def || !def.select) return null;
    const key = def.select.by_status + '|' + def.select.equals;
    if (selectCache.has(key)) return selectCache.get(key);
    const inst = detectInstance(snapshot, def.select.by_status, def.select.equals);
    selectCache.set(key, inst);
    return inst;
  }

  // Build result structured by section
  // For "all" mode, return object with keys per section (device, wifi, etc.)
  // For single group, return object with that group key
  const result = {};
  const capabilities = profile.capabilities || {};

  for (const canon of canonicals) {
    const section = sectionFromCanonical(canon);
    const leaf = leafName(canon);
    // ensure section bucket exists
    if (!result[section]) result[section] = {};

    const def = mappings[canon];
    const cap = capabilities[section];

    // WO already skipped: not added to projection, but ensure not returned
    if (def && def.mode === 'wo') {
      continue;
    }

    // Not supported by profile: no mapping or capability says false
    if (!def || (cap && cap.supported === false)) {
      const reason = (cap && cap.reason) ? cap.reason : 'model_not_capable';
      result[section][leaf] = { supported: false, value: null, reason };
      continue;
    }

    // Supported true but need to read value
    let tr069Path = def.path;
    if (tr069Path.includes('{i}')) {
      let inst = null;
      if (def.select) {
        inst = getInstanceFor(def);
      } else {
        // No select declared but path has {i} (e.g. ZHONE wan.status)
        // Try to reuse any other wan select instance, else scan wildcard for this path
        // Find first select-based instance in same section
        for (const otherCanon of canonicals) {
          const otherDef = mappings[otherCanon];
          if (otherDef && otherDef.select) {
            inst = getInstanceFor(otherDef);
            if (inst) break;
          }
        }
        if (!inst) {
          // Fallback: scan snapshot for this template's wildcard
          const wildcard = tr069Path.replace('{i}', '*');
          // Reuse detect logic: scan parent for any non-empty value
          const starIdx = wildcard.indexOf('*');
          if (starIdx !== -1) {
            const prefix = wildcard.slice(0, starIdx).replace(/\.$/, '');
            const suffix = wildcard.slice(starIdx + 1);
            const parent = getByPath(snapshot, prefix);
            if (parent && typeof parent === 'object') {
              for (const k of Object.keys(parent)) {
                if (k.startsWith('_')) continue;
                const cand = prefix + '.' + k + suffix;
                const v = extractRaw(snapshot, cand);
                if (!isEmptyValue(v) && !(v !== null && typeof v === 'object' && '_value' in v && isEmptyValue(v._value))) {
                  inst = k;
                  break;
                }
              }
            }
          }
        }
      }
      if (inst === null) {
        result[section][leaf] = { supported: true, value: null, reason: 'empty_snapshot' };
        continue;
      }
      tr069Path = tr069Path.replace('{i}', inst);
    }

    let raw = extractRaw(snapshot, tr069Path);
    // try read_paths fallback
    if (isEmptyValue(raw) && def.read_paths) {
      for (const alt of def.read_paths) {
        let ap = alt;
        if (def.select) {
          const inst = getInstanceFor(def);
          if (inst) ap = ap.replace('{i}', inst);
        }
        const altRaw = extractRaw(snapshot, ap);
        if (!isEmptyValue(altRaw) && !(altRaw !== null && typeof altRaw === 'object' && '_value' in altRaw && isEmptyValue(altRaw._value))) {
          raw = altRaw;
          break;
        } else if (altRaw !== undefined) {
          // keep first alt if all empty
          if (raw === undefined) raw = altRaw;
        }
      }
    }

    // Normalize raw that might be {_value: ...}
    let actual = raw;
    if (raw !== null && typeof raw === 'object' && '_value' in raw) actual = raw._value;

    if (isEmptyValue(actual)) {
      result[section][leaf] = { supported: true, value: null, reason: 'empty_snapshot' };
      continue;
    }

    // Transform
    let canonicalVal = actual;
    if (def.transform) {
      const fn = transformers[def.transform];
      if (!fn) {
        const err = new Error(`Transformer no encontrado: ${def.transform}`);
        err.status = 500;
        throw err;
      }
      try {
        canonicalVal = fn(actual, 'to_canonical');
      } catch (e) {
        const err = new Error(`Transform ${def.transform} falló para ${canon}: ${e.message}`);
        err.status = 422;
        throw err;
      }
      // If transformer returns null (e.g. parse_dbm with empty) treat as no_value
      if (canonicalVal === null || canonicalVal === undefined) {
        result[section][leaf] = { supported: true, value: null, reason: 'empty_snapshot' };
        continue;
      }
    }

    result[section][leaf] = { supported: true, value: canonicalVal, reason: null };
  }

  // Clean empty sections (all WO omitted)
  for (const k of Object.keys(result)) {
    if (Object.keys(result[k]).length === 0) delete result[k];
  }

  return { data: result, capabilities };
}

async function readForDevice(serial, group) {
  const deviceRow = resolveDevice(serial);
  return read(group, deviceRow);
}

module.exports = { read, readForDevice, getByPath, extractRaw, detectInstance, sectionFromCanonical };
