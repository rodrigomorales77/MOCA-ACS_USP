# Plan de Pruebas — API ont-gateway

**Fecha:** 2026-08-26
**Alcance:** Validar todos los comandos de la API `ont-gateway` (lectura + escritura + acciones), ordenados de simple a complejo.
**Servidor:** `genie-acs-todd` — 190.92.103.227 (VM Docker). El gateway `moca-gateway` escucha solo en `127.0.0.1:3001` dentro de la VM; NO está expuesto públicamente.
**ONU de prueba autorizada (producción):** `001146-F890L-ZXICCADE0F12` (ZTE F890L V9.1.0P1T1, serial `ZXICCADE0F12`, perfil `ZXIC_F890L_TR098`).

---

## 0. Estado del proyecto (etapas)

| Etapa | Estado | Notas |
|-------|--------|-------|
| F5 slice 1 — scaffolding | ✅ | Docker, DB, api-key, rate-limit, catálogo |
| F5 slice 2 — resolver + motor mapping + GET lectura | ✅ | `GET /onts`, `/device`, `/wifi`, `/wan`, `/lan`, `/gpon`, `/diagnostics`, `/capabilities` |
| F5 slice 3 — PATCH/POST escrituras + jobs TTL | ✅ | `PATCH /wifi`,`/wan`,`/lan`; `POST /reboot`,`/factory-reset`,`/refresh`,`/diagnostics/ping`,`/diagnostics/traceroute`; `GET /tasks` |
| **upgrade / firmware** | ❌ | No implementado en v1 (ver §7). Pendiente rediseño de `firmware-monitor` |
| Cobertura perfil ZXIC (password/lan/gpon) | ⚠️ | Password WiFi ✅ soportado (PreSharedKey.1.KeyPassphrase); `lan.*`/`gpon.*` pendientes de probe/extensión (ver §5/§6) |

**Lectura:** ya probada (comandos de consulta OK).
**Escritura:** NO probada de extremo a extremo vía gateway hasta este plan. La prueba de SSID con caracteres especiales (`docs/tr069-ssid-tests.md`) se hizo directo contra el NBI de GenieACS, no vía `ont-gateway`.

---

## 1. Convenciones de ejecución

- **Base URL (desde la VM):** `http://localhost:3001/api/v1`
- **Auth:** header `X-API-Key: <key>` (hash SHA256 en `api_keys`; el raw vive en `.env` como `GATEWAY_SEED_API_KEY`).
- **Modelo de tareas asíncronas:** toda escritura/acción devuelve `202 { taskId }`. El `task-runner` la procesa cada **60 s** y crea la tarea en GenieACS NBI; el equipo la aplica en su próxima sesión CWMP (inform cada 300 s o por ConnectionRequest). Verificar con `GET /tasks/{id}` hasta `status=applied`.
- **TTL:** `?ttl=SEGUNDOS` (default 86400, máx 604800). `POST /refresh` rechaza (`409`) si `last_inform` supera el TTL (equipo offline).
- **Rollback:** en escrituras de parámetros, reenviar `PATCH` con el valor original. En acciones (reboot/factory-reset) no hay rollback automático.

---

## 2. Nivel 0 — Sanity (sólo lectura, sin riesgo)

| # | Comando | Verificación esperada |
|---|---------|----------------------|
| 0.1 | `GET /health` | `{"status":"ok"}` |
| 0.2 | `GET /onts?query=ZXICCADE0F12` | 1 dispositivo, `profile=ZXIC_F890L_TR098`, `last_inform` reciente |
| 0.3 | `GET /onts/ZXICCADE0F12/capabilities` | capabilities del perfil |
| 0.4 | `GET /onts/ZXICCADE0F12` (todo) | snapshot completo vía NBI |
| 0.5 | `GET /onts/ZXICCADE0F12/wifi` | `data.wifi.radio.2g.ssid.value` = `86a6he` (baseline) |

---

## 3. Nivel 1 — Escrituras simples y reversibles (WiFi SSID)

Mapeables en ZXIC ✅. Riesgo: baja (reversible, no desconecta).

| # | Método + endpoint | Body | Verificación | Rollback |
|---|-------------------|------|--------------|----------|
| 1.1 | `PATCH /onts/ZXICCADE0F12/wifi` | `{"wifi.radio.2g.ssid":"86a6he-GW"}` | `GET /tasks/{id}`→`applied`; `GET /onts/ZXICCADE0F12/wifi`→`value=="86a6he-GW"` | `PATCH` con `"86a6he"` |
| 1.2 | `PATCH /onts/ZXICCADE0F12/wifi` | `{"wifi.radio.5g.ssid":"86a6he-5G-GW"}` | igual que 1.1 | `PATCH` con `"86a6he-5G"` |
| 1.3 | `PATCH /onts/ZXICCADE0F12/wifi` | `{"wifi.radio.2g.ssid":"Test! & Prueba"}` | Confirmar que `!` y `&` se persisten (ver `tr069-ssid-tests.md`); `<`,`>` deben dar `9003` del firmware, no romper sesión | revertir a `86a6he` |

> Nota: el endpoint valida el prefijo `wifi.radio.2g`/`wifi.radio.5g`. Un campo fuera de catálogo devuelve `400`; un campo `ro` devuelve `422`.

---

## 4. Nivel 2 — Credenciales (password)

