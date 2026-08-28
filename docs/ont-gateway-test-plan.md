# Plan de Pruebas — API ont-gateway

**Fecha:** 2026-08-28 (actualizada 2026-08-26 → 2026-08-28)
**Alcance:** Validar todos los comandos de la API `ont-gateway` (lectura + escritura + acciones), ordenados de simple a complejo. Canónico vigente: `resync` (alias de `refresh` → TR-069 `RefreshObject` sobre `DeviceInfo`, no óptico), `reboot` y `factory_reset` con guardrail `confirm:true`. Incluye fix de provisión NTP diario condicional (`ar.pool.ntp.org`, `-03:00`) solo si el branch `Time` existe/writable.
**Servidor:** `genie-acs-todd` — 190.92.103.227 (VM Docker). El gateway `moca-gateway` escucha solo en `127.0.0.1:3001` dentro de la VM; NO está expuesto públicamente. NBI `moca-genieacs` en `7557`.
**ONUs de prueba autorizadas (producción) — 3 equipos:**
- `001146-F890L-ZXICCADE0F12` — ZTE F890L V9.1.0P1T1, serial `ZXICCADE0F12`, perfil `ZXIC_F890L_TR098`
- `000271-ZNID24xxA1-5a4e545303a746a0` — Zhone ZNID24xxA1, serial `5a4e545303a746a0`, perfil Zhone ZNID24xxA1
- `00259E-HS8145X6-5A4E54533AE4E493` — Huawei HS8145X6, serial `5A4E54533AE4E493`, perfil Huawei HS8145X6
**Infra prod detallada:** `moca-gateway` `127.0.0.1:3001` · `moca-genieacs` NBI `7557` · provisión `inform` NTP en DB índice `5872` (presets/provisions).
**Estado repo:** sincronizado con `origin/v1.0` commit `860f0f9` (2026-08-28) — canónico `resync`/`reboot`/`factoryReset` + guardrail y sync NTP.

---

## 0. Estado del proyecto (etapas)

| Etapa | Estado | Notas |
|-------|--------|-------|
| F5 slice 1 — scaffolding | ✅ | Docker, DB, api-key, rate-limit, catálogo |
| F5 slice 2 — resolver + motor mapping + GET lectura | ✅ | `GET /onts`, `/device`, `/wifi`, `/wan`, `/lan`, `/gpon`, `/diagnostics`, `/capabilities` |
| F5 slice 3 — PATCH/POST escrituras + jobs TTL | ✅ | `PATCH /wifi`,`/wan`,`/lan`; `POST /reboot`,`/factory-reset`,`/refresh`,`/diagnostics/ping`,`/diagnostics/traceroute`; `GET /tasks` |
| Canónico resync (alias refresh) / reboot / factoryReset + guardrail `confirm:true` | ✅ 2026-08-28 | `resync` = TR-069 `RefreshObject` sobre `DeviceInfo` (no óptico); `reboot` y `factory_reset` verificados en 3 modelos vía NBI y vía gateway. `POST /factory-reset` sin `confirm:true` → `400`, con `confirm:true` → `202` |
| Fix NTP provisión inform | ✅ 2026-08-28 | `ar.pool.ntp.org`, `-03:00`, ventana diaria condicional solo si branch `Time` existe/writable (DB índice 5872, provision `inform`) |
| **upgrade / firmware** | ❌ fuera de alcance v1 | No implementado en v1 (ver §7). Pendiente rediseño de `firmware-monitor` |
| Cobertura perfil ZXIC (password/lan/gpon) | ✅ parcial | Password WiFi ✅ (PreSharedKey.1.KeyPassphrase); GPON LOID ✅ lectura (`X_CMCC_UserInfo.UserId`); LAN IP ❌ no expuesta por el equipo (gap). Nota 2026-08-28: Huawei `00259E-HS8145X6-5A4E54533AE4E493` detrás de OLT Zhone quedó offline tras factory-reset sin `BOOTSTRAP` — requiere XML manual (comportamiento específico de OLT Zhone, no necesariamente Huawei/ZTE OLT) |

