# Diseño — Capa de Abstracción ONT (`ont-gateway`)

**Estado:** Aprobado para implementación (Fase 1)
**Fecha:** 2026-08-05
**Versión del documento:** 1.0
**Relacionado:** [REVISION_2026-07-09](./REVISION_2026-07-09.md), [CHANGELOG](./CHANGELOG.md)

---

## 1. Contexto

GenieACS está en producción administrando ~3500 ONT de Huawei y DZS (Zhone). Los equipos
exponen su configuración por dos árboles TR-069 distintos:

- **TR-098** — `InternetGatewayDevice.*`
- **TR-181** — `Device.*`

Además, cada fabricante y cada versión de firmware acomodan los parámetros en rutas
distintas. Un nuevo **Sistema de Gestión** (en desarrollo) necesita operar sobre esas ONT
sin conocer fabricantes, modelos, firmware ni rutas TR-069.

Este documento define una **capa de abstracción** (`ont-gateway`) que expone al Sistema de
Gestión una API REST de negocio y traduce a los parámetros reales de cada equipo vía el NBI
de GenieACS. No busca normalizar todo el árbol: comienza por los parámetros y operaciones
que el Sistema de Gestión realmente usa (~80% del caso) e irá ampliando.

Principios rectores (extraídos de la revisión crítica previa):

1. **API asíncrona.** TR-069 no es instantáneo: pedir un cambio encola una tarea que se
   aplica cuando el equipo vuelve a conectarse. La API responde `202 + taskId` y el estado
   se consulta después.
2. **Catálogo = modelo canónico v0.** Son una sola cosa. Los nombres de la convención son
   inmutables desde el día 1; lo barato de ampliar es la cobertura de parámetros.
3. **Mapeo ≠ renombrar rutas.** El mapeo incluye rutas, metadata (tipo, unidad, permiso) y
   transformación de valores (booleanos `1/0`, potencias ópticas, enums, write-only).
4. **Perfil = fabricante + modelo + árbol TR-098/181 (+ firmware).** No alcanza con el
   fabricante: un mismo modelo cambia entre versiones.
5. **GenieACS queda puro ACS.** La normalización vive fuera de GenieACS. Los Virtual
   Parameters se reservan para casos puntuales (p. ej. unificar lecturas TR-098/TR-181).

---

## 2. Decisiones registradas

| # | Decisión | Justificación |
|---|----------|---------------|
| D1 | Servicio separado: `ont-gateway/`, contenedor propio | No toca `moca-backend` en producción (3500 ONT); se alinea con la arquitectura objetivo (Middleware como capa propia) |
| D2 | Autenticación por **API key por sistema** (M2M) | El consumidor es un sistema servidor, no usuarios; más simple que usuarios/sesiones/rate-limit por persona |
| D3 | Motor de adaptación **dirigido por datos** (mapping JSON + registry de transformers) | Agregar un modelo = agregar un archivo JSON, no código en el core; escala a más fabricantes |
| D4 | Catálogo canónico como primera versión del modelo de datos | Nombres estables y versionados desde el inicio |
| D5 | API versionada desde el inicio: `/api/v1/` | El Sistema de Gestión se acopla al contrato; versionar evita romperlo |
| D6 | Estados de tarea: `pending / applied / failed` | `applied` = tarea aceptada por GenieACS (no confirma la aplicación real en el equipo; ver §10) |

---

## 3. Arquitectura

### 3.1 Objetivo (largo plazo)

```
Sistema de Gestión
        │
        ▼
  Middleware / API  (ont-gateway)
        │
        ▼
  Adaptadores por perfil (dirigidos por datos)
        │
        ▼
      GenieACS (NBI)
        │
        ▼
        ONT
```

### 3.2 v1 (esta implementación)

```
Sistema de Gestión ── HTTP/API key ──► moca-gateway (Express + SQLite)
                                         │ NBI (http://moca-genieacs:7557)
                                         ▼
                                      moca-genieacs
                                         │ TR-069 (CWMP)
                                         ▼
                                        ONT
```

- Nuevo directorio `ont-gateway/` en el repo, contenedor `moca-gateway` en la red
  `moca-net` (alcanza `moca-genieacs:7557`).
