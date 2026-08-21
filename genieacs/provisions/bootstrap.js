// Provision: bootstrap
// Canal: bootstrap (se ejecuta al primer informe de cada dispositivo, evento "0 BOOTSTRAP")
// Limpia la caché del data model para forzar re-lectura completa del árbol TR-069.
//
// NOTA: Este provision usa clear() que NO provoca el storm de GetParameterNames.
// El problema original era declare() con pathTimestamp sin redondear (ver default.js).

const now = Date.now();

// Clear cached data model to force a refresh
clear("Device", now);
clear("InternetGatewayDevice", now);
