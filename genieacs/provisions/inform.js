// Provision: inform
// Canal: inform (se ejecuta en cada informe periódico del dispositivo)
// Configura: ConnectionRequest credentials, PeriodicInformEnable/Interval/Time
//
// REVISION 2026-08-21 — fix timestamp redondeado (resolve bug Date.now(86400000))
//
// BUG ORIGINAL: Date.now(86400000) — Date.now() IGNORA argumentos,
// daily = Date.now() sin redondear → provision se re-aplicaba en cada sesión.
// FIX 1: redondear daily al día para que solo se re-aplique una vez por día.
// FIX 2 (2026-08-21): informTime determinístico por device — hash(DeviceID.ID)
//   % 86400 distribuye PeriodicInformTime uniformemente y evita picos de
//   ~3886 informs alineados. Reemplaza daily % 86400000 (=0 tras el redondeo).

// Device ID as user name
const username = declare("DeviceID.ID", {value: 1}).value[0]

// Password will be fixed for a given device because Math.random() is seeded with device ID by default.
const password = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

const informInterval = 300;

// Refresh values daily (rounded to start of day)
const daily = Date.now() - (Date.now() % 86400000);

// Deterministic per-device inform offset for load distribution
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
  return Math.abs(h);
}
const informTime = simpleHash(username) % 86400;

declare("InternetGatewayDevice.ManagementServer.ConnectionRequestUsername", {value: daily}, {value: username});
declare("InternetGatewayDevice.ManagementServer.ConnectionRequestPassword", {value: daily}, {value: password});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformEnable", {value: daily}, {value: true});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformInterval", {value: daily}, {value: informInterval});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformTime", {value: daily}, {value: informTime});

declare("Device.ManagementServer.ConnectionRequestUsername", {value: daily}, {value: username});
declare("Device.ManagementServer.ConnectionRequestPassword", {value: daily}, {value: password});
declare("Device.ManagementServer.PeriodicInformEnable", {value: daily}, {value: true});
declare("Device.ManagementServer.PeriodicInformInterval", {value: daily}, {value: informInterval});
declare("Device.ManagementServer.PeriodicInformTime", {value: daily}, {value: informTime});