- Base propia SQLite montada en `./data/gateway:/app/data`.
- No modifica `moca-backend`, `moca-nginx` ni `moca-genieacs`.
- El frontend MOCA actual no consume esta API (sigue usando `moca-backend`).

### 3.3 Estructura propuesta del servicio

```
ont-gateway/
├── Dockerfile
├── package.json
├── server.js                  # arranque: initDb, seed keys, scheduler, listen
└── src/
    ├── app.js                 # Express: auth API key, rutas /api/v1, error handler
    ├── config/
    │   ├── db.js              # SQLite (schema §10, §11)
    │   └── env.js             # variables de entorno validadas
    ├── middleware/
    │   ├── api-key.js         # valida X-API-Key contra tabla api_keys
    │   └── rate-limit.js      # límite en memoria por key
    ├── resolver/
    │   └── device.js          # serial → device_id → perfil (índice local, §5)
    ├── catalog/
    │   └── index.js           # carga catalog.json (valida nombres/tipos)
    ├── profiles/              # mapping JSON por perfil (§8)
    │   ├── HUAWEI_HG8245H_TR098.json
    │   ├── DZS_ZNID24xxA1_TR098.json
    │   └── ...
    ├── mapping/
    │   ├── engine.js          # motor genérico: canónico ⇄ rutas reales (§9)
    │   └── transformers.js    # registry de transformaciones de valor (§9.3)
    ├── routes/
    │   ├── onts.js            # GET/PATCH /onts..., POST acciones
    │   └── tasks.js           # GET /tasks, GET /tasks/:id
    ├── jobs/
    │   ├── device-index.js    # refresca índice serial→device (patrón device-bootstrap)
    │   └── task-runner.js     # scheduler que aplica tareas pending (patrón MOCA)
    └── services/
        └── genieacs.js        # cliente NBI (proyecciones, batch, cache)
```

---

## 4. Alcance v1

### 4.1 Incluido

- **Lectura y escritura** de: WiFi (2.4/5 GHz), WAN (PPPoE/IPoE/Bridge, VLAN, NAT, MTU),
  LAN (IP, DHCP, DNS).
- **Solo lectura**: información general del equipo, estado GPON/óptico, diagnóstico
  (temperatura, CPU, memoria).
- **Acciones**: reboot, factory reset, ping, traceroute, refresh de objetos.
- Identificación de dispositivos por serial.
- Trazabilidad de tareas (estado, error, auditoría).

### 4.2 Excluido (fuera del alcance v1)

- VoIP, Firewall (ACL/Port Forward/DMZ/UPnP), Routing estático/IPv6, DDNS, Time/NTP,
  administración de acceso (HTTP/SSH/Telnet/password de admin).
- **Firmware upgrade** (ver `firmware-monitor` en el backend: pendiente de rediseño — no
  reutilizar su lógica actual).
- Descarga/subida de configuraciones completas.
- Escritura de parámetros write-only distintos de password WiFi/PPPoE.

El catálogo (§6) documenta la versión v1; se amplía de forma incremental (ver §12).

---

## 5. Identificación de dispositivos

GenieACS identifica cada dispositivo por `_deviceId` en el formato
`OUI-PRODUCTCLASS-SERIALNUMBER`. El Sistema de Gestión conoce el **serial**, no el
`_deviceId`.

El gateway mantiene una **tabla índice local** (`devices`) refrescada por un job
(`device-index.js`) cada 5 minutos con el patrón de `device-bootstrap` ya existente:

- Consulta al NBI en lotes de 500 con **proyección mínima**:
  `_id, _deviceId, InternetGatewayDevice.DeviceInfo.{Manufacturer,ModelName,SoftwareVersion},
   Device.DeviceInfo.{Manufacturer,ModelName,SoftwareVersion}, _lastInform`
- Extrae `serial` (último segmento de `_deviceId`) y el **perfil** (fabricante + modelo +
  árbol detectado: TR-098 si tiene `InternetGatewayDevice`, TR-181 si tiene `Device`).
- Almacena: `serial, device_id, manufacturer, model, profile, software_version, last_inform`.

Resolución en cada request:

- `serial` → fila única en `devices` → `device_id` + `profile`.
- Serial inexistente → `404`.
- Serial con más de un device asociado → `409` con la lista de candidatos (no adivinar).

