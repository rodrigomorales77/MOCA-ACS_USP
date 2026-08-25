// Provision: default
// Canal: default (se ejecuta en cada sesión CWMP después del inform)
// Última revisión: 2026-07-24 — fix timestamp redondeado (resolve CPU storm)
// REVISION 2026-08-25 — test Zhone lite (OUI 000271) achicar consulta
// REVISION 2026-08-25 — Zhone lite+ 6h: hourly 5 params + sixHourly 3 params (SSID, RxLevel/TxLevel)
//   Fix session_terminated 173/día por GetParameterNames gigante en default provision.
//   Zhone ZNID24xxA1 expone árbol X_ZHONE enorme; wildcards disparan GPN recursivo que excede timeout.
//
// IMPORTANTE: Date.now() sin redondear provoca que declare() compare
// un pathTimestamp > currentTimestamp → GetParameterNames completo cada sesión.
// Redondear al intervalo evita el re-descubrimiento innecesario.

const hourly = Date.now() - (Date.now() % 3600000);
const sixHourly = Date.now() - (Date.now() % 21600000);
const oui = declare("DeviceID.OUI", {value: 1}).value[0];
if (oui === "000271") {
  declare("InternetGatewayDevice.DeviceInfo.HardwareVersion", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.DeviceInfo.SoftwareVersion", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.DeviceInfo.UpTime", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.ManagementServer.ConnectionRequestURL", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.X_ZHONE_COM_GPON.GponOperStatus", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", {path: sixHourly, value: sixHourly});
  declare("InternetGatewayDevice.X_ZHONE_COM_GPON.RxLevelString", {path: sixHourly, value: sixHourly});
  declare("InternetGatewayDevice.X_ZHONE_COM_GPON.TxLevelString", {path: sixHourly, value: sixHourly});
} else {
  // Refresh basic parameters hourly — resto de fabricantes (9 declares)
  declare("InternetGatewayDevice.DeviceInfo.HardwareVersion", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.DeviceInfo.SoftwareVersion", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.MACAddress", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID", {path: hourly, value: hourly});
  // Don't refresh password field periodically because CPEs always report blank passwords for security reasons
  declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.KeyPassphrase", {path: hourly, value: 1});
  declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.HostName", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.IPAddress", {path: hourly, value: hourly});
  declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.MACAddress", {path: hourly, value: hourly});
}