**Lectura:** ya probada (comandos de consulta OK) — incluye `GET` vía gateway y vía NBI 2026-08-28.
**Escritura:** probada parcialmente vía gateway y vía NBI el 2026-08-28 para Nivel 4 (resync/reboot) y Nivel 5 (factory-reset acceptance). La prueba de SSID con caracteres especiales (`docs/tr069-ssid-tests.md`) se hizo directo contra el NBI de GenieACS, no vía `ont-gateway`. PATCH WiFi/LAN/WAN/GPON vía gateway sigue pendiente de prueba end-to-end.

### 0.1 Decisiones canónicas 2026-08-28

| Comando / concepto | Canónico vigente | Desestimado / no canónico | Motivo / evidencia 2026-08-28 |
|--------------------|------------------|---------------------------|-------------------------------|
| Refresh de datos del CPE | `resync` (alias `refresh`) → `POST /onts/{serial}/resync` → TR-069 `RefreshObject` con `objectName: DeviceInfo` | `objectName: InternetGatewayDevice` (falla 9002 en Huawei, corregido a `DeviceInfo`); refresh óptico/GPON | `DeviceInfo` es el objeto liviano y soportado en los 3 modelos; `InternetGatewayDevice` raíz provocó `faultCode 9002` en Huawei `6a918f8b` |
| Reinicio remoto | `POST /onts/{serial}/reboot` → TR-069 `Reboot` | — | Verificado en 3 ONUs 2026-08-28 (tasks `6a918f33`, `6a918f37`, `6a918f93`) |
| Reset a fábrica | `POST /onts/{serial}/factory-reset` con body `{"confirm": true}` → TR-069 `FactoryReset` | `POST` sin `confirm` (→ `400`), `disable`/`delete` de ONU | Guardrail `confirm:true` verificado (sin → `400`, con → `202 taskId 9`); `disable`/`delete` son operaciones OLT-only vía telnet/SSH, fuera del dominio TR-069/ACS |
| Provisión NTP | Provision `inform` diaria condicional `ar.pool.ntp.org` / `-03:00` solo si branch `Time` existe y es writable | NTP incondicional o en cada inform | Evita `faults` en equipos sin branch `Time`; índice DB `5872` |
| Operaciones OLT | Fuera de alcance gateway | `disable`/`delete` ONU desde gateway | Requieren acceso OLT por telnet/SSH, no por CWMP |

---

## 1. Convenciones de ejecución

- **Base URL (desde la VM):** `http://localhost:3001/api/v1`
- **Auth:** header `X-API-Key: <key>` (hash SHA256 en `api_keys`; el raw vive en `.env` como `GATEWAY_SEED_API_KEY`).
- **Modelo de tareas asíncronas:** toda escritura/acción devuelve `202 { taskId }`. El `task-runner` la procesa cada **60 s** y crea la tarea en GenieACS NBI; el equipo la aplica en su próxima sesión CWMP (inform cada 300 s o por ConnectionRequest). Verificar con `GET /tasks/{id}` hasta `status=applied`.
- **TTL:** `?ttl=SEGUNDOS` (default 86400, máx 604800). `POST /refresh` / `POST /resync` rechaza (`409`) si `last_inform` supera el TTL (equipo offline).
- **Rollback:** en escrituras de parámetros, reenviar `PATCH` con el valor original. En acciones (reboot/factory-reset) no hay rollback automático.
- **Alias canónico:** `POST /resync` es el nombre canónico; `POST /refresh` se mantiene como alias por compatibilidad. Ambos crean tarea `refreshObject` sobre `DeviceInfo`.

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

**Estado 2026-08-28:** Nivel 1 vía gateway `PATCH` **no probado end-to-end**. Solo probado vía NBI directo (`docs/tr069-ssid-tests.md`). Pendiente para revisión con cliente (ver §7.1).

---

## 4. Nivel 2 — Credenciales (password)

✅ **ZXIC soporta password WiFi** (validado por probe el 2026-08-26). El perfil `ZXIC_F890L_TR098` ahora declara `wifi.radio.2g.password` / `wifi.radio.5g.password` con la ruta TR-069 correcta `InternetGatewayDevice.LANDevice.1.WLANConfiguration.{i}.PreSharedKey.1.KeyPassphrase` (NO la plana `KeyPassphrase` de HUAWEI/ZHONE). `wan.pppoe.password` sigue sin declararse en ZXIC (el equipo no lo expone legible; confirmar si se quiere agregar).