> Nota: el `_deviceId` puede contener puntos en el `PRODUCTCLASS`, por eso se consulta por
> `_id` con `encodeURIComponent` y la extracción de serial se hace sobre el último segmento.

---

## 6. Modelo de datos canónico v0 (Catálogo)

### 6.1 Convención de nombres

- `seccion.subseccion.campo` en `snake_case`, `ascii`, minúsculas.
- Bandas WiFi como `wifi.radio.2g.*` y `wifi.radio.5g.*` (6 GHz se agrega como
  `wifi.radio.6g.*` cuando aplique).
- Sin índices de instancia en la convención salvo donde existan múltiples instancias
  (radios). El mapeo por perfil resuelve el índice real (p. ej. `WLANConfiguration.1`).
- Unidades siempre SI o las de la disciplina (dBm para óptico, bytes/seg en su caso),
  documentadas en la columna Unidad.
- Permisos: `RO` (solo lectura), `RW` (lectura/escritura), `WO` (write-only).

### 6.2 Catálogo v1

#### Información general (RO)

| Ruta canónica | Tipo | Unidad | Permiso | Notas |
|---|---|---|---|---|
| `device.serial` | string | — | RO | serial reportado por el equipo |
| `device.manufacturer` | string | — | RO | |
| `device.model` | string | — | RO | |
| `device.hardware_version` | string | — | RO | |
| `device.software_version` | string | — | RO | |
| `device.uptime` | int | segundos | RO | desde el encendido del equipo |
| `device.last_inform` | datetime | UTC | RO | último Inform TR-069 |
| `device.provisioning_code` | string | — | RW | |

#### WiFi (RW, por radio)

| Ruta canónica | Tipo | Unidad | Permiso | Notas |
|---|---|---|---|---|
| `wifi.radio.2g.enabled` / `wifi.radio.5g.enabled` | bool | — | RW | |
| `wifi.radio.2g.ssid` / `wifi.radio.5g.ssid` | string | — | RW | |
| `wifi.radio.2g.ssid_hidden` / `wifi.radio.5g.ssid_hidden` | bool | — | RW | broadcast SSID oculto |
| `wifi.radio.2g.password` / `wifi.radio.5g.password` | string | — | WO | **no se puede leer de vuelta** |
| `wifi.radio.2g.channel` / `wifi.radio.5g.channel` | int | — | RW | `0` = auto |
| `wifi.radio.2g.bandwidth` / `wifi.radio.5g.bandwidth` | enum | MHz | RW | canónico: `20`, `40`, `80`, `160`, `auto` |
| `wifi.radio.2g.security` / `wifi.radio.5g.security` | enum | — | RW | canónico: `none`, `wpa2-psk`, `wpa3-psk`, `wpa2-wpa3-psk`, `wpa-psk`, `wep` |
| `wifi.radio.2g.max_clients` / `wifi.radio.5g.max_clients` | int | — | RW | |
| `wifi.radio.2g.tx_power` / `wifi.radio.5g.tx_power` | int | dBm | RW | |

#### WAN (parcial)

| Ruta canónica | Tipo | Unidad | Permiso | Notas |
|---|---|---|---|---|
| `wan.mode` | enum | — | RW | `pppoe`, `ipoe`, `bridge` |
| `wan.pppoe.username` | string | — | RW | solo aplica en modo pppoe |
| `wan.pppoe.password` | string | — | WO | write-only |
| `wan.vlan_id` | int | — | RW | |
| `wan.nat.enabled` | bool | — | RW | |
| `wan.mtu` | int | — | RW | |
| `wan.ip` | string | — | RO | IP WAN actual (lectura) |
| `wan.gateway` | string | — | RO | |
| `wan.dns.primary` | string | — | RO | |
| `wan.dns.secondary` | string | — | RO | |
| `wan.status` | enum | — | RO | `connected`, `disconnected`, `unknown` |

> En v1 los campos `wan.ip/gateway/dns/status` se mapean a la conexión WAN activa
> (típicamente la que tiene IP externa). El mapeo por perfil fija qué instancia consulta.

#### LAN (RW / parcial)

