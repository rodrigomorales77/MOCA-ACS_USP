'use strict';

/**
 * Presentation-only normalization for manufacturer and model strings.
 * Raw values come from GenieACS (TR-069 DeviceInfo + _deviceId fallback).
 * All lookups are case-insensitive and trim-aware. Unknown -> "Otro".
 */

// Lower-cased trimmed -> canonical
const MANUFACTURER_MAP = new Map([
  ['zhone', 'Zhone'],
  ['huawei technologies co., ltd', 'Huawei'],
  ['huawei', 'Huawei'],
  ['hwtc', 'Huawei'],
  ['zxic', 'ZTE'],
  ['zte', 'ZTE'],
  ['desconocido', 'Otro'],
  ['', 'Otro'],
]);

function normalizeManufacturer(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  if (MANUFACTURER_MAP.has(key)) return MANUFACTURER_MAP.get(key);
  if (!key) return 'Otro';
  // Unknown manufacturer -> Otro (visible bucket, not dropped)
  return 'Otro';
}

// Zhone model rules — ordered specific -> generic. First match wins.
const ZHONE_RULES = [
  { re: /^ZNID-GPON-2424A1(-.*)?$/i, to: '2424A1' },
  { re: /^ZNID-GPON-2424A$/i, to: '2424A' },
  { re: /^ZNID-GPON-2424$/i, to: '2424' },
  { re: /^ZNID-GPON-2426A1(-00|-NA|-00-NA)?$/i, to: '2426A1' },
  { re: /^ZNID-GPON-2426A(-00|-NA)?$/i, to: '2426A' },
  // Fallback catch for any other ZNID-GPON-242x string with unknown suffix
  { re: /^ZNID-GPON-2426A1.*$/i, to: '2426A1' },
  { re: /^ZNID-GPON-2426A.*$/i, to: '2426A' },
  { re: /^ZNID-GPON-2424A1.*$/i, to: '2424A1' },
];

// Legacy ProductClass-only exact map (no ModelName)
const LEGACY_MODEL_MAP = new Map([
  ['znid24xxa1', '2424A1'],
  ['znid24xxa_gr', '2426A'],
  ['znid24xx', '2424'],
  // Also handle case where legacy string already looks like ZNID-GPON-... but came via ProductClass
]);

function normalizeModel(raw, normalizedManufacturer) {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'desconocido') return 'Otro';

  const lower = s.toLowerCase();

  // Legacy exact check first (cheapest, covers the 2494 fallback devices)
  if (LEGACY_MODEL_MAP.has(lower)) return LEGACY_MODEL_MAP.get(lower);

  // Zhone bucket rules
  if (normalizedManufacturer === 'Zhone' || lower.startsWith('znid')) {
    for (const { re, to } of ZHONE_RULES) {
      if (re.test(s)) return to;
    }
    // If it's clearly a Zhone ZNID string that didn't match specific rules, fallback to raw-ish?
    // Better to map unknown Zhone ZNID* to Otro to stay deterministic — but keep generic ZNID check:
    if (lower.startsWith('znid')) return 'Otro';
  }

  // Huawei / ZTE passthrough — keep commercial model as-is
  if (normalizedManufacturer === 'Huawei' || normalizedManufacturer === 'ZTE') {
    // Known models pass through; unknown still returns raw (not Otro) to preserve new hardware visibility,
    // unless it's empty. But spec says unknown -> Otro. For Huawei/ZTE we preserve raw if looks like a model code.
    // Decide: if it matches known Huawei/ZTE patterns keep, else if unknown like "UNKNOWN-9000" -> Otro.
    // Keep simple: known passthrough set, everything else -> Otro.
    const knownHuaweiZTE = new Set(['hs8145x6', 'eg8041x6-10', 'bm443gax4', 'f890l']);
    if (knownHuaweiZTE.has(lower)) {
      // Return canonical casing from a map
      const casing = { hs8145x6: 'HS8145X6', 'eg8041x6-10': 'EG8041X6-10', bm443gax4: 'BM443GAX4', f890l: 'F890L' };
      return casing[lower];
    }
    // Unknown model for Huawei/ZTE — preserve raw? Spec says -> Otro. Follow spec:
    // If it looks like a model (alphanumeric + dash), preserve raw to avoid hiding new hardware?
    // Spec says fallback Otro, so obey. Tests for unknown must get Otro.
    // We add a small exception: if manufacturer is already Otro, model will be Otro anyway.
    return 'Otro';
  }

  // Non-Zhone, non-Huawei/ZTE unknown -> Otro
  // But if raw looks like a generic model code and manufacturer is Otro, keep raw? No, spec says Otro.
  // To avoid hiding truly new vendors, we could return raw. However spec + proposal say unknown -> Otro.
  // Enforce Otro for unknowns to keep modelCount bounded.
  // Exception: if normalizedManufacturer is Otro and raw is meaningful, return raw? No — keep determinism.
  // Check if raw is one of the known non-Zhone models that slipped through vendor mismatch:
  const lowerKnown = lower;
  if (['hs8145x6', 'eg8041x6-10', 'bm443gax4', 'f890l'].includes(lowerKnown)) {
    const casing = { hs8145x6: 'HS8145X6', 'eg8041x6-10': 'EG8041X6-10', bm443gax4: 'BM443GAX4', f890l: 'F890L' };
    return casing[lowerKnown];
  }

  return 'Otro';
}

/**
 * Convenience: extracts raw manufacturer/model from a GenieACS device doc
 * using the same fallback logic as devices.js, then normalizes.
 * Keeps raw data untouched — returns normalized pair.
 */
function normalizeDevice(device) {
  const deviceInfo = device?.InternetGatewayDevice?.DeviceInfo;
  let rawManufacturer = 'Desconocido';
  let rawModel = 'Desconocido';
  if (deviceInfo) {
    const m = deviceInfo.Manufacturer;
    const mod = deviceInfo.ModelName;
    rawManufacturer = m != null ? (typeof m === 'object' ? String(m._value ?? '') : String(m)) : '';
    rawModel = mod != null ? (typeof mod === 'object' ? String(mod._value ?? '') : String(mod)) : '';
    if (!rawManufacturer) rawManufacturer = 'Desconocido';
    if (!rawModel) rawModel = 'Desconocido';
  }
  const meta = device?._deviceId || {};
  if ((!rawManufacturer || rawManufacturer === 'Desconocido') && meta._Manufacturer) {
    rawManufacturer = meta._Manufacturer;
  }
  if ((!rawModel || rawModel === 'Desconocido') && meta._ProductClass) {
    rawModel = meta._ProductClass;
  }
  const manufacturer = normalizeManufacturer(rawManufacturer);
  const model = normalizeModel(rawModel, manufacturer);
  return { manufacturer, model, rawManufacturer, rawModel };
}

module.exports = { MANUFACTURER_MAP, normalizeManufacturer, normalizeModel, normalizeDevice };
