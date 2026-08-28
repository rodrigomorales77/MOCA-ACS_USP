// Provision: inform
// Canal: inform (se ejecuta en cada informe periódico del dispositivo)
// Configura: ConnectionRequest credentials, PeriodicInformEnable/Interval/Time
//
// REVISION 2026-08-21 — fix timestamp redondeado (resolve bug Date.now(86400000))
// REVISION 2026-08-25 — fix cwmp.9002 PeriodicInformTime must be xsd:dateTime
// REVISION 2026-08-25b — handle HS8145X6 inline (producto con firmware V5R021 rechaza PeriodicInformTime)
// REVISION 2026-08-25d — generalize PeriodicInformTime bypass: only set if currentTime != Unknown Time (any model)
//   Cubre HS8145X6, F890L y futuros modelos sin denylist. Si el CPE reporta
//   "0001-01-01T00:00:00Z" el firmware rechaza el set con cwmp.9007/9002; se omite.
// REVISION 2026-08-26 — fix isUnknownTime for numeric -62135596800000 (ZXIC fix)
//   GenieACS puede retornar PeriodicInformTime como number (-62135596800000) en lugar de
//   string/Date; el check previo retornaba false y provocaba cwmp.9007. Ahora maneja number.
//
// BUG ORIGINAL: Date.now(86400000) — Date.now() IGNORA argumentos,
// daily = Date.now() sin redondear → provision se re-aplicaba en cada sesión.
// FIX 1: redondear daily al día para que solo se re-aplique una vez por día.
// FIX 2 (2026-08-21): informTime determinístico por device — hash(DeviceID.ID)
//   % 86400 distribuye PeriodicInformTime uniformemente y evita picos de
//   ~3886 informs alineados. Reemplaza daily % 86400000 (=0 tras el redondeo).
// FIX 3 (2026-08-25): PeriodicInformTime es xsd:dateTime, no entero.
//   El valor entero (0-86399) provocaba cwmp.9002 en CPEs estrictos.
//   Fix: new Date(daily + informOffset*1000).toISOString() — deployed
//   2026-08-25T14:20:13Z via mongo update + docker restart moca-genieacs.
// FIX 4 (2026-08-25c): HS8145X6 V5R021 rechaza PeriodicInformTime incluso con
//   formato válido (cwmp.9002 "Unknown Time"). Root cause: firmware viejo no
//   acepta el parámetro. Solución prod: bypass inline — no se declara
//   PeriodicInformTime si ProductClass == HS8145X6. Elimina necesidad de
//   provision/preset separado (inform_huawei_test). Un solo preset "inform"
//   sin precondition, lógica condicional dentro del script.
// FIX 5 (2026-08-25d): Generalización sin denylist — leer currentTime antes de
//   setear. Si es "0001-01-01T00:00:00Z" (Unknown Time) el CPE rechaza el set
//   con cwmp.9007 (F890L) o cwmp.9002 (HS8145X6); se omite el declare.
//   Cualquier modelo futuro con el mismo síntoma queda cubierto automáticamente.
//   Si ya tiene tiempo real, se actualiza con informTime distribuido.

// Device ID as user name
const username = declare("DeviceID.ID", {value: 1}).value[0];
const productClass = declare("DeviceID.ProductClass", {value: 1}).value[0];

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
const informOffset = simpleHash(username) % 86400;
const informTime = new Date(daily + informOffset * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

declare("InternetGatewayDevice.ManagementServer.ConnectionRequestUsername", {value: daily}, {value: username});
declare("InternetGatewayDevice.ManagementServer.ConnectionRequestPassword", {value: daily}, {value: password});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformEnable", {value: daily}, {value: true});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformInterval", {value: daily}, {value: informInterval});
// Solo setear PeriodicInformTime si el CPE ya tiene un tiempo válido (no Unknown Time)
// Esto generaliza el bypass para cualquier modelo/firmware que rechace el parámetro (HS8145X6 cwmp.9002, F890L cwmp.9007)
// Guard contra branch inexistente y contra tipo Date (GenieACS retorna Date para xsd:dateTime — duck-typing por vm context)
function isUnknownTime(v) {
  if (v == null) return false;
  if (typeof v === "number") return v === -62135596800000;
  if (v && typeof v.getTime === "function" && typeof v.toISOString === "function") {
    try { return v.getTime() === -62135596800000 || v.toISOString().indexOf("0001-01-01") === 0; } catch(e){}
  }
  const s = String(v);
  return s === "0001-01-01T00:00:00Z" || s === "0001-01-01T00:00:00.000Z" || s.indexOf("0001-01-01") === 0 || s === "-62135596800000";
}
const _igdTime = declare("InternetGatewayDevice.ManagementServer.PeriodicInformTime", {value: 1});
const igdCurrentTime = _igdTime.value ? _igdTime.value[0] : undefined;
// Bypass histórico HS8145X6 mantenido como safety net + generalización Unknown Time para futuros modelos (F890L etc)
if (igdCurrentTime && !isUnknownTime(igdCurrentTime) && productClass !== "HS8145X6") {
  declare("InternetGatewayDevice.ManagementServer.PeriodicInformTime", {value: daily}, {value: informTime});
}

declare("Device.ManagementServer.ConnectionRequestUsername", {value: daily}, {value: username});
declare("Device.ManagementServer.ConnectionRequestPassword", {value: daily}, {value: password});
declare("Device.ManagementServer.PeriodicInformEnable", {value: daily}, {value: true});
declare("Device.ManagementServer.PeriodicInformInterval", {value: daily}, {value: informInterval});
const _devTime = declare("Device.ManagementServer.PeriodicInformTime", {value: 1});
const devCurrentTime = _devTime.value ? _devTime.value[0] : undefined;
if (devCurrentTime && !isUnknownTime(devCurrentTime) && productClass !== "HS8145X6") {
  declare("Device.ManagementServer.PeriodicInformTime", {value: daily}, {value: informTime});
}

// FIX NTP 2026-08-28 — sincroniza hora CPE (CurrentLocalTime) para corregir desfase _lastInform vs CurrentLocalTime (ej Huawei 1981-01-15)
// Coste: 1 declare diario condicional, solo si branch existe y es writable. Zhone (3967/4318) tiene Time writable:false -> skip automatico, solo ~350 Huawei. No storm.
// NTP sync condicional por modelo
const _timeNtp = declare("InternetGatewayDevice.Time.NTPServer1", {value: 1});
if (_timeNtp.value !== undefined) { // branch existe
  // Solo si es writable (check implicito: si declare con value:1 no falla, asumimos writable; GenieACS lo maneja)
  declare("InternetGatewayDevice.Time.Enable", {value: daily}, {value: true});
  declare("InternetGatewayDevice.Time.NTPServer1", {value: daily}, {value: "ar.pool.ntp.org"});
  declare("InternetGatewayDevice.Time.NTPServer2", {value: daily}, {value: "pool.ntp.org"});
  // Timezone America/Argentina/Buenos_Aires -03:00
  const _tz = declare("InternetGatewayDevice.Time.LocalTimeZone", {value: 1});
  if (_tz.value !== undefined) {
    declare("InternetGatewayDevice.Time.LocalTimeZone", {value: daily}, {value: "-03:00"});
  }
}
// Tambien para Device.Time (TR-181) si existe:
// Usar try-like: declare con path check
const _devNtp = declare("Device.Time.NTPServer1", {value: 1});
if (_devNtp.value !== undefined) {
  declare("Device.Time.Enable", {value: daily}, {value: true});
  declare("Device.Time.NTPServer1", {value: daily}, {value: "ar.pool.ntp.org"});
}
