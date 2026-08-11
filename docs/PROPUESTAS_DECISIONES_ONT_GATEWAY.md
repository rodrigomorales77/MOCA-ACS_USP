# Propuestas para las decisiones abiertas del ont-gateway

**Estado:** Borrador para validación de Rodrigo (Fase 2, iteración 2026-08-11)
**Relacionado:** [DISENO_ABSTRACCION_ONT.md](./DISENO_ABSTRACCION_ONT.md) (§6, §7, §8, §9.4, §13), [INVENTARIO_ONT.md](./INVENTARIO_ONT.md)
**Alcance:** solo propuestas; no modifican el diseño hasta validarse.

---

## 1. Representación de capacidades por modelo ("no soportado" vs. "sin valor" vs. "null")

**Problema.** Hoy el diseño (§9.4) devuelve `null` si un campo no existe en el árbol, y el
`analysis.md`/inventario muestran que en la flota real hay campos que **no existen por modelo**
(ej. `wifi.radio.5g.*` en toda la familia ZNID) y otros que **existen pero vinieron vacíos**
(ej. óptico Huawei). Confundir los tres casos hace que el Sistema de Gestión no sepa si
"el equipo no tiene 5G" o "el equipo tiene 5G pero lo leímos mal".

**Propuesta.**

1. Tres estados en la respuesta de lectura, distintos de un valor normal:
   - `"not_supported"` — el modelo/perfil no tiene mapeo para el campo (se omite o `null` hoy).
   - `"no_value"` — el campo existe en el perfil pero el snapshot vino vacío (equipo sin la
     feature activa, ruta no refrescada, o lectura pendiente de validar).
   - `null` — el campo existe, se leyó, y el valor reportado es nulo/ausente de forma válida.
2. Representación JSON estable:
   ```json
   { "wifi.radio.5g": { "supported": false, "reason": "model_no_radio" } }
   { "gpon.rx_power": { "supported": true, "value": null, "status": "no_value" } }
   ```
   Alternativa más liviana: campo `supported` + campo `value`, con `supported:false` cuando no
   hay mapeo y `value:null` con `status:"no_value"` cuando hay mapeo pero sin dato.
3. **Nuevo endpoint** `GET /onts/{serial}/capabilities` que devuelve por sección canónica
   (`device`, `wifi.radio.2g`, `wifi.radio.5g`, `wan`, `lan`, `gpon`, `diagnostics`) qué campos
   soporta ese perfil y con qué `mode` (`ro`/`rw`/`wo`). El Sistema de Gestión adapta sus
   formularios sin adivinar ni "probar y ver".
4. Los `not_supported` se determinan **en tiempo de construcción del perfil** (a partir del
   inventario) y se ajustan en runtime solo si el feature-detect lo amerita (p. ej. presencia
   de `WLANConfiguration.1`). La distinción `no_value` se detecta en runtime (path existe en el
   mapeo pero GenieACS devuelve cadena vacía).

**Impacto en F3/F4:** `profile.schema.json` gana el bloque `capabilities` (declarativo) y el
grupo `status`/`supported` en la respuesta de lectura; `transformers.js` no cambia.

---

## 2. Clave primaria del índice local: `serial` vs. `device_id`

**Problema.** El diseño (§5) usa `serial` como PK de `devices`. El equipo identificó que el
`serial` puede repetirse en GenieACS (equipos reemplazados, mismo serial en el firmware) y que
el identificador estable del NBI es `_deviceId` (`OUI-PRODUCTCLASS-SERIAL`). Con PK `serial`,
un reemplazo colisiona y el índice pierde trazabilidad del equipo anterior.

**Propuesta.**

1. **`device_id` como PK** de `devices`, y `serial` como columna indexada (no única).
2. Resolución por request:
   - `serial` con 1 fila → resolver como hoy.
   - `serial` con >1 fila → `409` con candidatos `{ serial, device_id, model, last_inform }`
     (hoy el diseño ya contempla el 409; con PK `device_id` el 409 es la regla en vez del error).
3. El job `device-index.js` pasa a **upsert por `device_id`** y mantiene el `last_inform` más
   reciente; un reemplazo (mismo serial, nuevo `_deviceId`) queda como fila nueva.
4. `_lastBootstrap` se mantiene por `device_id` (ya es así en `device-bootstrap.js` de
   producción), alineando el índice con la proyección existente.

**Impacto:** cambios en el schema de §10.1 (`PRIMARY KEY(device_id)`, `INDEX(serial)`), el
resolver de §5 y `routes/onts.js`. No toca el contrato de la API salvo el caso 409 (ya previsto).

---

## 3. `wan.mode` con gestión de instancias (WAN activa)

