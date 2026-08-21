// Provision: default
// Canal: default (se ejecuta en cada sesión CWMP después del inform)
// Última revisión: 2026-07-24 — fix timestamp redondeado (resolve CPU storm)
//
// IMPORTANTE: Date.now() sin redondear provoca que declare() compare
// un pathTimestamp > currentTimestamp → GetParameterNames completo cada sesión.
// Redondear al intervalo (hora) evita el re-descubrimiento innecesario.

const hourly = Date.now() - (Date.now() % 3600000);

// Refresh basic parameters hourly
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