| Ruta canónica | Tipo | Unidad | Permiso | Notas |
|---|---|---|---|---|
| `lan.ip` | string | — | RW | IP del gateway LAN |
| `lan.netmask` | string | — | RW | |
| `lan.dhcp.enabled` | bool | — | RW | |
| `lan.dhcp.pool_start` | string | — | RW | |
| `lan.dhcp.pool_end` | string | — | RW | |
| `lan.dhcp.lease_time` | int | segundos | RW | |
| `lan.dhcp.dns.primary` | string | — | RW | |
| `lan.dhcp.dns.secondary` | string | — | RW | |

#### GPON / óptico (RO)

| Ruta canónica | Tipo | Unidad | Permiso | Notas |
|---|---|---|---|---|
| `gpon.status` | string | — | RO | estado de la ONU |
| `gpon.loid` | string | — | RW | LOID/Loid/LoidLine (varía por fabricante) |
| `gpon.rx_power` | float | dBm | RO | potencia óptica de recepción |
| `gpon.tx_power` | float | dBm | RO | potencia óptica de transmisión |
| `gpon.distance` | float | km | RO | distancia estimada |
| `gpon.ploam` | string | — | RO | información de autenticación PLOAM |

> El inventario (Fase 2) confirmará nombres reales de los parámetros ópticos por modelo;
> si un modelo no reporta alguno, se devuelve `null` (ver §9.4).

#### Diagnóstico (RO / acciones)

| Ruta canónica | Tipo | Unidad | Permiso | Notas |
|---|---|---|---|---|
| `diagnostics.temperature` | float | °C | RO | si el equipo la reporta |
| `diagnostics.cpu_usage` | float | % | RO | si el equipo la reporta |
| `diagnostics.memory_usage` | float | % | RO | si el equipo la reporta |
| `diagnostics.collected_at` | datetime | UTC | RO | momento de la última medición |

#### Acciones

| Ruta canónica | Acción | Notas |
|---|---|---|
| `actions.reboot` | `reboot` | requiere `command_key` |
| `actions.factory_reset` | `factoryReset` | requiere `command_key` |
| `actions.ping` | `diagPing` | body: `{ target }` |
| `actions.traceroute` | `diagTraceRoute` | body: `{ target }` |
| `actions.refresh` | `refreshObject` | re-lectura del árbol completo |

### 6.3 Reglas de escritura

- Un `PATCH` agrupa los campos del cuerpo en **un solo** `setParameterValues` (misma
  transacción al equipo).
- Si un campo del cuerpo no está soportado por el perfil del equipo → `400` con el nombre
  del campo (no escribir el resto silenciosamente).
- Un campo `WO` (password) se acepta solo en `PATCH`, nunca se devuelve en `GET`
  (§9.4).

---

## 7. Contrato API

Base URL: `http://<gateway>/api/v1` · Header de autenticación: `X-API-Key: <key>`
(ver §11).

Todos los `GET` responden `200`; todos los `PATCH`/`POST` de cambio responden
**`202 Accepted`** con `{ taskId }` (asíncrono). Errores: `400` validación, `401`/`403`
auth, `404` serial no encontrado, `409` serial ambiguo, `422` operación no soportada por
el modelo, `429` rate limit.

| Método | Ruta | Descripción | Respuesta |
|---|---|---|---|
| GET | `/onts?page=&limit=&query=` | Lista paginada (serial, fabricante, modelo, firmware, online) | `200` |
| GET | `/onts/{serial}` | Todos los parámetros canónicos del equipo | `200` |
| GET | `/onts/{serial}/device` | Información general | `200` |
| GET | `/onts/{serial}/wifi` | WiFi por radio | `200` |
| PATCH | `/onts/{serial}/wifi` | Cambia subconjunto de campos WiFi | `202` |
| GET | `/onts/{serial}/wan` | WAN | `200` |
| PATCH | `/onts/{serial}/wan` | Cambia subconjunto de campos WAN | `202` |
| GET | `/onts/{serial}/lan` | LAN | `200` |
| PATCH | `/onts/{serial}/lan` | Cambia subconjunto de campos LAN | `202` |
| GET | `/onts/{serial}/gpon` | GPON/óptico | `200` |
| GET | `/onts/{serial}/diagnostics` | Diagnóstico | `200` |
| POST | `/onts/{serial}/reboot` | Reinicia el equipo | `202` |
| POST | `/onts/{serial}/factory-reset` | Restablece fábrica | `202` |
| POST | `/onts/{serial}/diagnostics/ping` | body `{ target }` | `202` |
| POST | `/onts/{serial}/diagnostics/traceroute` | body `{ target }` | `202` |
| POST | `/onts/{serial}/refresh` | Re-lectura del árbol | `202` |
| GET | `/onts/{serial}/capabilities` | Capacidades del perfil (qué secciones soporta) | `200` |
| GET | `/tasks?serial=&status=&page=` | Lista de tareas | `200` |
| GET | `/tasks/{taskId}` | Estado de una tarea | `200` |
| GET | `/health` | Health check (BD + NBI) | `200` |

