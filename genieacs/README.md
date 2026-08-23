# GenieACS Provisions

Provisions y presets de GenieACS para MOCA ACS (piloto Cooperativa TODD).

## Estructura

```
genieacs/
├── provisions/
│   ├── default.js     # Refresh periódico de parámetros (canal: default)
│   ├── bootstrap.js   # Limpieza de caché al primer informe (canal: bootstrap)
│   └── inform.js      # Configuración de periodic inform (canal: inform)
├── presets.json        # Mapeo presets → provisions (canales y eventos)
└── README.md           # Este archivo
```

## Canales de ejecución

| Canal | Trigger | Provision |
|-------|---------|-----------|
| `default` | Cada sesión CWMP después del informe | `default.js` |
| `bootstrap` | Primer informe del dispositivo (evento `0 BOOTSTRAP`) | `bootstrap.js` |
| `inform` | Cada informe periódico | `inform.js` |

## Provisions

### default.js — Refresh periódico

Ejecuta `declare()` para forzar la re-lectura de parámetros cada hora.

**FIX 2026-07-24 (CPU storm):** El timestamp original usaba `Date.now(3600000)` que ignora el argumento → `pathTimestamp` crecía en cada sesión → `GetParameterNames` completo (~190 GPN/dispositivo). Fix: `Date.now() - (Date.now() % 3600000)` redondea al inicio de la hora.

### bootstrap.js — Limpieza de caché

Ejecuta `clear()` para forzar re-lectura completa del árbol TR-069 al primer informe. No provoca el storm de GPN (el problema era `declare` con `path` sin redondear).

### inform.js — Configuración de inform

Configura `ConnectionRequestUsername/Password`, `PeriodicInformEnable/Interval/Time`.

**FIX 2026-08-21:** `Date.now(86400000)` ignora el argumento → el provision se re-aplicaba en cada sesión. Fix: `Date.now() - (Date.now() % 86400000)` redondea al inicio del día.

**FIX 2026-08-21 (informTime):** `daily % 86400000` daba `0` para todos tras el redondeo → todos los CPEs con `PeriodicInformTime=0` (pico de ~3886 informs alineados). Fix: `simpleHash(DeviceID.ID) % 86400` distribuye el offset uniformemente en el día, de forma determinística por dispositivo.

## Aplicación

### Via NBI API (recomendado)

```bash
# Listar provisions
curl -s http://localhost:7557/provisions | jq .

# Actualizar un provision
curl -s -X PUT http://localhost:7557/provisions/default \
  -H 'Content-Type: application/javascript' \
  --data-binary @genieacs/provisions/default.js
```

### Via MongoDB (directo)

```bash
docker exec moca-mongodb mongo --quiet genieacs --eval '
db.provisions.updateOne(
  {_id: "default"},
  {$set: {script: <contenido del .js>}}
)'
```

## Historial de incidentes

| Fecha | Problema | Fix | Prov |
|-------|----------|-----|------|
| 2026-07-24 | CPU storm por `Date.now()` sin redondear en `declare()` | Redondear timestamp al intervalo (hora) | `default` |
| 2026-08-21 | `Date.now(86400000)` ignora argumento, se re-aplica cada sesión | Redondear timestamp al día | `inform` |
| 2026-07-09 | Tasks atascados por `INSERT OR IGNORE` en device-bootstrap | `INSERT OR REPLACE` | (código, no provision) |
| 2026-08-12 | PI=15s en 785 ONTs → 55% tráfico CWMP | `setParameterValues` PI=300 | (operacional) |
