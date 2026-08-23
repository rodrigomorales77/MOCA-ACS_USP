'use strict';

const fs = require('fs');
const path = require('path');

const PROFILE_PATTERN = /^[A-Z0-9_]+_TR0(98|181)$/;
const ALLOWED_TREES = new Set(['tr098', 'tr181']);
const ALLOWED_TYPES = new Set(['string', 'boolean', 'int', 'float', 'enum', 'datetime']);
const ALLOWED_MODES = new Set(['ro', 'rw', 'wo']);

let cache = null; // Map<string, object>

function getProfilesDir() {
  if (process.env.GATEWAY_PROFILES_PATH) return process.env.GATEWAY_PROFILES_PATH;
  return path.resolve(__dirname, '../../../mapping/profiles');
}

function getSchemaPath() {
  if (process.env.GATEWAY_PROFILE_SCHEMA_PATH) return process.env.GATEWAY_PROFILE_SCHEMA_PATH;
  return path.resolve(__dirname, '../../../mapping/profile.schema.json');
}

function validateProfile(json, fileName) {
  const errors = [];

  if (!json.profile || typeof json.profile !== 'string' || !PROFILE_PATTERN.test(json.profile)) {
    errors.push(`profile inválido o faltante (${json.profile})`);
  }
  if (!json.manufacturer || typeof json.manufacturer !== 'string') {
    errors.push('manufacturer requerido');
  }
  if (!json.model || typeof json.model !== 'string') {
    errors.push('model requerido');
  }
  if (!json.tree || !ALLOWED_TREES.has(json.tree)) {
    errors.push(`tree debe ser tr098 o tr181 (${json.tree})`);
  }
  if (!json.capabilities || typeof json.capabilities !== 'object') {
    errors.push('capabilities requerido');
  } else {
    for (const [k, v] of Object.entries(json.capabilities)) {
      if (typeof v !== 'object' || typeof v.supported !== 'boolean') {
        errors.push(`capabilities[${k}].supported debe ser boolean`);
      }
    }
  }
  if (!json.params || typeof json.params !== 'object' || Array.isArray(json.params)) {
    errors.push('params requerido (object)');
  } else {
    for (const [name, def] of Object.entries(json.params)) {
      if (!def.path || typeof def.path !== 'string') errors.push(`params[${name}].path requerido`);
      if (!def.type || !ALLOWED_TYPES.has(def.type)) errors.push(`params[${name}].type inválido: ${def.type}`);
      if (!def.mode || !ALLOWED_MODES.has(def.mode)) errors.push(`params[${name}].mode inválido: ${def.mode}`);
      if (def.select !== undefined) {
        if (typeof def.select !== 'object' || !def.select.by_status || !def.select.equals) {
          errors.push(`params[${name}].select debe tener by_status y equals`);
        }
      }
      if (def.read_paths !== undefined && !Array.isArray(def.read_paths)) {
        errors.push(`params[${name}].read_paths debe ser array`);
      }
    }
  }

  if (errors.length) {
    throw new Error(`Perfil ${fileName} inválido: ${errors.join('; ')}`);
  }

  // Optional: try AJV if available for full schema validation (non-mandatory)
  try {
    const Ajv = require('ajv');
    const schemaRaw = fs.readFileSync(getSchemaPath(), 'utf8');
    const schema = JSON.parse(schemaRaw);
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const valid = validate(json);
    if (!valid) {
      const msg = ajv.errorsText(validate.errors);
      throw new Error(`Schema validation failed (${fileName}): ${msg}`);
    }
  } catch (e) {
    // If ajv not installed, ignore; if schema validation failed, re-throw
    if (e.message && e.message.includes('Schema validation failed')) throw e;
    // module not found -> skip
  }
}

function loadProfiles() {
  if (cache) return cache;

  const dir = getProfilesDir();
  if (!fs.existsSync(dir)) {
    throw new Error(`Directorio de perfiles no encontrado: ${dir}`);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const map = new Map();

  for (const file of files) {
    const full = path.join(dir, file);
    const raw = fs.readFileSync(full, 'utf8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Perfil ${file} JSON inválido: ${e.message}`);
    }
    validateProfile(json, file);
    const key = json.profile;
    if (map.has(key)) {
      throw new Error(`Perfil duplicado: ${key}`);
    }
    map.set(key, json);
  }

  if (map.size === 0) {
    throw new Error(`No se encontraron perfiles en ${dir}`);
  }

  cache = map;
  return cache;
}

function getProfile(name) {
  const profiles = loadProfiles();
  const p = profiles.get(name);
  if (!p) {
    const err = new Error(`Perfil no encontrado: ${name}`);
    err.status = 404;
    throw err;
  }
  return p;
}

function listProfiles() {
  const profiles = loadProfiles();
  return Array.from(profiles.keys());
}

function clearCache() {
  cache = null;
}

module.exports = { getProfile, listProfiles, loadProfiles, clearCache, getProfilesDir };