Nunca se expone un `setParameterValues(Device.WiFi.SSID.1.SSID)`: la API habla en términos
del catálogo (§6).

---

## 8. Archivos de mapeo por perfil

Cada perfil (fabricante + modelo + árbol) tiene su JSON en `profiles/`. Formato:

```json
{
  "$schema": "profile.schema.json",
  "profile": "HUAWEI_HG8245H_TR098",
  "manufacturer": "HUAWEI",
  "model": "HG8245H",
  "tree": "tr098",
  "firmware_min": null,
  "params": {
    "wifi.radio.2g.enabled": {
      "path": "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable",
      "type": "boolean",
      "mode": "rw",
      "transform": "bool_1_0_string"
    },
    "wifi.radio.2g.ssid": {
      "path": "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
      "type": "string",
      "mode": "rw"
    },
    "wifi.radio.2g.password": {
      "path": "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey",
      "type": "string",
      "mode": "wo",
      "transform": "wifi_passphrase"
    },
    "gpon.rx_power": {
      "path": "InternetGatewayDevice.DeviceInfo.X_HUAWEI-COM_GPON...RXOpticalPower",
      "type": "float",
      "unit": "dBm",
      "mode": "ro",
      "transform": "dbm_milli_to_dbm"
    }
  },
  "actions": {
    "reboot": { "task": "reboot", "command_key": "gateway-reboot" },
    "factory_reset": { "task": "factoryReset", "command_key": "gateway-factory-reset" },
    "refresh": { "task": "refreshObject", "object_name": "" }
  },
  "groups": {
    "wifi.radio.2g": ["wifi.radio.2g.enabled", "wifi.radio.2g.ssid", "wifi.radio.2g.password", "wifi.radio.2g.channel", "wifi.radio.2g.bandwidth", "wifi.radio.2g.security", "wifi.radio.2g.max_clients", "wifi.radio.2g.tx_power", "wifi.radio.2g.ssid_hidden"],
    "wan": ["wan.mode", "wan.pppoe.username", "wan.pppoe.password", "wan.vlan_id", "wan.nat.enabled", "wan.mtu", "wan.ip", "wan.gateway", "wan.dns.primary", "wan.dns.secondary", "wan.status"],
    "lan": ["lan.ip", "lan.netmask", "lan.dhcp.enabled", "lan.dhcp.pool_start", "lan.dhcp.pool_end", "lan.dhcp.lease_time", "lan.dhcp.dns.primary", "lan.dhcp.dns.secondary"]
  }
}
```

Metadata soportada por `params.<nombre>`:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `path` | string | sí | ruta TR-069 real (lectura y escritura) |
| `type` | string | sí | `string`, `boolean`, `int`, `float`, `enum`, `datetime` |
| `mode` | string | sí | `ro`, `rw`, `wo` |
| `unit` | string | no | unidad canónica |
| `transform` | string | no | nombre de función en `transformers.js` |
| `enum` | array | no | valores canónicos posibles (para validación en PATCH) |
| `read_paths` | array | no | rutas alternativas de lectura cuando la instancia varía (p. ej. WAN activa) |
| `select` | object | no | regla de selección de instancia: `{ by_status, equals }` — resuelve `{i}` en runtime |
| `description` | string | no | para documentación |

### 8.1 Transformers

`mapping/transformers.js` registra funciones puras con firma:

```js
// direction: 'to_device' (canónico → TR-069) | 'to_canonical' (TR-069 → canónico)
transform(value, direction) => value
```

