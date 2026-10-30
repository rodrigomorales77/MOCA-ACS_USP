# Integración con el Sistema de Gestión — API `ont-gateway` (v1)

**Estado:** Vigente para primera entrega (v1)\
**Audiencia:** equipo que integra el Sistema de Gestión contra el gateway. No requiere\
conocer fabricantes, modelos, firmware ni TR-069.

> Esta guía contiene **solo** lo necesario para integrar. Detalles internos
> (despliegue, base de datos, perfiles de mapeo, jobs de mantenimiento) quedan
> fuera de alcance a propósito.

---

## 1. Qué es y qué cubre v1

`ont-gateway` es una API REST de negocio sobre las ONT. Usted trabaja con conceptos
(`wifi`, `wan`, `lan`, `gpon`, `reboot`) y el gateway traduce al equipo real, sea
Zhone, Huawei o ZTE.

**Incluido en v1:**

- Lecturas: `device`, `wifi` (2g/5g), `wan` (incluye **lista de instancias** internet + MGMT), `lan`, `gpon`, `capabilities`, `diagnostics` (lectura de sensores).
- Acciones: `reboot`, `factory-reset` (con confirmación), `refresh` (simple y por sección, ej. `?section=wan`).
- Escrituras: `PATCH` de wifi (SSID), WAN (PPPoE/VLAN según modelo) y LAN (según modelo).
- Seguimiento de tareas: `GET /tasks`, `GET /tasks/{id}`.
- Mantenimiento de lectura: `GET /maintenance/stale` (candidatos a purga, informativo).

**Explícitamente fuera de v1** (devuelven `501 Not Implemented`):

- `POST /diagnostics/ping` y `POST /diagnostics/traceroute` (requieren descubrimiento por modelo; van en v2).
- Upgrade de firmware (sin endpoint en v1).
- Escritura en instancias MGMT (solo lectura, siempre).

---

## 2. Conectividad

- **Base URL:** `http://<gateway-host>:3001/api/v1`
- **Canal:** al cierre de este documento el gateway escucha solo en la red interna del
  servidor (`127.0.0.1:3001`). El acceso es vía túnel SSH al host de producción
  (pedir host, puerto y usuario al administrador). El canal definitivo
  (VPN o exposición con TLS) se define antes de la puesta en marcha del Sistema de Gestión.
- **Ejemplo vía túnel** (desde la máquina del integrador):

```bash
ssh -L 3001:127.0.0.1:3001 <usuario>@<host-prod> -N
# luego la API responde en http://127.0.0.1:3001/api/v1
```

---

## 3. Autenticación

- **Mecanismo:** header HTTP dedicado en cada pedido (no va en la URL ni en el body):

```bash
curl -s -H "X-API-Key: <clave-del-cliente>" http://127.0.0.1:3001/api/v1/onts
```

- **Provisión:** la clave la emite el administrador (una por sistema cliente, con nombre
  identificable, ej. `sistema-gestion`). Guárdela como secreto (ej. variable de entorno,
  nunca en código ni en logs).
- **Rotación sin corte:** se emite una clave nueva → se verifica con un `GET` de prueba →
  recién entonces se desactiva la vieja. Las desactivadas dejan de funcionar al instante
  pero se conserva su auditoría.
- **Errores:** sin header o clave inválida/desactivada → `401` (`X-API-Key requerida` /
  `API key inválida`). Ante `401` persistente, pedir rotación al administrador (no reintentar en loop).
- **Límite:** 60 pedidos por minuto por clave (`429` + header `Retry-After`; esperar y reintentar con backoff).

---

## 4. Modelo async (acciones) vs sync (lecturas)

**Lecturas (`GET`) son sincrónicas e instantáneas** (milisegundos): responden desde el
snapshot del ACS, sin despertar al equipo.

**Acciones (`POST`, `PATCH`) son asincrónicas**: el equipo puede tardar minutos en
aplicarlas (duerme entre informs). Flujo:

1. `POST ...` → `202 { "taskId": 48 }` (pedido aceptado, NO aplicado todavía).
2. Poll `GET /tasks/48` hasta estado terminal.
3. Estados: `pending` (en curso/reintentando) → `applied` (aplicado) |
   `failed` (agotó reintentos, solo acciones destructivas) | `expired` (venció el TTL).
   El campo `error` trae el último fault si lo hubo.

```bash
# 1. Pedir reboot
curl -s -X POST -H "X-API-Key: <key>" \
  http://127.0.0.1:3001/api/v1/onts/5A4E54533A873493/reboot
# {"taskId":48}

# 2. Consultar hasta que cierre
curl -s -H "X-API-Key: <key>" http://127.0.0.1:3001/api/v1/tasks/48
# {"id":48,"status":"applied","applied_at":"...","error":null, ...}
```

**TTL:** cada task vence (default 24 h, máximo 7 d con `?ttl=`). El refresh valida
`last_inform` vs TTL: equipo offline más que el TTL → `409` sin encolar nada.

---

## 5. Frescura de datos (anti-ansiedad)

Toda lectura trae su edad — **siempre mire `freshness` antes que el valor**:

```json
"freshness": {
  "last_inform": "2026-10-16T22:14:29Z",
  "age_min": 1,
  "stale": false,
  "refreshing": false,
  "task_ids": [],
  "sections": {
    "wan":  { "age_min": 12,   "leaves": 8, "empty": 0, "stale": false, "reason": null },
    "gpon": { "age_min": 8640, "leaves": 3, "empty": 0, "stale": true,  "reason": "aged" }
  }
}
```

- `age_min` (nivel raíz): minutos desde el último inform del equipo. Es la salud del
  enlace, **no** la edad de los datos.
- `sections`: edad real de los datos de cada sección, leída del ACS.
  - `age_min`: minutos desde la lectura más reciente de esa sección (`null` si nunca se leyó).
  - `empty`: cuántos campos de la sección no tienen dato. `leaves`: cuántos se sirven.
  - `stale`: `true` si hay que refrescar.
  - `reason`: `null` (fresco) | `empty_snapshot` (nunca se leyó) | `aged` (más viejo que el
    umbral) | `offline_ttl` (el equipo no informa hace más que el TTL: no se refresca solo) |
    `nbi_error` (falla transitoria al consultar).
- `stale` (raíz): `true` si **alguna** sección pedida está vencida. `refreshing: true` y
  `task_ids`: el gateway ya encoló el refresh en background; seguí esas tasks y re-GETeá.
- **Regla de oro:** dato fresco → uselo. Dato viejo → no hace falta que pida nada, el
  gateway ya se está refrescando solo. Para forzarlo o para secciones sin refresh
  automático: `POST /refresh?section=X` (o `?max_age=<seg>`, que solo crea la task si el
  dato no está fresco). Los refresh por sección disponibles hoy: `wan` (Huawei y Zhone) y
  `gpon`/`device`. Sin `section` refresca los datos básicos del equipo.

### 5.1 Equipo nuevo o sin lecturas previas (cold start)

TR-069 no lee solo: el ACS guarda lo que el equipo informa **más** lo que se le pidió
leer alguna vez. Un equipo recién instalado (o al que nunca se le hizo lectura completa)
puede tener un documento mínimo, y una lectura devuelve campos vacíos **sin que eso
signifique que el equipo no los tenga**.

Cómo lo ve en la respuesta:

```json
"wan": { "mode": { "supported": true, "value": null, "reason": "empty_snapshot" } },
"freshness": { "stale": true, "refreshing": true, "task_ids": [412],
               "sections": { "wan": { "age_min": null, "empty": 1, "stale": true, "reason": "empty_snapshot" } } }
```

Flujo recomendado (no hay que hacer nada especial, solo no confundirse):

1. Reciba el `GET` con `value: null` + `reason: "empty_snapshot"`. **No** es "el equipo no
   tiene el dato".
2. Como `refreshing: true`, el refresh ya está encolado: espere `task_ids` hasta `applied`
   (normalmente segundos si el equipo está en línea; minutos si duerme).
3. Relea el `GET`: ahora `empty` baja a `0` y `age_min` es chico.

Si el equipo está **offline más que el TTL** (default 24 h), el gateway **no** encola el
refresh (nacería vencido) y lo reporta como `reason: "offline_ttl"`. En ese caso el dato
llega cuando el equipo vuelva a informar: no insista con refresh en loop.

> Nota de flota: el primer barrido completo puede encontrar muchos equipos así. Conviene
> hacerlo escalonado (por lotes), no todo junto, para no saturar la cola del ACS.


Ejemplo: WAN con instancias (internet + MGMT) en una Huawei:

```bash
curl -s -H "X-API-Key: <key>" \
  http://127.0.0.1:3001/api/v1/onts/5A4E54533A873493/wan
```

```json
"wan": {
  "mode": {"value": "pppoe"}, "status": {"value": "connected"},
  "ip": {"value": "172.17.117.148"},
  "instances": {"value": [
    {"index": "1.1.1", "service": "pppoe", "name": "1_INTERNET_R_VID_301", "status": "connected", "ip": "172.17.117.148", "vlan": 301},
    {"index": "1.3.1", "service": "ipoe", "name": "3_TR069_INTERNET_R_VID_10", "status": "connected", "ip": "10.1.226.102", "vlan": 10}
  ]}
}
```

> `instances` enumera **todas** las WAN (internet + MGMT). Los índices varían por equipo
> (`.1`/`.3`, `.1`/`.2`): nunca los asuma, siempre lea la lista. La MGMT es **solo lectura**.

Listar y filtrar equipos:

```bash
curl -s -H "X-API-Key: <key>" 'http://127.0.0.1:3001/api/v1/onts?query=HS8145&limit=25'
curl -s -H "X-API-Key: <key>" 'http://127.0.0.1:3001/api/v1/onts/<SERIAL>/capabilities'
```

`capabilities` dice qué soporta cada equipo (`supported: true/false` + motivo).
Respételo: lo marcado `false` responde `422`, no es un error del sistema.

---

## 6. Escrituras (con cuidado)

- `PATCH /onts/{serial}/wifi` (ej. `{"wifi.radio.2g.ssid": "NuevoNombre"}`), `PATCH .../wan`,
  `PATCH .../lan`: responden `202` y van por el mismo flujo async de tasks (§4).
