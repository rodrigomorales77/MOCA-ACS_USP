'use strict';

const { getDb } = require('../config/db');
const { nbi } = require('../config/genieacs');

const CHECK_INTERVAL = 60 * 1000; // 60 segundos
let isRunning = false;

// Comparar versiones: retorna -1 si v1 < v2, 0 si iguales, 1 si v1 > v2
function compareVersions(v1, v2) {
  if (!v1 || !v2) return 0;

  const parts1 = v1.split(/[.-]/).map(p => parseInt(p) || 0);
  const parts2 = v2.split(/[.-]/).map(p => parseInt(p) || 0);

  const maxLength = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

async function processActiveRules() {
  const db = getDb();

  try {
    // Obtener todas las reglas ACTIVAS
    const activeRules = db.prepare(`
      SELECT * FROM firmware_rules WHERE status = 'active'
    `).all();

    if (activeRules.length === 0) {
      console.log('[firmware-monitor] No hay reglas activas');
      return;
    }

    console.log(`[firmware-monitor] Procesando ${activeRules.length} regla(s) activa(s)`);

    // Obtener todos los dispositivos de GenieACS
    let allDevices = [];
    try {
      const projection = JSON.stringify({
        _id: 1,
        'InternetGatewayDevice.DeviceInfo.Manufacturer': 1,
        'InternetGatewayDevice.DeviceInfo.ModelName': 1,
        'InternetGatewayDevice.DeviceInfo.SoftwareVersion': 1
      });
      const response = await nbi.get('/devices/', { params: { limit: 100000, projection } });
      allDevices = response.data || [];
    } catch (err) {
      console.error('[firmware-monitor] Error obteniendo dispositivos de GenieACS:', err.message);
      return;
    }

    for (const rule of activeRules) {
      await processRule(rule, allDevices, db);
    }

  } catch (err) {
    console.error('[firmware-monitor] Error general:', err.message);
  }
}

async function processRule(rule, allDevices, db) {
  try {
    console.log(`[firmware-monitor] Procesando regla ${rule.id}: ${rule.vendor}/${rule.model} -> v${rule.sw_version}`);

    // Filtrar dispositivos que coincidan con vendor/model
    const matchingDevices = allDevices.filter(device => {
      const deviceInfo = device?.InternetGatewayDevice?.DeviceInfo || {};
      const vendor = (deviceInfo.Manufacturer?._value || deviceInfo.Manufacturer || '').toString().trim();
      const model = (deviceInfo.ModelName?._value || deviceInfo.ModelName || '').toString().trim();

      return vendor === rule.vendor && model === rule.model;
    });

    if (matchingDevices.length === 0) {
      console.log(`[firmware-monitor] No hay dispositivos coincidentes para regla ${rule.id}`);
      return;
    }

    console.log(`[firmware-monitor] Encontrados ${matchingDevices.length} dispositivos para regla ${rule.id}`);

    // Procesar cada dispositivo
    for (const device of matchingDevices) {
      const deviceId = device._id;
      const deviceInfo = device?.InternetGatewayDevice?.DeviceInfo || {};
      const currentSwVersion = (deviceInfo.SoftwareVersion?._value || deviceInfo.SoftwareVersion || '').toString();

      console.log(`[firmware-monitor] Dispositivo ${deviceId}: versión actual = ${currentSwVersion}, versión objetivo = ${rule.sw_version}`);

      const versionCompare = compareVersions(currentSwVersion, rule.sw_version);

      if (versionCompare < 0) {
        // Versión actual es menor, necesita actualización
        console.log(`[firmware-monitor] ${deviceId} necesita actualización firmware`);
        await sendFirmwareUpdateCommand(deviceId, rule.firmware_file, rule.id);
      } else if (versionCompare === 0) {
        // Versión coincide, enviar reboot
        console.log(`[firmware-monitor] ${deviceId} versión OK, enviando REBOOT`);
        await sendRebootCommand(deviceId, rule.id);
      } else {
        console.log(`[firmware-monitor] ${deviceId} versión es mayor (sin cambios)`);
      }
    }

  } catch (err) {
    console.error(`[firmware-monitor] Error procesando regla ${rule.id}:`, err.message);
  }
}

async function sendFirmwareUpdateCommand(deviceId, firmwareFile, ruleId) {
  try {
    // Crear tarea para firmware update
    // Esto depende de cómo GenieACS implemente los comandos de firmware
    // Por ahora, creamos un placeholder
    console.log(`[firmware-monitor] Enviando comando de firmware update a ${deviceId} (${firmwareFile})`);

    // Nota: La implementación real dependerá de cómo se comunique con GenieACS
    // para enviar archivos de firmware (puede requerir upload a TFTP, HTTP, etc)

    // Ejemplo (necesitaría ajustarse según la API de GenieACS):
    // const task = {
    //   name: 'downloadAndUpgrade',
    //   commandKey: 'firmware-' + ruleId,
    //   fileType: 'Firmware Upgrade Image',
    //   URL: 'http://...' + firmwareFile
    // };
    // await nbi.post(`/devices/${deviceId}/tasks?connection_request`, task);

  } catch (err) {
    console.error(`[firmware-monitor] Error enviando firmware update a ${deviceId}:`, err.message);
  }
}

async function sendRebootCommand(deviceId, ruleId) {
  try {
    console.log(`[firmware-monitor] Enviando REBOOT a ${deviceId}`);

    const task = {
      name: 'reboot',
      commandKey: 'reboot-' + ruleId
    };

    const response = await nbi.post(`/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, task);
    console.log(`[firmware-monitor] ✓ REBOOT enviado a ${deviceId}:`, response.status);

  } catch (err) {
    console.error(`[firmware-monitor] Error enviando REBOOT a ${deviceId}:`, err.message);
  }
}

async function checkAndProcessRules() {
  if (isRunning) return;
  isRunning = true;

  try {
    await processActiveRules();
  } catch (err) {
    console.error('[firmware-monitor] Error en ciclo de monitoreo:', err.message);
  } finally {
    isRunning = false;
  }
}

function startFirmwareMonitor() {
  console.log('[firmware-monitor] Iniciando monitor de firmware...');

  // Ejecutar inmediatamente
  checkAndProcessRules();

  // Luego ejecutar cada CHECK_INTERVAL
  setInterval(checkAndProcessRules, CHECK_INTERVAL);

  console.log(`[firmware-monitor] ✓ Monitor activo (verificando cada ${CHECK_INTERVAL / 1000}s)`);
}

module.exports = { startFirmwareMonitor };