Catálogo inicial de transformers esperado (a confirmar con el inventario):

- `bool_1_0_string` — booleano canónico ⇄ `"1"`/`"0"` (o `"true"`/`"false"`, según perfil)
- `dbm_milli_to_dbm` — potencias ópticas en escalas distintas (Huawei suele reportar en
  unidades ×0.1 dBm o valores especiales)
- `wifi_security_enum` — enums de seguridad por fabricante (WPA2-PSK vs `"WPA2-PSK"` vs
  códigos)
- `bandwidth_enum` — canales/bandwidth codificados (20/40/80 ↔ códigos)
- `wifi_passphrase` — validación de largo 8-63 (write-only)

---

## 9. Motor de adaptación dirigido por datos

Sin clases `HuaweiAdapter`/`DZSAdapter` con lógica interna: un **motor genérico** en
`mapping/engine.js` opera contra el mapping JSON del perfil resuelto (§5). El único lugar
con código específico es `transformers.js` (funciones puras por nombre).

### 9.1 Lectura (`GET /onts/{serial}/{section}`)

1. Resolver `serial → device_id + profile` (índice local, §5).
2. Cargar `profiles/<profile>.json`.
3. Tomar los `params` del grupo solicitado.
4. Si algún param declara `select`, resolver la instancia activa: consultar
   `select.by_status` (wildcard `*`) y tomar el índice donde el valor es
   `select.equals` (ej. Zhone escanea `LANDevice.*.X_ZHONE_COM_PPPoEStatus.ConnectionStatus = Connected`).
   Sustituir `{i}` en `path`. Para Huawei la instancia es fija por rol (`WANConnectionDevice.1` = PPPoE).
5. Consultar NBI: `GET /devices?query={_id}&projection=<paths reales + read_paths>` (con `{i}` ya resuelto).
6. Para cada valor: aplicar `transform(..., 'to_canonical')`.
7. Campos `WO` se omiten del resultado (nunca se leen).
8. Respuesta con la estructura del grupo (§6.2).

### 9.2 Escritura (`PATCH /onts/{serial}/{section}`)

1. Validar el cuerpo contra el catálogo y el perfil (`400`/`422` si hay campos no
   soportados o valores inválidos).
2. Resolver `select` igual que en lectura (paso 4 de §9.1) para determinar la instancia
   destino; si `wan.mode` cambia, el mapeo puede declarar `multi_field` (un canónico → varios paths).
3. Aplicar `transform(..., 'to_device')` a cada campo.
4. Crear tarea `pending` en SQLite con el payload canónico (para auditoría).
5. Encargar la ejecución al job `task-runner.js` (§10).
6. Responder `202 + { taskId }`.

### 9.3 Acciones (`POST`)

Traducir la acción canónica al task de GenieACS definido en `profile.actions`
(`reboot`, `factoryReset`, `refreshObject`, `diagPing`, `diagTraceRoute`) y encolar la
tarea. Los RPCs con resultado (ping/traceroute) se modelan como tareas que almacenan la
salida del RPC en la columna `result` cuando esté disponible.

### 9.4 Ausencia de parámetros y capacidades por perfil

El inventario (Fase 2) demostró que hay tres situaciones distintas que el Sistema de
Gestión debe distinguir:

1. **`not_supported`** — el perfil del modelo no tiene mapeo para el campo canónico
   (ej. `gpon.*` en ZTE F890L, `wifi.radio.5g.*` en ZNID). El campo no se muestra en el UI.
2. **`no_value`** — el campo existe en el perfil pero el snapshot vino vacío (ej. óptico
   Huawei en el export viejo). El campo se muestra como "Sin dato".
3. **Valor presente** — el campo existe y tiene dato (ej. `gpon.rx_power = -17`).

#### Declaración estática: `capabilities` en el perfil

Cada perfil declara qué secciones canónicas soporta. Esto se calcula una vez al
construir el perfil (a partir del inventario) y no cambia entre unidades del mismo modelo:

```json
{
  "capabilities": {
    "device": { "supported": true },
    "wifi.radio.2g": { "supported": true },
    "wifi.radio.5g": { "supported": false, "reason": "model_no_5g_radio" },
    "wan": { "supported": true },
    "lan": { "supported": true },
    "gpon": { "supported": false, "reason": "model_no_gpon_tree" },
    "diagnostics": { "supported": false, "reason": "model_no_diagnostics" }
  }
}
```

