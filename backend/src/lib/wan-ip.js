'use strict';

/**
 * Resuelve la IP WAN de un dispositivo TR-069 a partir del subárbol
 * InternetGatewayDevice.WANDevice.
 *
 * La ubicación del parámetro ExternalIPAddress varía según modelo/firmware:
 *  - Conexiones IPoE:  WANDevice.{i}.WANConnectionDevice.{j}.WANIPConnection.{k}.ExternalIPAddress
 *  - Conexiones PPPoE: WANDevice.{i}.WANConnectionDevice.{j}.WANPPPConnection.{k}.ExternalIPAddress
 * El índice de instancia no siempre es 1 (p.ej. Zhone reporta WANIPConnection.2).
 *
 * Estrategia: recorrer las instancias en orden ascendente y devolver el primer
 * ExternalIPAddress no vacío; dentro de cada WANConnectionDevice se prioriza
 * WANIPConnection (IPoE) sobre WANPPPConnection (PPPoE).
 *
 * @param {object} device Documento GenieACS (al menos InternetGatewayDevice.WANDevice).
 * @returns {string} IP WAN o '' si el dispositivo no reporta ninguna.
 */
function extractWanIp(device) {
  const wanDevices = device?.InternetGatewayDevice?.WANDevice || {};
  const instanceKeys = obj =>
    Object.keys(obj || {})
      .filter(key => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));

  for (const wanKey of instanceKeys(wanDevices)) {
    const connDevices = wanDevices[wanKey]?.WANConnectionDevice || {};
    for (const connKey of instanceKeys(connDevices)) {
      const conn = connDevices[connKey] || {};
      for (const type of ['WANIPConnection', 'WANPPPConnection']) {
        for (const instKey of instanceKeys(conn[type])) {
          const value = conn[type][instKey]?.ExternalIPAddress?._value;
          if (typeof value === 'string' && value.trim()) return value.trim();
        }
      }
    }
  }
  return '';
}

module.exports = { extractWanIp };
