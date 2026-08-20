'use strict';

/**
 * Extrae la IP de gestión (MGMT) de un dispositivo TR-069 a partir de
 * InternetGatewayDevice.ManagementServer.ConnectionRequestURL: es la dirección
 * por la que el ACS alcanza al CPE y la misma que muestra la página de detalle.
 *
 * ConnectionRequestURL es un parámetro obligatorio del Inform TR-069, por lo que
 * está presente en prácticamente todos los dispositivos. Path fijo, sin
 * instancias variables.
 *
 * @param {object} device Documento GenieACS proyectado (incluye ManagementServer.ConnectionRequestURL).
 * @returns {string} IP de gestión o '' si no puede extraerse.
 */
function extractMgmtIp(device) {
  const url = device?.InternetGatewayDevice?.ManagementServer?.ConnectionRequestURL?._value || '';
  const match = url.match(/https?:\/\/([0-9.]+)/);
  return match ? match[1] : '';
}

module.exports = { extractMgmtIp };
