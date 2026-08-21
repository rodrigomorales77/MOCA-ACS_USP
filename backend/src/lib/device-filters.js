'use strict';

/**
 * Funciones puras de filtrado de dispositivos para la lista server-side.
 *
 * Se aplican sobre un snapshot ligero de la flota (ver routes/devices.js) en
 * lugar de delegar el filtro al NBI: el estado online/offline y la búsqueda
 * por substring no se pueden expresar de forma eficiente contra Mongo sin
 * acoplarse a su sintaxis ($regex), y filtrar en el navegador rompía la
 * paginación (páginas ya recortadas antes de filtrar).
 */

// Ventana de gracia para considerar un dispositivo online. La flota usa
// PeriodicInformInterval=300 (5 min), así que un último inform más viejo que
// esa ventana implica CPE apagado o desconectado.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Normaliza _lastInform a epoch ms. GenieACS lo persiste como {$date: <ms>},
 * pero aceptamos también ISO string y número crudo por robustez frente a
 * distintas versiones del NBI. Devuelve 0 si falta o no se puede parsear:
 * un dispositivo sin _lastInform nunca estuvo online.
 *
 * @param {object} device Documento GenieACS proyectado.
 * @returns {number} Epoch ms o 0.
 */
function lastInformMs(device) {
  const raw = device?._lastInform;
  if (raw == null) return 0;

  let t;
  if (typeof raw === 'object') {
    if (typeof raw.$date === 'number') t = raw.$date;
    else if (raw.$date != null) t = Date.parse(raw.$date);
    else return 0;
  } else if (typeof raw === 'number') {
    t = raw;
  } else if (typeof raw === 'string') {
    t = Date.parse(raw);
  } else {
    return 0;
  }

  // Date.parse devuelve NaN ante formatos inválidos; NaN > x es siempre false,
  // pero normalizamos a 0 para que el valor sea predecible.
  return Number.isFinite(t) ? t : 0;
}

/**
 * Un dispositivo está online si informó dentro de la ventana de gracia.
 *
 * @param {object} device Documento GenieACS proyectado.
 * @param {number} now Epoch ms actual (inyectable para testear).
 * @returns {boolean}
 */
function isOnline(device, now) {
  return lastInformMs(device) > now - ONLINE_WINDOW_MS;
}

/**
 * Búsqueda por substring insensible a mayúsculas sobre ID, modelo e IP MGMT.
 * Se usa includes() en vez de regex a propósito: el término viene del usuario
 * y con $regex/RegExp un metacaracter podía inyectar patrones (o colgar el
 * evento por ReDoS). Término vacío o solo espacios coincide con todo.
 *
 * @param {object} device Documento enriquecido (_id, _model, _mgmtIp).
 * @param {string} term Término de búsqueda crudo.
 * @returns {boolean}
 */
function matchesSearch(device, term) {
  const needle = String(term ?? '').trim().toLowerCase();
  if (!needle) return true;

  return (
    String(device._id || '').toLowerCase().includes(needle) ||
    String(device._model || '').toLowerCase().includes(needle) ||
    String(device._mgmtIp || '').toLowerCase().includes(needle)
  );
}

/**
 * Filtro por estado de conexión.
 * - 'online': informó dentro de la ventana.
 * - 'offline': NO informó dentro de la ventana (incluye los que nunca informaron).
 * - 'pending': tiene acciones pendientes en SQLite (set de IDs precargado).
 * - cualquier otro valor (incluido ''): pasa todo.
 *
 * @param {object} device Documento enriquecido.
 * @param {string} status Estado solicitado.
 * @param {Set<string>|null} pendingIdSet IDs con acciones pendientes (null salvo status='pending').
 * @param {number} now Epoch ms actual.
 * @returns {boolean}
 */
function matchesStatus(device, status, pendingIdSet, now) {
  switch (status) {
    case 'online':
      return isOnline(device, now);
    case 'offline':
      return !isOnline(device, now);
    case 'pending':
      return Boolean(pendingIdSet && pendingIdSet.has(device._id));
    default:
      return true;
  }
}

/**
 * Compone búsqueda + estado sobre un array de documentos enriquecidos.
 *
 * @param {Array<object>} devices Snapshot enriquecido de la flota.
 * @param {object} opts { search, status, pendingIds, now }.
 * @returns {Array<object>} Dispositivos que cumplen ambos criterios.
 */
function filterDevices(devices, { search = '', status = '', pendingIds = null, now = Date.now() } = {}) {
  return devices.filter(
    device => matchesSearch(device, search) && matchesStatus(device, status, pendingIds, now)
  );
}

module.exports = { ONLINE_WINDOW_MS, lastInformMs, isOnline, matchesSearch, matchesStatus, filterDevices };