#### Resolución runtime

El motor de mapping cruza `capabilities[sección]` con el snapshot de GenieACS:

| Perfil dice | GenieACS devuelve | Resultado |
|---|---|---|
| `supported: false` | (no aplica) | `not_supported` — el UI oculta el campo |
| `supported: true` | Ruta vacía o ausente en snapshot | `no_value` — el UI muestra "Sin dato" |
| `supported: true` | Ruta con valor | `ok` — el UI muestra el valor |

#### Respuesta de lectura

```json
{
  "gpon": {
    "rx_power": { "supported": false, "value": null, "reason": "model_not_capable" }
  }
}
```

```json
{
  "gpon": {
    "rx_power": { "supported": true, "value": null, "reason": "empty_snapshot" }
  }
}
```

```json
{
  "gpon": {
    "rx_power": { "supported": true, "value": -17, "reason": null }
  }
}
```

#### Endpoint de capacidades

`GET /onts/{serial}/capabilities` devuelve las `capabilities` del perfil asignado a ese
equipo. El UI lo consulta al cargar el formulario y sabe qué campos mostrar, deshabilitar
u ocultar.

---

## 10. Modelo de tareas y ejecución

### 10.1 Esquema SQLite

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                -- p. ej. 'sistema-gestion'
  key_hash TEXT NOT NULL UNIQUE,     -- SHA-256 de la key
  active INTEGER DEFAULT 1,
  last_used TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  serial TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  profile TEXT NOT NULL,
  software_version TEXT,
  last_inform TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT NOT NULL,
  device_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  action TEXT NOT NULL,              -- p. ej. 'wifi.update', 'reboot', 'diagPing'
  payload_canonical TEXT,            -- JSON canónico (auditoría)
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','failed')),
  error TEXT,
  result TEXT,                       -- salida de RPCs de diagnóstico
  api_key_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_serial ON tasks(serial);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_name TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 10.2 Ejecución (`task-runner.js`)

Mismo patrón que el `scheduler` de MOCA:

- Corre cada 60 s, con flag `isRunning` para evitar solapamiento.
- Toma tareas `pending` ordenadas por `created_at`.
- Para cada una: traduce payload canónico → `setParameterValues` (o el task definido) y
  llama `POST /devices/{id}/tasks?connection_request` al NBI.
- Éxito → `applied` + `applied_at`; error → `failed` + `error`.

### 10.3 Semántica de `applied`

`applied` significa que **GenieACS aceptó la tarea** (la encoló para el próximo Inform del
equipo). No confirma que el parámetro quedó efectivamente aplicado en la ONT. La
verificación real (re-lectura y comparación) se deja como mejora futura (§12) y se
documenta en la respuesta de `/tasks/{id}` cuando exista.

---

## 11. Seguridad

- **API keys**: generadas con `crypto.randomBytes(32).toString('hex')`, se guarda solo el
  hash SHA-256 en `api_keys`. Una key por sistema consumidor. Rotación = revocar + crear.
- **Secreto**: la key completa solo se muestra una vez al crearla (script `create-key.js`).
- **Rate limit** en memoria por key (patrón del login de MOCA: `auth.js`): máx. N requests
  por ventana, `429`.
- **Red**: el puerto del gateway se mapea únicamente en IP privada/red del Sistema de
  Gestión (mismo criterio que `moca-backend`). No exponer a internet directo.
- **Write-only**: los campos `wo` jamás se devuelven en respuestas `GET`.
- **Auditoría**: toda operación de escritura/acción queda en `audit_log` (key, acción,
  target, IP, timestamp).
- **Sin secretos en el repo**: `.env` del gateway (`GATEWAY_PORT`, `GATEWAY_DB_PATH`,
  `MOCAACS_GENIEACS_NBI_URL`, seed de keys) con `.env.example`. No repetir el historial
  de `.env` commiteado (ver REVISION_2026-07-09 §6).
- **`.gitignore`**: `data/` ya está ignorado; el gateway monta su BD ahí.

---

## 12. Evolución prevista

