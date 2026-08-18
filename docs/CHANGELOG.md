# Changelog

Todos los cambios importantes de este proyecto se documentan acá siguiendo [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- `docs/DISENO_ABSTRACCION_ONT.md`: diseño de la capa de abstracción ONT (`ont-gateway`) aprobado (Fase 1)
- `docs/INVENTARIO_ONT.md`: inventario de árboles TR-069 por modelo (Fase 2): 4 modelos ZNID (Zhone) + Huawei HS8145X6 + ZTE F890L (ZXIC), matriz de features, cobertura del catálogo v1 — **F2 completa**
- `docs/PROPUESTAS_DECISIONES_ONT_GATEWAY.md`: borrador de propuestas para las decisiones abiertas del diseño (capacidades por modelo, PK `device_id`, `wan.mode` por instancias, timeout de tareas) — **Decisión 1 validada**
- `mapping/catalog.json`: catálogo canónico v1 (secciones: device, wifi, wan, lan, gpon, diagnostics, actions)
- `mapping/profile.schema.json`: JSON Schema para perfiles de mapping
- `mapping/profiles/ZHONE_TR098.json`: perfil unificado ZNID con feature-detect y select por instancia WAN
- `mapping/profiles/HUAWEI_HS8145X6_TR098.json`: perfil Huawei con WAN clásico, óptico validado, WiFi 2.4G+5G
- `mapping/profiles/ZXIC_F890L_TR098.json`: perfil ZTE con WiFi 6, IPoE, sin GPON
- `tools/inventory/parse_tree.py`: parser de planillas de GenieACS (formatos legacy y CSV estándar, masking de secretos, feature-detect, comparación entre perfiles)

### Fixed
- `tools/inventory/parse_tree.py`: `device_id` poblado en los volcados `.params.json` (usaba la clave `ID` en mayúscula en lugar de `id`)

### Security
- `plantillas/` (árboles TR-069 exportados) quedó commiteada en el historial y contiene credenciales en claro (passwords PPPoE, `ConnectionRequestPassword`) y claves privadas RSA. Remediation aplicada: dejó de trackearse (`git rm --cached`) y se añadió al `.gitignore`; los archivos permanecen solo en local.
- **Pendiente (acción del equipo):** rotar las credenciales que quedaron expuestas en el historial remoto (passwords PPPoE de las ONT, `ConnectionRequestPassword` y claves RSA de los perfiles ZNID/Huawei). Las planillas no deben volver a subirse.

### Changed
- `backend/src/jobs/device-bootstrap.js`: sincronizado con producción — detecta TR-098/TR-181, respeta `_lastBootstrap` y refresca el subárbol `DeviceInfo` en lugar de todo el árbol
- `docs/INVENTARIO_ONT.md`: validación de Huawei HS8145X6 con export del 2026-08-11 — PPPoE activo (`ConnectionStatus=Connected`, `ExternalIPAddress`), óptico poblado (`RXPower/TXPower` en dBm entero, `Temperature` en °C) y VLAN vía `X_HW_VLAN` en la instancia activa
- `docs/INVENTARIO_ONT.md`: ZTE F890L (ZXIC) añadido al inventario — WiFi 6, 8 SSIDs, IPoE activo, sin GPON/diagnósticos vía TR-069, extensión vendor `X_CMCC_*`

### Operativo 2026-08-12 — genieacs-tr (CPU elevado por CWMP)
- **Hallazgo:** 214 ONUs Huawei HS8145X6 (lotes de seriales terminados en `...94` y `...93`) tenían `InternetGatewayDevice.ManagementServer.PeriodicInformInterval = 15` (el resto del parque usa 300). Informaban cada ~15 s → ~55% del tráfico CWMP y tráfico duplicado desde mediados de julio (11,8 → 24,5 informs/s). Se verificó que no había presets/provisions activos, `pending_actions` ni `firmware_rules` que lo re-aplicaran (el parámetro fue escrito en los equipos, ts 2026-08-05).
- **Remediación aplicada (operativa, vía API NBI de GenieACS):** `setParameterValues` `PeriodicInformInterval=300` a 211 ONUs (piloto de 3 + masivo). Limpieza de la cola de tareas de GenieACS (`tasks`): 7.855 tareas `refreshObject` obsoletas eliminadas (backup previo con `mongodump` en `/tmp` del servidor).
- **Resultado:** informs 24,5 → 12/s (-51%), ACS requests ~22 → 8/s (-64%), CPU de `moca-genieacs` ~150% → ~100% promedio, `moca-mongodb` 10-15% → 5-8%, load average ~3,1 → ~0,8. Cola de tareas estable en 0. ONUs corregidas confirmadas en intervalo de 300 s.
- **Pendientes:** 6 ONUs siguen con `PI=15` (4 offline, 2 con sesiones inestables que devuelven fault `cwmp.9002`); se re-envió la tarea y se corregirán cuando se reconecten. No se amplió la VM: no era necesaria.

### Sugerencias de seguimiento (operativo 2026-08-12)
1. **`backend/src/jobs/device-bootstrap.js`**: los `refreshObject` a dispositivos sin `_lastBootstrap` acumulan tareas en la cola cuando el dispositivo está offline (contribuía al backlog). Evaluar límite de reintentos o no encolar a dispositivos sin actividad reciente.
2. **`docker-compose.yml`**: los contenedores no tienen límites de recursos (`memlimit=0`, `cpushares=0`). Definir límites de memoria/CPU por servicio.
3. **Rotación de logs de `moca-genieacs`**: archivos de ~50 MB en la capa writable del contenedor (677 MB acumulados). Revisar `logrotate` o limpieza periódica.
4. **Monitoreo del host**: no hay agente (zabbix/sar) en genieacs-tr; instalar para tendencia histórica de CPU/RAM/tráfico.
5. **Sincronización de git**: el servidor (`/home/agustin/docker/moca_acs/MOCA-ACS_USP`) está 2 commits atrás del repo local; sincronizar tras este cambio.

---

## [1.5.5] - 2026-05-12

### Changed
- Renombrar API endpoint `/api/genieacs` → `/api/mocaacs`
- Renombrar archivo proxy: `genieacs-proxy.js` → `mocaacs-proxy.js`
- Actualizar documentación: `GENIEACS_API_TESTS` → `MOCAACS_API_TESTS`
- Cambiar referencias de "GenieACS Proxy" a "MOCA ACS - Proxy API"
- API ahora responde bajo marca MOCA en lugar de GenieACS

---

## [1.5.4] - 2026-05-12

### Added
- Logo MOCA en assets/logo.png
- Documentación de API en formato PDF (GENIEACS_API_TESTS.pdf)
  - Integración de logo en portada
  - Título: "MOCA Automations"
  - Subtítulo: "MOCA ACS - Proxy API (based on Genie)"
  - Ejemplos de CURL para todos los endpoints
  - Restricciones de seguridad y solución de problemas

---

## [1.5.3] - 2026-04-20

### Added
- API proxy de GenieACS expuesta en `/api/genieacs/` (solo desde IP privada, sin JWT requerido)
  - Endpoints para dispositivos: GET/POST/DELETE
  - Endpoints para tareas: GET/POST/DELETE/retry
  - Endpoints para fallos: GET/DELETE
  - Endpoints para tags: POST/DELETE
  - Endpoints para presets: GET/PUT/DELETE
  - Endpoints para archivos: GET/PUT
- Middleware de restricción a IP privada (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
- Documentación completa de API con ejemplos de CURL (GENIEACS_API_TESTS.md)
- Script de prueba automatizado para validar endpoints

### Changed
- Integración de genieacs-proxy en app.js
- docker-compose.yml: Mapeo de puerto en IP privada
  - moca-backend: exponer puerto 10.0.2.14:3000:3000 para acceso desde IP privada

---

## [1.5.2] - 2026-04-18

### Added
- UpTime del dispositivo en detalle con fecha exacta de encendido (ej: "45d 3h 22m 15s (desde 2026-04-15 14:30:00)")
- Filtro "Pendientes" en estado de dispositivos para filtrar ONTs con acciones pendientes
- Identificación visual de dispositivos con acciones pendientes (fondo amarillo en listado)
- IP de MGMT en detalle del dispositivo en lugar de IP WAN
- Soporte de rowStyle en componente Table para estilos dinámicos por fila

### Changed
- README.md: reemplazar IPs específicas por placeholders (IP_PUBLICA, IP_PRIVADA) para uso como template genérico

### Fixed
- UpTime ahora calcula correctamente la fecha exacta desde que el dispositivo está online
- Componente Table ahora soporta función rowStyle para aplicar estilos a filas
- Carga correcta de acciones pendientes con device_id (no deviceId)

---

## [1.5.1] - 2026-04-18

### Added
- Sistema mejorado de auditoría con campos action/target separados
- Logging de login/logout con timestamp correcto
- Ordenamiento DESC en auditoría con COALESCE para NULL values

### Changed
- Campo OUI ahora es opcional en carga de firmwares
- Auditoría muestra acción genérica + objetivo específico (ej: "Subio firmware" + "firmware-v1.2.3.bin")
- Permisos granulares para VIEWER: pueden ver pero no editar

### Fixed
- OUI field ya no es mandatorio en POST /upload y POST /upload-url
- Preservación de nombre original en firmwares descargados desde URL
- Error "textContent is null" cuando VIEWER accede a dispositivos
- VIEWER no podía ver ninguna acción pendiente (ahora ve todas, solo no puede aplicar)
- Botones Aplicar/Eliminar se deshabilitan para VIEWER
- Checkboxes deshabilitados para VIEWER en acciones pendientes
- Usuario root ahora oculto del listado (solo visible para root)
- Botón eliminar oculto para usuario root
- Lápiz (✏️) debajo del path removido en dispositivos
- Botón editar solo visible para admins en dispositivos
- Auditoría de login/logout con campos action/target consistentes

### Security
- Usuario root oculto del listado de usuarios (solo lo controla MOCA internamente)
- VIEWER tiene acceso de lectura completa pero sin permisos de modificación

---

## [1.5.0] - 2026-04-18

### Added
- Nueva sección FIRMWARES con gestión completa de archivos de firmware
  - Subida desde computadora (file upload)
  - Descarga desde URL remota
  - Campos requeridos: OUI, MODELO, VERSION
  - Tabla con información: tamaño, fecha, acciones
- API endpoints para firmwares (/api/firmwares, /api/firmwares/upload, /api/firmwares/upload-url)
- Tabla `firmwares` en SQLite con validación de OUI
- Auditoría completa de operaciones con firmwares
- Sección restringida solo a administradores
- Multer para manejo de file uploads

### Changed
- Logo MOCA solo en header (sin texto "MOCA ACS")
- Header ahora muestra solo logo con tooltip del título

### Fixed
- Corrección en directorio de recursos estáticos (app.js)

---

## [1.4.18] - 2026-04-17

### Added
- Scheduler automático de acciones programadas (ejecuta cada 60s)
- Documentación técnica completa (CLAUDE.md)
- Revisión de seguridad exhaustiva (SECURITY_REVIEW.md)
- Validación de timezone en DatePicker con offset -03:00
- Sistema de versionado SemVer con CHANGELOG, ROADMAP, FEATURES_REQUEST

### Changed
- DatePicker ahora devuelve ISO 8601 con offset GMT-3 (-03:00) en lugar de suma de horas
- Select-all checkbox en Acciones Pendientes solo afecta checkboxes habilitados
- Mejorado visual feedback para acciones aplicadas (opacidad reducida)

### Fixed
- Corregido bug de timezone donde fechas programadas mostraban 3 horas diferente
- Arreglado problema en select-all checkbox que intentaba seleccionar items deshabilitados
- Mejorada interpretación de fechas ISO 8601 en frontend y backend

### Security
- Identificadas 7 problemas de seguridad documentados
- 2 críticos, 3 altos, 2 medios - Plan de remediation en SECURITY_REVIEW.md
- Recomendaciones para implementar antes de producción

---

## [1.4.17] - 2026-04-14

### Added
- Filtro ONLINE/OFFLINE en página Dispositivos
- Deshabilitación de checkboxes para acciones ya APLICADO
- Reduccción de opacidad visual para acciones aplicadas
- Dashboard mejorado con gráficos de estado y fabricantes
- Perfiles de usuario (nombre, apellido, correo, teléfono)
- Endpoint PATCH para editar perfiles de usuario
- Método PATCH en cliente API

### Changed
- Standardización de timezone global (GMT-3, 24hs)
- Config.js ahora es punto central para timezone
- Todos los displays de fecha usan Config.formatDate()

### Fixed
- Error: API.patch is not a function
- Dashboard mostraba 0 dispositivos online
- Timestamps en auditoría mostraban GMT en lugar de GMT-3

---

## [1.4.16] - 2026-04-10

### Added
- Sistema de auditoría completo
- Logging de IP en auditoría y sesiones
- Última fecha de login para cada usuario

---

## [1.4.15] - 2026-04-05

### Added
- Gestión completa de acciones pendientes (CRUD)
- Estados: pending, scheduled, applied, failed
- Campos de error para acciones fallidas

---

**Última actualización:** 2026-05-12
**Versión actual:** 1.5.5
