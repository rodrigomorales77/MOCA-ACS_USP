'use strict';

/**
 * Transformers puros para ont-gateway.
 * Firma: transform(value, direction) => value
 *   direction: 'to_canonical' (TR-069 → catálogo) | 'to_device' (catálogo → TR-069)
 * Todos deben ser idempotentes y no lanzar salvo validación de write-only.
 */

// ---------------------------------------------------------------------------
// Booleanos
// ---------------------------------------------------------------------------

function bool_true_false_string(value, direction) {
  if (direction === 'to_canonical') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === true || value === false) return value;
    return Boolean(value);
  }
  // to_device: canónico → "true"/"false"
  return value ? 'true' : 'false';
}

function bool_1_0_string(value, direction) {
  if (direction === 'to_canonical') {
    if (value === '1' || value === 1 || value === true) return true;
    if (value === '0' || value === 0 || value === false) return false;
    return Boolean(value);
  }
  return value ? '1' : '0';
}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------

function wifi_passphrase(value, direction) {
  // write-only: solo valida en escritura, lectura nunca llega acá (WO omitido)
  if (direction === 'to_device') {
    if (typeof value !== 'string' || value.length < 8 || value.length > 63) {
      throw new Error('wifi_passphrase: debe tener 8-63 caracteres');
    }
  }
  return value;
}

function wifi_security_zhone(value, direction) {
  // Zhone Standard: "WPA2", "WPA", "WEP", "" (open) ↔ catálogo none/wpa2-psk/wpa-psk/wep
  const toCanon = { WPA2: 'wpa2-psk', WPA: 'wpa-psk', WEP: 'wep', '': 'none' };
  const toDevice = { 'wpa2-psk': 'WPA2', 'wpa-psk': 'WPA', wep: 'WEP', none: '' };
  if (direction === 'to_canonical') return toCanon[value] ?? value;
  return toDevice[value] ?? value;
}

// ---------------------------------------------------------------------------
// WAN — Zhone
// ---------------------------------------------------------------------------

function wan_mode_zhone(value, direction) {
  // Zhone X_ZHONE_COM_ConnectionType puede venir como "PPPoE_Bridged", "IP_Bridged",
  // "PPPoE_IP_Bridged" o ya canónico si el perfil lo normaliza.
  const toCanon = {
    PPPoE: 'pppoe',
    PPPoE_Bridged: 'pppoe',
    PPPoE_IP_Bridged: 'pppoe',
    IPoE: 'ipoe',
    IP_Bridged: 'bridge',
    Bridge: 'bridge',
  };
  const toDevice = { pppoe: 'PPPoE_Bridged', ipoe: 'IP_Bridged', bridge: 'IP_Bridged' };
  if (direction === 'to_canonical') return toCanon[value] ?? value;
  return toDevice[value] ?? value;
}

function wan_status_zhone(value, direction) {
  const toCanon = { Connected: 'connected', Disconnected: 'disconnected', Connecting: 'unknown' };
  if (direction === 'to_canonical') return toCanon[value] ?? 'unknown';
  return value;
}

// ---------------------------------------------------------------------------
// WAN — Huawei
// ---------------------------------------------------------------------------

function wan_mode_huawei(value, direction) {
  // Huawei ConnectionType: "IP_Routed" (pppoe/ipoe según servicio) vs "IP_Bridged"
  // Para PPPoE siempre es IP_Routed; el modo canónico lo decide el servicio activo.
  const toCanon = { IP_Routed: 'pppoe', IP_Bridged: 'bridge' };
  const toDevice = { pppoe: 'IP_Routed', ipoe: 'IP_Routed', bridge: 'IP_Bridged' };
  if (direction === 'to_canonical') return toCanon[value] ?? value;
  return toDevice[value] ?? value;
}

function wan_status_huawei(value, direction) {
  const toCanon = { Connected: 'connected', Disconnected: 'disconnected', Unconfigured: 'unknown' };
  if (direction === 'to_canonical') return toCanon[value] ?? 'unknown';
  return value;
}

// ---------------------------------------------------------------------------
// Óptico / diagnóstico — parsing de strings con unidad
// ---------------------------------------------------------------------------

function parse_dbm_string(value, direction) {
  if (direction === 'to_canonical') {
    if (value == null || value === '') return null;
    // Zhone: "-21.5 dBm", "-17 dBm", o ya numérico
    const m = String(value).match(/(-?\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }
  return value;
}

function parse_temp_string(value, direction) {
  if (direction === 'to_canonical') {
    if (value == null || value === '') return null;
    const m = String(value).match(/(-?\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }
  return value;
}

function dbm_milli_to_dbm(value, direction) {
  // Por si algún firmware reporta dBm ×10 o ×1000; Huawei actual reporta entero
  // y Zhone ya pasa por parse_dbm_string, pero se deja para compatibilidad.
  if (direction === 'to_canonical') {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (Number.isNaN(n)) return null;
    // Heurística: si viene > 100 o < -100 probablemente es milli
    if (Math.abs(n) > 100) return n / 10;
    if (Math.abs(n) > 1000) return n / 1000;
    return n;
  }
  return value;
}

module.exports = {
  bool_true_false_string,
  bool_1_0_string,
  wifi_passphrase,
  wifi_security_zhone,
  wan_mode_zhone,
  wan_status_zhone,
  wan_mode_huawei,
  wan_status_huawei,
  parse_dbm_string,
  parse_temp_string,
  dbm_milli_to_dbm,
};
