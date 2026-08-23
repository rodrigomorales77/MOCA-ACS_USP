'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED_TYPES = new Set(['string', 'bool', 'boolean', 'int', 'float', 'enum', 'datetime']);
const ALLOWED_MODES = new Set(['ro', 'rw', 'wo']);

let cached = null;

function getCatalogPath() {
  // mapping/catalog.json lives at repo root mapping/, gateway is at ont-gateway/
  // Resolve relative to this file: ../../.. -> repo root, then mapping/catalog.json
  // Also allow override via env for tests.
  if (process.env.GATEWAY_CATALOG_PATH) return process.env.GATEWAY_CATALOG_PATH;
  return path.resolve(__dirname, '../../../mapping/catalog.json');
}

function loadCatalog() {
  if (cached) return cached;

  const catalogPath = getCatalogPath();
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`catalog.json no encontrado: ${catalogPath}`);
  }

  const raw = fs.readFileSync(catalogPath, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`catalog.json JSON inválido: ${e.message}`);
  }

  if (!json.sections || typeof json.sections !== 'object') {
    throw new Error('catalog.json: falta sections');
  }

  const names = new Set();
  let paramCount = 0;

  for (const [sectionKey, section] of Object.entries(json.sections)) {
    const params = section.params;
    const actions = section.actions;
    // sections may be param groups or the actions group
    const entries = params || actions;
    if (!entries) continue;

    for (const [name, def] of Object.entries(entries)) {
      if (names.has(name)) {
        throw new Error(`catalog.json: nombre duplicado ${name}`);
      }
      names.add(name);

      // Actions have { task } instead of type/mode
      if (actions) {
        if (!def.task || typeof def.task !== 'string') {
          throw new Error(`catalog.json: action ${name} sin task`);
        }
        continue;
      }

      if (!def.type || !ALLOWED_TYPES.has(def.type)) {
        throw new Error(`catalog.json: param ${name} type inválido: ${def.type}`);
      }
      if (!def.mode || !ALLOWED_MODES.has(def.mode)) {
        throw new Error(`catalog.json: param ${name} mode inválido: ${def.mode}`);
      }
      if (def.enum && !Array.isArray(def.enum)) {
        throw new Error(`catalog.json: param ${name} enum debe ser array`);
      }
      paramCount++;
    }
  }

  // Basic sanity: ensure we loaded something meaningful
  if (paramCount === 0) {
    throw new Error('catalog.json: no se encontraron params');
  }

  cached = json;
  return json;
}

function getCatalog() {
  return loadCatalog();
}

function clearCache() {
  cached = null;
}

module.exports = { loadCatalog, getCatalog, clearCache, getCatalogPath };