> **Caveat de aplicación:** el ACS no puede iniciar `ConnectionRequest` al IP privado del CPE, así que el `SetParameterValues` se entrega en el próximo inform periódico (≤300 s), no al instante. `GET /onts/{serial}/wifi` puede mostrar el valor transitorio antes del inform.

| # | Método + endpoint | Body | Verificación | Rollback |
|---|-------------------|------|--------------|----------|
| 2.1 | `PATCH /onts/{serial}/wifi` | `{"wifi.radio.2g.password":"********"}` | `GET /tasks/{id}`→`applied`; esperar ≤300 s al inform. El password es `wo` en catálogo → **no se lee de vuelta**; verificar conectando un cliente WiFi | reenviar password original |
| 2.2 | `PATCH /onts/{serial}/wan` | `{"wan.pppoe.password":"********"}` | igual que 2.1 (solo en modelos con `wan.pppoe.password` en perfil) | reenviar original |

**Estado 2026-08-28:** no probado vía gateway (pendiente, ver §7.1).

---

## 5. Nivel 3 — Configuración de red (LAN / WAN / GPON)

**ZXIC (actualizado 2026-08-26):** el perfil ahora expone `gpon.loid` (**read-only**) mapeado a `InternetGatewayDevice.X_CMCC_UserInfo.UserId` (LOID de registración GPON china-mobile). `GET /onts/{serial}/gpon` devuelve `loid` soportado. No escribir el LOID (des-registraría la ONU).
⚠️ **Gap LAN IP:** el equipo NO expone IP de LAN por TR-069 (el único IPv4 del árbol es WAN `ExternalIPAddress`, ya mapeado como `wan.ip`). `PATCH /lan` devuelve `422` (sin `lan.*` en el perfil) y no hay path descubrible para LAN IP. `lan.ip` queda no soportado.

| # | Método + endpoint | Body | Verificación | Rollback |
|---|-------------------|------|--------------|----------|
| 3.1 | `PATCH /onts/{serial}/wan` | `{"wan.pppoe.username":"<user>"}` | `GET /tasks/{id}`→`applied`; `GET /onts/{serial}/wan`→`value` | reenviar original |
| 3.2 | `GET /onts/{serial}/lan` | — | `422` — LAN IP no expuesta por el equipo (gap, no mapeable) | n/a |
| 3.3 | `GET /onts/{serial}/gpon` | — | `data.gpon.loid.value` = LOID (`X_CMCC_UserInfo.UserId`). Solo lectura | n/a |

**Sobre "descripciones":** no existe un parámetro de descripción/friendly-name en el catálogo actual. Si te referís a un campo de nombre del equipo, hay que agregarlo al catálogo + perfil. Confirmar qué campo exacto querés modificar.

**Estado 2026-08-28:** `GET /gpon` y `GET /lan` probados vía lectura (gap LAN confirmado). `PATCH` de red no probado vía gateway.

---

## 6. Nivel 4 — Acciones no destructivas

| # | Método + endpoint | Body | Verificación | Riesgo | Resultado 2026-08-28 |
|---|-------------------|------|--------------|--------|----------------------|
| 4.1 | `POST /onts/{serial}/resync` (canónico) / `POST /onts/{serial}/refresh` (alias) | — | `GET /tasks/{id}`→`applied`; `last_inform` se actualiza | bajo | ✅ **Probado en 3 modelos** vía NBI y vía gateway. Tasks: ZTE `6a918f09`, Zhone `6a918f0e`, Huawei `6a918f8b`. Todas resolvieron a `tasks: []` en 2–4 s, `faults: []`, `lastInform` avanzó. Huawei falló inicialmente con `objectName: InternetGatewayDevice` → `fault 9002`, corregido a `DeviceInfo` y re-ejecutado OK. |
| 4.2 | `POST /onts/{serial}/reboot` | — | `GET /tasks/{id}`→`applied`; equipo cae y vuelve online (ver `last_inform` post-reboot) | medio (breve corte de servicio del equipo) | ✅ **Probado en 3 modelos** vía NBI y vía gateway. Tasks: Zhone `6a918f33` (`tasks: []` en ~3 s), ZTE `6a918f37`, Huawei `6a918f93`. Todas `tasks: []`, `faults: []`, `lastInform` avanzó tras reboot. |