✅ **ZXIC soporta password WiFi** (validado por probe el 2026-08-26). El perfil `ZXIC_F890L_TR098` ahora declara `wifi.radio.2g.password` / `wifi.radio.5g.password` con la ruta TR-069 correcta `InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}.PreSharedKey.1.KeyPassphrase` (NO la plana `KeyPassphrase` de HUAWEI/ZHONE). `wan.pppoe.password` sigue sin declararse en ZXIC (el equipo no lo expone legible; confirmar si se quiere agregar).

> **Caveat de aplicación:** el ACS no puede iniciar `ConnectionRequest` al IP privado del CPE, así que el `SetParameterValues` se entrega en el próximo inform periódico (≤300 s), no al instante. `GET /onts/{serial}/wifi` puede mostrar el valor transitorio antes del inform.

| # | Método + endpoint | Body | Verificación | Rollback |
|---|-------------------|------|--------------|----------|
| 2.1 | `PATCH /onts/{serial}/wifi` | `{"wifi.radio.2g.password":"********"}` | `GET /tasks/{id}`→`applied`; esperar ≤300 s al inform. El password es `wo` en catálogo → **no se lee de vuelta**; verificar conectando un cliente WiFi | reenviar password original |
| 2.2 | `PATCH /onts/{serial}/wan` | `{"wan.pppoe.password":"********"}` | igual que 2.1 (solo en modelos con `wan.pppoe.password` en perfil) | reenviar original

---

## 5. Nivel 3 — Configuración de red (LAN / WAN / GPON)

⚠️ **Gap ZXIC:** el perfil no declara `lan.*` ni `gpon.*`. `PATCH /lan` y `PATCH /gpon` devolverán `422` en ZXIC hasta extender el perfil.

| # | Método + endpoint | Body | Verificación | Rollback |
|---|-------------------|------|--------------|----------|
| 3.1 | `PATCH /onts/{serial}/wan` | `{"wan.pppoe.username":"<user>"}` | `GET /tasks/{id}`→`applied`; `GET /onts/{serial}/wan`→`value` | reenviar original |
| 3.2 | `PATCH /onts/{serial}/lan` | `{"lan.ip":"192.168.1.1"}` | `GET /onts/{serial}/lan`→`value` | reenviar original |
| 3.3 | `PATCH /onts/{serial}/gpon` | `{"gpon.loid":"<loid>"}` | `GET /onts/{serial}/gpon`→`value` | reenviar original |

**Sobre "descripciones":** no existe un parámetro de descripción/friendly-name en el catálogo actual. Si te referís a un campo de nombre del equipo, hay que agregarlo al catálogo + perfil. Confirmar qué campo exacto querés modificar.

---

## 6. Nivel 4 — Acciones no destructivas

| # | Método + endpoint | Body | Verificación | Riesgo |
|---|-------------------|------|--------------|--------|
| 4.1 | `POST /onts/ZXICCADE0F12/refresh` | — | `GET /tasks/{id}`→`applied`; `last_inform` se actualiza | bajo |
| 4.2 | `POST /onts/ZXICCADE0F12/reboot` | — | `GET /tasks/{id}`→`applied`; equipo cae y vuelve online (ver `last_inform` post-reboot) | medio (breve corte de servicio del equipo) |

> `reboot`/`factory-reset` usan `max_attempts=3` en el task-runner para no encolar en bucle.

---

## 7. Nivel 5 — Destructivas / complejas

| # | Método + endpoint | Body | Verificación | Riesgo |
|---|-------------------|------|--------------|--------|
| 5.1 | `POST /onts/ZXICCADE0F12/factory-reset` | — | Equipo vuelve a config de fábrica | **ALTO** — solo ONU de prueba, con confirmación explícita previa |
| 5.2 | `upgrade` (firmware) | — | **NO IMPLEMENTADO** en rutas `ont-gateway` (v1). El diseño (`DISENO_ABSTRACCION_ONT.md` §) lo deja pendiente de rediseño de `firmware-monitor`. La gestión de archivos de firmware existe en el backend v1.5, pero no hay endpoint de upgrade por `serial` en el gateway | fuera de alcance v1 |

---

## 8. Matriz de ejecución por modelo (ventana de mantenimiento)

| Nivel | ZXIC F890L | HUAWEI HS8145X6 | ZHONE ZNID |
|-------|-----------|-----------------|------------|
| 1 WiFi SSID | ✅ (perfil OK) | ✅ | ✅ |
| 2 Password | ✅ (PreSharedKey.1.KeyPassphrase) | ✅ | ✅ |
| 3 LAN/WAN/GPON | ⚠️ falta perfil (lan/gpon) | ✅ (gpon vía X_Gpon) | ✅ |
| 4 Reboot/Refresh | ✅ | ✅ | ✅ |
| 5 Factory/Upgrade | Factory ✅ / Upgrade ❌ | igual | igual |

**Pendientes para cubrir ZXIC completo:** extender `mapping/profiles/ZXIC_F890L_TR098.json` con `lan.ip` (y demás LAN), `gpon.*` según export real del equipo (password WiFi ya agregado el 2026-08-26). Esto bloquea Nivel 3 en la ONU de prueba.

---

## 9. Orden de ejecución recomendado (cuando haya ventana)

1. Nivel 0 (sanity) — todos los modelos.
2. Nivel 1 (SSID) — ZXIC primero (ONU dedicada), luego HUAWEI/ZHONE.
3. Nivel 2 (password) ya habilitado en ZXIC; Nivel 3 (lan/gpon) pendiente de probe/extensión de perfil.
4. Nivel 4 (refresh + reboot) — todos los modelos.
5. Nivel 5 factory-reset — SOLO ZXIC (ONU de prueba), con confirmación.
6. Upgrade — fuera de v1; abrir feature aparte.
