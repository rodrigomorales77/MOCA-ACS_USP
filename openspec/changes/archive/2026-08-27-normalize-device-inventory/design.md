# Design: Normalize Device Inventory

## Context

Fleet of 4308 TR-069 devices stored in GenieACS/Mongo with raw strings (`InternetGatewayDevice.DeviceInfo.Manufacturer/ModelName` + `_deviceId._Manufacturer/_ProductClass`). Dashboard (`GET /api/devices/stats/summary`, 60s cache) and listing (`GET /api/devices` with snapshot cache) count raw strings directly via Sets, producing 18 models / 4 manufacturers. Client's commercial reality is 3 manufacturers (Zhone, Huawei, ZTE) and 8 models (5 Zhone buckets + 2 Huawei + 1 ZTE). Change is presentation-only (no DB mutation).

Constraints: Node 20 + Express 4 (CommonJS), no test runner (`strict_tdd: false`), Docker Compose `moca-net`, `better-sqlite3` for pending_actions only.

## Architecture Decision

**Chosen:** In-memory normalization layer at API response boundary — new pure module `backend/src/lib/device-normalizer.js` with deterministic mapping tables, consumed by both `stats/summary` and device listing/filter code paths.

**Alternatives considered:**
- DB migration / GenieACS preset to rewrite stored values — rejected: risky, requires re-provisioning, couples presentation to TR-069 data model.
- Frontend-only mapping — rejected: filters and counts diverge between backend and frontend.
- Regex table in each route — rejected: duplication, no single source of truth.

**Why this wins:** Single source of truth, pure functions testable without NBI/Mongo, zero migration, `STATS_CACHE_TTL` hides cost.

## Module Design

**Location:** `backend/src/lib/device-normalizer.js` (follows existing `lib/device-filters.js`, `lib/mgmt-ip.js` convention).

**Exports:**
```js
const MANUFACTURER_MAP = Map(lowerRaw -> canonical) // keys lowercased, trimmed
function normalizeManufacturer(raw) -> string // -> Zhone|Huawei|ZTE|Otro
const MODEL_RULES = [{ test: RegExp, to: string, manufacturer?: string }] // ordered specific->generic
function normalizeModel(raw, normalizedManufacturer) -> string // -> canonical model or Otro
function normalizeDevice(device) -> { manufacturer, model } // convenience: extracts raw then normalizes
```

**Manufacturer Map (lowercased keys):**
`zhone->Zhone`, `huawei technologies co., ltd->Huawei`, `hwtc->Huawei`, `zxic->ZTE`, `desconocido->Otro`, `""->Otro`, fallback `Otro`.

**Model Rules (ordered):**
1. `^ZNID-GPON-2424$` -> `2424` (exact)
2. `^ZNID-GPON-2424A$` -> `2424A`
3. `^ZNID-GPON-2424A1(-.*)?$` -> `2424A1` (covers `-00`)
4. `^ZNID-GPON-2426A(-00|-NA)?$` anchored -> `2426A` (or two rules, ordered longest first)
5. `^ZNID-GPON-2426A1(-00|-NA|-00-NA)?$` -> `2426A1`
6. Legacy exact: `^ZNID24xxA1$` -> `2424A1`, `^ZNID24xxA_GR$` -> `2426A`, `^ZNID24xx$` -> `2424`
7. Huawei passthrough: `^HS8145X6$` -> `HS8145X6`, `^EG8041X6-10$` -> same, `^BM443GAX4$` -> same (only when manufacturer is Huawei, but passthrough is safe)
8. ZTE: `^F890L$` -> `F890L`
9. Fallback: `/.*/` -> `Otro` for any other non-empty, empty/null -> `Otro`

Implementation notes: `normalizeModel` first checks exact legacy map (O(1)), then runs rules in order, returns first match, else `Otro`. All inputs coerced via `String(raw||"").trim()`.

## Integration Points

**1. `backend/src/routes/devices.js` — `GET /stats/summary` (line ~194):**
- After `paramValue(DeviceInfo.Manufacturer)` + fallback `_Manufacturer`, call `normalizeManufacturer()`.
- After `paramValue(ModelName)` + fallback `_ProductClass`, call `normalizeModel(raw, normalizedManufacturer)`.
- Build `manufacturers Set` and `models Set` from normalized values; `brands Map` keyed by normalized manufacturer.
- `Otro` included when count>0, omitted when 0 (filter `brands` before response).
- Response shape unchanged (frontend `dashboard.js` consumes `modelCount/manufacturerCount/brands` directly — no frontend change needed except correct rendering).

**2. `GET /devices` listing + `buildSnapshot()`/`getSnapshot()`:**
- Snapshot currently stores `_model` as raw. Change to store both `_rawModel` and `_modelNormalized`, or compute normalized on filter path. Preferred: compute at filter time via `normalizeModel` to avoid snapshot schema change, but cache normalized value in snapshot object (`_model: normalized`) since it's in-memory only and recomputed on each `buildSnapshot`. Keep TTLs unchanged (60s).

**3. Filter handling (`filterDevices` in `lib/device-filters.js`):**
- Query params `?manufacturer=` and `?model=` will contain normalized values (frontend sends what it received from stats). Filter compares against normalized device manufacturer/model, not raw.

## Sequence Diagram

```
Frontend                Backend                 GenieACS NBI
   |  GET /api/devices/stats/summary  |                  |
   |--------------------------------->|  scan batches    |
   |                                  |  /devices?projection=... |
   |                                  |----------------->|
   |                                  |<-----------------|
   |                                  | normalizeManufacturer() |
   |                                  | normalizeModel() |
   |                                  | Set/Map aggregate |
   |                                  | cache (60s) |
   |<---------------------------------|                  |
   |  {total, manufacturerCount, modelCount, brands[]}   |
```

For listing:
```
Frontend  GET /api/devices?manufacturer=Huawei  Backend(filterDevices) -> normalizeDevice() per device -> filter -> paginate -> res
```

## Performance and Caching

Scanning 4308 devices in batches of 500 is existing behavior. Added cost is one `Map` lookup + 1-5 regex tests per device (~4300 * ~5 = 21k regex execs), negligible (<5ms). `STATS_CACHE_TTL` and `SNAPSHOT_TTL` remain 60s; normalized data cached same as raw, no extra invalidation needed. Deploy invalidates via TTL expiry.

## Error Handling and Edge Cases

- Unknown manufacturer/model never throws; returns `Otro`.
- Empty `ModelName` correctly falls back to `_ProductClass` then normalization (covers legacy 2494 devices).
- Case-insensitive manufacturer via `toLowerCase().trim()` before map lookup.
- Future unknown model `UNKNOWN-9000` -> `Otro` visible bucket, not dropped — allows ops to detect new hardware.

## Testing Strategy

No runner currently; design is testable via pure-function unit tests once a runner is added (`vitest` recommended). Tests will cover all 18 raw models -> 8 normalized, plus unknown/empty/case variants. Manual verification via `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/devices/stats/summary` and filter queries.

## Risks

- Regex ordering bug could mis-bucket e.g., `2424A1` matching `2424` rule — mitigated by ordering specific before generic.
- Legacy mapping assumption now confirmed, so low risk.