**Problema.** El inventario confirmó que el campo canónico `wan.mode` no tiene una única fuente:
- Huawei: árbol clásico `WANDevice.1.WANConnectionDevice.{1=PPP, .3=IP}` (instancia = servicio).
- Zhone: `X_ZHONE_COM_ConnectionType = PPPoE_IP_Bridged / IP_Bridged` y el servicio activo vive
  en `LANDevice.N` (índice variable: 9/13/12/9 según modelo), resuelto por
  `X_ZHONE_COM_PPPoEStatus.ConnectionStatus = Connected`.

**Propuesta.**

1. El catálogo mantiene `wan.mode` con enum `pppoe/ipoe/bridge` (inmutable).
2. El mapeo por perfil incorpora **reglas de selección de instancia**, no rutas fijas:
   ```json
   "wan.mode": {
     "mode": "rw",
     "select": { "by_status": "InternetGatewayDevice.LANDevice.*.X_ZHONE_COM_PPPoEStatus.ConnectionStatus", "equals": "Connected" },
     "path": "InternetGatewayDevice.LANDevice.{i}.X_ZHONE_COM_ConnectionType"
   }
   ```
   El motor de mapping resuelve el índice `{i}` en runtime (feature-detect/scan de la proyección
   NBI). Para Huawei, `select` fija la instancia por rol (`WANConnectionDevice.1` = PPPoE,
   `.3` = IP) y lee `X_HW_*ConnectionStatus`/`ExternalIPAddress` para `wan.status`.
3. `wan.ip/gateway/dns/status` se leen **de la instancia activa seleccionada**, nunca de una
   fija. Si el equipo está en bridge total (ZHONE_IP_Bridged sin IP), esos campos se reportan
   como `not_supported` (ver propuesta 1) o `null`, según el modo detectado.
4. En PATCH, cambiar `wan.mode` implica: para Huawei, habilitar/deshabilitar la instancia de
   servicio correspondiente; para Zhone, setear `X_ZHONE_COM_ConnectionType`. El mapeo lo declara
   como `multi_field` (un canónico → varios paths) si hace falta.

**Impacto:** `profile.schema.json` gana `select` y `multi_field` en la metadata de params
(§8); `engine.js` implementa la resolución de instancia; `transformers.js` suma el enum de
modos por perfil.

---

## 4. Timeout y reintentos de tareas hacia equipos offline

**Problema.** El diseño (§10.2, §13) deja tareas `pending` "para siempre" si el equipo no
vuelve a conectarse; sin timeout ni límite de reintentos una tarea vieja se aplica
inesperadamente cuando el equipo reaparece (p. ej. un reboot programado hace días).

**Propuesta.**

1. Al crear la tarea se persiste `expires_at = now + TTL` (default **24 h**, configurable por
   endpoint). El `task-runner` no procesa tareas vencidas: pasan a `status = 'expired'`.
2. Estado `expired` se agrega al `CHECK` de §10.1:
   `status IN ('pending','applied','failed','expired')`.
3. `created_at`/`expires_at` se devuelven en `/tasks/{taskId}` y `/tasks?serial=`.
4. **Reintentos:** dentro de la ventana TTL, una tarea `pending` se reintenta en cada ciclo del
   `task-runner` (60 s). Para acciones destructivas (reboot, factory_reset) se agrega
   `max_attempts` (default 3) y después de eso → `failed` con `error: 'max_attempts'`, para no
   encolar reinicios en bucle (riesgo del historial de `firmware-monitor`).
5. `POST /onts/{serial}/refresh` mantiene su semántica: al encolarlo se lee `_lastInform` del
   índice; si el equipo lleva offline > TTL, la API responde `409` con `{ taskId }` opcional
   (evitar tareas muertas).

**Impacto:** schema de `tasks` (§10.1), `task-runner.js`, respuestas de `/tasks/*`. No toca el
contrato de PATCH (sigue `202`).

---

## Resumen de impacto por fase

| Decisión | Afecta | Bloquea |
|---|---|---|
| 1. Capacidades / `not_supported` | F3 (`catalog.json`, `profile.schema.json`), F4 (bloque `capabilities`) | F3/F4 |
| 2. PK `device_id` | F5 (schema §10.1, resolver §5, routes) | F5 |
| 3. `wan.mode` por instancias | F4 (metadata de params), engine | F4 (mapeo WAN) |
| 4. Timeout/reintentos | F5 (schema `tasks`, task-runner) | F5 |

Recomendación: validar al menos la **decisión 1** antes de fijar F3; las 2, 3 y 4 se pueden
definir en paralelo sin bloquear la construcción del catálogo.