> `reboot`/`factory-reset` usan `max_attempts=3` en el task-runner para no encolar en bucle. `resync`/`refresh` usa `RefreshObject` sobre `DeviceInfo` (no óptico).

---

## 7. Nivel 5 — Destructivas / complejas

| # | Método + endpoint | Body | Verificación | Riesgo | Resultado 2026-08-28 |
|---|-------------------|------|--------------|--------|----------------------|
| 5.1 | `POST /onts/{serial}/factory-reset` | `{"confirm": true}` (guardrail obligatorio) | Equipo vuelve a config de fábrica; verificar `GET /tasks/{id}`→`applied` y `lastInform`/eventos | **ALTO** — solo ONUs de prueba, con confirmación explícita previa | ✅ **Acceptance en 3 ONUs** vía NBI y vía gateway. Tasks acceptance: ZTE `2026-08-28 13:58:31Z` `tasks: []`, Zhone `13:59:23Z`, Huawei `13:59:29Z` — todas `faults: []`. **Post-reset:** ZTE y Zhone reprovisionaron `BOOTSTRAP` `2026-08-28 14:01Z` y `lastInform` `14:26Z` (reprovision OMCI OK). ⚠️ Huawei `00259E-HS8145X6-5A4E54533AE4E493` (detrás de OLT Zhone) quedó `offline` desde `13:59Z` sin evento `BOOTSTRAP` — requiere XML manual de la OLT Zhone para reprovisionar (comportamiento específico de OLT Zhone, no necesariamente de OLT Huawei/ZTE). Guardrail verificado: `POST` sin `confirm` → `400`, con `{"confirm":true}` → `202 { taskId: 9 }` (limpiado). |
| 5.2 | `upgrade` (firmware) | — | **NO IMPLEMENTADO** en rutas `ont-gateway` (v1). El diseño (`DISENO_ABSTRACCION_ONT.md` §) lo deja pendiente de rediseño de `firmware-monitor`. La gestión de archivos de firmware existe en el backend v1.5, pero no hay endpoint de upgrade por `serial` en el gateway | fuera de alcance v1 | ❌ No probado — fuera de alcance v1 (sin endpoint). |

---

## 7.1 Estado 2026-08-28 — Resumen de pruebas ejecutadas vs pendientes (revisión con cliente)