- Campos `ro` (lectura) → `422`. Campos `wo` (ej. passwords) se aceptan pero **nunca se
  devuelven** (por diseño, no es un bug: `value` no existe para ellos, verifíquelo por otro medio).
- `POST /onts/{serial}/factory-reset` exige `{"confirm": true}` (sin eso → `400`).
  **En Huawei, el factory-reset puede dejar la ONU sin reprovisionar**: úselo solo con
  confirmación explícita del cliente en sala.
- Tras un PATCH exitoso (`applied`), el `GET` muestra el valor nuevo cuando el equipo
  informa; la fuente de verdad del cambio es el estado del task, no la lectura inmediata.

---

## 7. Errores (qué hacer con cada uno)

| Código | Significado | Acción del integrador |
|---|---|---|
| `400` | Pedido mal formado (falta `target`, `confirm`, `section` inválida, `ttl` fuera de rango) | Corregir el pedido |
| `401` | Falta la key o es inválida/desactivada | Revisar header; si persiste, pedir rotación (no loopear) |
| `404` | Serial no existe en el índice | Verificar serial; si el equipo volvió a la red aparece solo |
| `409` | Conflicto: equipo offline más que el TTL, o serial ambiguo | Esperar/reintentar más tarde (o subir `?ttl=`); ante ambigüedad, usar el `device_id` sugerido |
| `422` | No soportado por el perfil (capability `false`, campo `ro`, sección no mapeada) | Leer `capabilities` primero; no reintentar igual |
| `429` | Límite 60/min excedido | Esperar `Retry-After` con backoff |
| `501` | Fuera de alcance v1 (ping/traceroute) | No llamar; va en v2 |
| `502` | Falla transitoria del ACS | Reintentar con backoff |

---

## 8. Puesta en marcha (checklist v1)

1. [ ] Definir canal de conectividad (túnel actual vs VPN/exposición con TLS).
2. [ ] Emitir `X-API-Key` del Sistema de Gestión (+ guardar procedimiento de rotación).
3. [ ] Integrador prueba: `GET /onts?limit=1` → `GET /wan` de 1 equipo (leer `freshness` + `instances`) → `POST /refresh?section=wan` → poll de task → `applied`.
4. [ ] Definir umbrales de frescura propios por sección (sugeridos: device 1 h, wan 4 h, gpon 1 h, wifi 24 h, lan 12 h).
5. [ ] Acordar criterio de equipos offline (hoy: online = inform en últimos 5 min; bajas >15 d se purgan automáticamente y reaparecen solas si vuelven).

## 9. Referencia rápida de consultas v1

Base: `BASE=http://127.0.0.1:3001/api/v1` con `-H "X-API-Key: <key>"` en cada pedido.
Lecturas (`GET`) responden al instante; acciones (`POST`/`PATCH`) devuelven `202 {taskId}`
y se siguen con `GET /tasks/{id}` hasta `applied` (§4).

```bash
# ── Equipos ─────────────────────────────────────────────────────────
GET  $BASE/onts?query=<texto>&limit=<n>              # listar / filtrar
GET  $BASE/onts/<SERIAL>                             # datos basicos (device)
GET  $BASE/onts/<SERIAL>/capabilities                # que soporta (leer antes de escribir)

# ── Lecturas por concepto (todas traen freshness) ─────────────────
GET  $BASE/onts/<SERIAL>/wifi                        # SSID incl. 2g/5g
GET  $BASE/onts/<SERIAL>/wan                         # WAN + instancias internet/MGMT
GET  $BASE/onts/<SERIAL>/lan
GET  $BASE/onts/<SERIAL>/gpon
GET  $BASE/onts/<SERIAL>/diagnostics                 # sensores

# ── Refresco (si freshness dice stale) ────────────────────────────
POST $BASE/onts/<SERIAL>/refresh?section=wan         # o device/gpon; max_age=<seg> opcional
POST $BASE/onts/<SERIAL>/refresh?max_age=<seg>       # solo crea task si el dato no esta fresco

# ── Acciones y escrituras (async: poll hasta applied) ────────────
POST $BASE/onts/<SERIAL>/reboot
POST $BASE/onts/<SERIAL>/factory-reset               # exige {"confirm": true}
PATCH $BASE/onts/<SERIAL>/wifi -d '{"wifi.radio.2g.ssid":"NuevoNombre"}'
PATCH $BASE/onts/<SERIAL>/wan                        # PPPoE/VLAN segun modelo
PATCH $BASE/onts/<SERIAL>/lan                        # segun modelo

# ── Seguimiento y mantenimiento ───────────────────────────────────
GET  $BASE/tasks/<id>                                # estado de una tarea
GET  $BASE/tasks                                     # listado
GET  $BASE/onts/<SERIAL>/maintenance/stale           # candidatos a purga (informativo)
```

---

---

*Documento vivo de v1: ante un endpoint nuevo o un cambio de alcance, se actualiza acá
antes de avisar al integrador.*

&nbsp;

Atte.\
Ing. Agustín Sánchez Ghietti.