Orden recomendado, cada paso preserva el contrato de la v1:

1. **Ampliar catálogo** con VoIP, firewall, routing e IPv6 cuando el Sistema de Gestión lo
   requiera (cambios aditivos al `catalog.json` y nuevos perfiles).
2. **Mapping JSON → repositorio/SQLite** cuando los perfiles superen ~50 o necesiten
   versionado/edición sin deploy. Los JSON son la base; la migración es mecánica.
3. **Verificación post-aplicación**: tras `applied`, encolar `refreshObject` + relectura y
   comparar contra el payload; exponer `verified: true/false` en `/tasks/{id}`.
4. **Webhooks/eventos**: notificar al Sistema de Gestión cambios de estado de tareas
   (suscripción por sistema).
5. **Cache de lecturas**: TTL en memoria para `GET /onts/{serial}/...` con proyecciones
   livianas (patrón de `stats/summary` en MOCA) — clave para operar 3500+ ONTs.
6. **Multi-ACS / multi-tenant**: el resolver ya separa `serial → device`; agregar la
   columna `acs_id` y un registry de NBI endpoints.
7. **Virtual Parameters en GenieACS**: usarlos solo para casos puntuales de uso muy
   frecuente donde el inventario muestre rutas divergentes TR-098/TR-181 para la misma
   lectura; la base de normalización queda en el gateway.

---

## 13. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Serial duplicado en GenieACS (equipos reemplazados, seriales repetidos) | Resolución ambigua | Índice local + `409` con candidatos; job de indexado reporta duplicados |
| Parámetros write-only (passwords) | No se pueden leer de vuelta | `mode: wo`, omitidos en GET, validados solo en PATCH |
| Escala NBI (3500 devices) | Timeouts/carga si se consulta sin proyección | Proyección mínima, lotes de 500, cache de lecturas (§12.5) |
| Reintroducir el bug de `firmware-monitor` (reboot en loop) | Reinicios masivos | Firmware fuera de alcance v1; si se agrega, requiere deduplicación por tarea |
| Cambios WiFi/WAN requieren reboot para aplicarse | Cambio "aplicado" pero no efectivo | Documentar en la respuesta de `/tasks/{id}`; no automatizar reboot sin pedido explícito |
| Equipo offline al encolar | Tarea colgada | Estado `pending` persistente; el task-runner reintenta en cada ciclo; opcional `timeout` futuro |
| Perfil cambia tras upgrade de firmware | Mapeo equivocado | `firmware_min` en el perfil y `software_version` en el índice; resolver perfil en cada operación |
| Valores con escalas distintas por fabricante (RX/TX) | Lecturas incorrectas | Transformers por perfil obligatorios; inventario (§F2) confirma las escalas reales |
| Confundir "tarea aceptada" con "parámetro aplicado" | Falsa sensación de éxito | Semántica de `applied` documentada (§10.3) + verificación futura (§12.3) |

---

## 14. Fases de implementación

| Fase | Entregable | Estado |
|---|---|---|
| F1 | Este documento de diseño | ✅ |
| F2 | Inventario: volcar las 3 planillas a `data/inventory/`, análisis por perfil (comunes/exclusivos, RO/RW, escalas) | ⏳ pendiente de planillas |
| F3 | `catalog.json` (modelo canónico v0) + `profile.schema.json` | ⏳ |
| F4 | `profiles/*.json` + `transformers.js` (para HG8245H y ZNID24xxA1 en ambos árboles) | ⏳ |
| F5 | Implementación de `ont-gateway/` + `docker-compose.yml` + pruebas contra simulador | ⏳ |

---

## 15. Glosario

- **ACS** — Auto-Configuration Server (GenieACS aquí).
- **NBI** — North-Bound Interface de GenieACS (API REST, puerto 7557).
- **CWMP/TR-069** — protocolo de gestión de CPEs.
- **TR-098** — árbol `InternetGatewayDevice.*`.
- **TR-181** — árbol `Device.*`.
- **Perfil** — combinación fabricante + modelo + árbol (+ rango de firmware) que define un
  mapping JSON.
- **ONU/ONT** — unidad óptica de red del cliente (el CPE).
- **LOID** — Logical ONU ID, autenticación en red GPON.