| Prueba | Vía | Fecha | Resultado | Evidencia | Pendiente |
|--------|-----|-------|-----------|-----------|-----------|
| `refresh` / `resync` (RefreshObject DeviceInfo) | NBI + gateway | 2026-08-28 | ✅ OK en 3 modelos | Tasks `6a918f09` (ZTE), `6a918f0e` (Zhone), `6a918f8b` (Huawei) → `tasks: []` en 2–4 s, `faults: []`, `lastInform` avanzó. Huawei con `InternetGatewayDevice` → `9002`, corregido a `DeviceInfo` | Ninguno — cerrar como probado |
| `reboot` | NBI + gateway | 2026-08-28 | ✅ OK en 3 modelos | Tasks `6a918f33` (Zhone, 3 s), `6a918f37` (ZTE), `6a918f93` (Huawei) → `tasks: []`, `faults: []` | Ninguno — cerrar como probado |
| `factory-reset` (acceptance) | NBI + gateway | 2026-08-28 | ✅ Acceptance en 3 modelos | ZTE `13:58:31Z`, Zhone `13:59:23Z`, Huawei `13:59:29Z` → `tasks: []`, `faults: []` | Reprovision Huawei con cliente (XML manual OLT Zhone) |
| `factory-reset` (reprovision post-reset) | NBI (eventos ACS) | 2026-08-28 | ✅ ZTE y Zhone OK · ⚠️ Huawei offline | ZTE y Zhone: `BOOTSTRAP` `14:01Z`, `lastInform` `14:26Z` (OMCI OK). Huawei `00259E-HS8145X6-5A4E54533AE4E493` sin `BOOTSTRAP` desde `13:59Z` | Coordinar con cliente reprovision Huawei detrás de OLT Zhone (cargar XML en OLT); no extrapolar a OLT Huawei/ZTE |
| Guardrail `factory-reset` `confirm:true` | gateway | 2026-08-28 | ✅ Verificado | `POST` sin `confirm` → `400`; con `{"confirm":true}` → `202 { taskId: 9 }` (limpiado) | Ninguno |
| Provisión NTP `ar.pool.ntp.org` / `-03:00` | DB provision `inform` | 2026-08-28 | ✅ En DB índice `5872`, condicional daily | Solo si branch `Time` existe/writable; evita faults en equipos sin `Time` | Verificar en próximo `inform` diario que el CPE aplique NTP (lectura `Time` post-inform) |
| Lectura `GET` (`/onts`, `/device`, `/wifi`, `/wan`, `/lan`, `/gpon`, `/capabilities`) | gateway | 2026-08-28 y previo | ✅ OK | Snapshot y `lastInform` verificados en 3 ONUs | Ninguno |
| `PATCH /wifi` SSID (`wifi.radio.2g.ssid` / `5g`) | gateway | — | ⏳ No probado end-to-end vía gateway | Solo probado vía NBI directo (`docs/tr069-ssid-tests.md`, caracteres `! &` OK, `< >` → `9003`) | **Pendiente cliente:** probar `PATCH` SSID vía gateway en ventana (incluye `1.1`, `1.2`, `1.3`) y validar `GET /wifi` post-`applied` |
| `PATCH /wifi` password (`PreSharedKey.1.KeyPassphrase`) | gateway | — | ⏳ No probado vía gateway | Perfil ZXIC actualizado 2026-08-26, `wo` (no legible de vuelta) | **Pendiente cliente:** probar `PATCH` password vía gateway y validar con cliente WiFi |
| GPON LOID (`X_CMCC_UserInfo.UserId`) | gateway `GET` | 2026-08-26 | ✅ Lectura OK (ro) | `GET /gpon` → `loid` mapeado | No escribir LOID (des-registra ONU) — sin pendiente |
| LAN IP (`lan.ip`) | gateway | 2026-08-26 | ❌ Gap — no expuesta por ZTE | `GET /lan` → `422`, sin path TR-069 descubrible | Sin pendiente salvo que se agregue campo alternativo al catálogo |
| `POST /diagnostics/ping` y `/traceroute` | gateway | — | ⏳ No probado | — | **Pendiente cliente:** probar ping/traceroute vía gateway en ventana |
| `upgrade` / firmware | — | — | ❌ Fuera de alcance v1 | Sin endpoint por `serial` en gateway | Abrir feature aparte si se requiere |

---

## 8. Matriz de ejecución por modelo (ventana de mantenimiento)

| Prueba / Nivel | ZXIC F890L `001146-F890L-ZXICCADE0F12` | HUAWEI HS8145X6 `00259E-HS8145X6-5A4E54533AE4E493` | ZHONE ZNID24xxA1 `000271-ZNID24xxA1-5a4e545303a746a0` | Notas |
|-------|-----------|-----------------|------------|-------|
| 1 WiFi SSID (`PATCH`) | ⏳ perfil OK, no probado vía gateway | ⏳ perfil OK, no probado vía gateway | ⏳ perfil OK, no probado vía gateway | Solo NBI directo probado (`tr069-ssid-tests.md`) |
| 2 Password WiFi (`PreSharedKey.1.KeyPassphrase`) | ⏳ perfil OK, no probado vía gateway | ⏳ perfil OK, no probado vía gateway | ⏳ perfil OK, no probado vía gateway | `wo` — no se lee de vuelta |
| 3 LAN/WAN/GPON | ✅ GPON LOID (ro vía `X_CMCC`) · ❌ LAN IP (no expuesta) | ✅ GPON vía `X_Gpon` (perfil) | ✅ GPON (perfil) | ZTE: LOID lectura OK, LAN gap confirmado |
| 4a Resync / Refresh (`DeviceInfo`) | ✅ `6a918f09` · 2–4 s · `faults []` | ✅ `6a918f8b` · `DeviceInfo` (corregido de `9002`) | ✅ `6a918f0e` · 2–4 s | Probado 2026-08-28 vía NBI+gateway |
| 4b Reboot | ✅ `6a918f37` | ✅ `6a918f93` | ✅ `6a918f33` (3 s) | Probado 2026-08-28 |
| 5a Factory-reset (acceptance) | ✅ `13:58:31Z` `tasks []` | ✅ `13:59:29Z` `tasks []` | ✅ `13:59:23Z` `tasks []` | Guardrail `confirm:true` verificado |
| 5a Factory-reset (reprovision) | ✅ `BOOTSTRAP 14:01Z` · `lastInform 14:26Z` | ⚠️ offline `13:59Z` sin `BOOTSTRAP` — requiere XML manual OLT Zhone | ✅ `BOOTSTRAP 14:01Z` · `lastInform 14:26Z` | Huawei detrás de OLT Zhone: caso específico OLT Zhone |
| 5b Upgrade / firmware | ❌ fuera de alcance v1 | ❌ fuera de alcance v1 | ❌ fuera de alcance v1 | Sin endpoint gateway |
| Diagnostics ping/traceroute | ⏳ no probado | ⏳ no probado | ⏳ no probado | Pendiente vía gateway |
| NTP provision (`ar.pool.ntp.org`) | ✅ DB `5872` condicional | ✅ DB `5872` condicional | ✅ DB `5872` condicional | Verificar en próximo inform diario |

**Pendientes para cubrir ZXIC completo:** `lan.ip` NO es mapeable (el equipo no expone IP de LAN por TR-069 — gap real). `gpon.loid` ya soportado (ro, `X_CMCC_UserInfo.UserId`). Password WiFi ya agregado el 2026-08-26. Nivel 3 en ZXIC: GPON LOID ✅ lectura, LAN IP ❌. Resync/Reboot/Factory acceptance ✅ 2026-08-28 en los 3 modelos; reprovision Huawei ⚠️ pendiente de XML manual por OLT Zhone.

---

## 9. Orden de ejecución recomendado (cuando haya ventana)

1. Nivel 0 (sanity) — todos los modelos. ✅ Verificado 2026-08-28 (lectura OK en 3 ONUs).
2. Nivel 1 (SSID) — ZXIC primero (ONU dedicada), luego HUAWEI/ZHONE. ⏳ **Pendiente cliente:** `PATCH /wifi` SSID vía gateway (incluye `1.3` caracteres especiales).
3. Nivel 2 (password) ya habilitado en ZXIC; Nivel 3 (lan/gpon) — GPON LOID ✅ lectura, LAN IP ❌ gap. ⏳ **Pendiente cliente:** `PATCH` password vía gateway (validar con cliente WiFi).
4. Nivel 4 (refresh/resync + reboot) — todos los modelos. ✅ **Completado 2026-08-28** (resync `6a918f09`/`6a918f0e`/`6a918f8b`, reboot `6a918f33`/`6a918f37`/`6a918f93`).
5. Nivel 5 factory-reset — SOLO ONUs de prueba, con confirmación. ✅ **Parcial 2026-08-28:** acceptance OK en 3 (`13:58:31Z` ZTE, `13:59:23Z` Zhone, `13:59:29Z` Huawei) + reprovision ZTE/Zhone `BOOTSTRAP 14:01Z`; Huawei `00259E-HS8145X6-5A4E54533AE4E493` ⚠️ pendiente reprovision XML manual (OLT Zhone).
6. Upgrade — fuera de v1; abrir feature aparte. ❌ Sin cambios.
7. **Pendientes para cierre con cliente:**
   - WiFi SSID y password vía gateway (`PATCH /wifi`) en ventana de mantenimiento.
   - GPON/WAN `PATCH` si aplica (LOID solo lectura).
   - `POST /diagnostics/ping` y `/traceroute` vía gateway.
   - Reprovision Huawei detrás de OLT Zhone (XML manual) — coordinar con cliente; no bloquea validación en OLT Huawei/ZTE.
   - Verificación NTP (`ar.pool.ntp.org`, `-03:00`) en próximo `inform` diario (branch `Time`).

