# Proposal: Normalize Device Inventory

## Intent

The dashboard shows 18 distinct device models and 4 manufacturers, inflating counts and confusing operators. Real fleet has 3 manufacturers (Zhone, Huawei, ZTE) and ~8 commercial models. This change normalizes manufacturer names and model identifiers at the API presentation layer so stats, listings, filters, and charts show accurate, actionable inventory.

## Scope

### In Scope
- Manufacturer mapping table: Zhone, Huawei Technologies Co. Ltd + HWTC → Huawei, ZXIC → ZTE, "Desconocido" → "Otro"
- Model normalization for Zhone: 5 commercial buckets (2424, 2424A, 2424A1, 2426A, 2426A1) with suffix collapsing (-00, -NA, -00-NA)
- Legacy ProductClass-only devices (ZNID24xxA1, ZNID24xxA_GR, ZNID24xx): map to closest commercial bucket with fallback "Zhone ZNID (Legacy)" bucket
- Huawei models: HS8145X6, EG8041X6-10, BM443GAX4 → Huawei bucket
- ZTE model: F890L → ZTE bucket
- Apply normalization in GET /api/devices/stats/summary, device listings, manufacturer filters, model filters, charts
- Deterministic mapping tables + normalization helpers + unit tests
- Cache invalidation awareness (STATS_CACHE_TTL 60s)

### Out of Scope
- Database migration or GenieACS data mutation (presentation-only)
- Backfill of historical snapshots
- New model auto-discovery (unknown future models → "Otro" bucket)
- Firmware/software version normalization

## Capabilities

### New Capabilities
- `device-inventory-normalization`: Normalization layer for manufacturer and model identifiers at API response boundary

### Modified Capabilities
- `device-stats-summary`: Response payload now returns normalized manufacturerCount, modelCount, and brand breakdown
- `device-list-filter`: Manufacturer and model filter options now use normalized values

## Approach

Create a normalization module (`backend/src/utils/device-normalizer.js`) with:
1. `MANUFACTURER_MAP` — exact string mapping table (case-insensitive lookup)
2. `MODEL_MAP` — regex-based model normalization with ordered rules (specific first, generic last)
3. `normalizeManufacturer(raw)` and `normalizeModel(raw, manufacturer)` pure functions
4. Integration points: `devices.js` stats/summary route, device listing route, filter endpoint
5. Unit tests covering all 18 current models + edge cases (unknown, empty, legacy ProductClass)

Mapping tables per confirmed answers:

**Manufacturer Map**
| Raw | Normalized |
|-----|------------|
| Zhone | Zhone |
| Huawei Technologies Co., Ltd | Huawei |
| HWTC | Huawei |
| ZXIC | ZTE |
| Desconocido | Otro |
| (unknown) | Otro |

**Zhone Model Map (5 buckets)**
| Raw Pattern | Normalized |
|-------------|------------|
| ZNID-GPON-2424$ | 2424 |
| ZNID-GPON-2424A$ | 2424A |
| ZNID-GPON-2424A1(-.*)?$ | 2424A1 |
| ZNID-GPON-2426A(-.*)?$ | 2426A |
| ZNID-GPON-2426A1(-.*)?$ | 2426A1 |
| ZNID24xxA1 | 2424A1 (legacy → closest bucket) |
| ZNID24xxA_GR | 2426A (legacy → closest bucket) |
| ZNID24xx | 2424 (legacy → fallback bucket) |

**Huawei Model Map**
| Raw | Normalized |
|-----|------------|
| HS8145X6 | HS8145X6 |
| EG8145X6-10 | EG8145X6-10 |
| BM443GAX4 | BM443GAX4 |

**ZTE Model Map**
| Raw | Normalized |
|-----|------------|
| F890L | F890L |

After normalization: manufacturerCount 3, modelCount ~8-9 (5 Zhone + 2 Huawei + 1 ZTE + optional Legacy)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/utils/device-normalizer.js` | New | Core normalization module with mapping tables and pure functions |
| `backend/src/routes/devices.js` | Modified | Stats summary route (line 194), device listing, filter endpoints — apply normalization before response |
| `frontend/assets/js/pages/dashboard.js` | Modified | Consumes normalized stats.modelCount, manufacturerCount, brands |
| `backend/test/device-normalizer.test.js` | New | Unit tests for all mappings and edge cases |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mapping drift — new models appear in GenieACS not covered by tables | Medium | Unknown models fall to "Otro" bucket; add monitoring alert for "Otro" count spike |
| Legacy ProductClass ambiguity — ZNID24xx* mapping may be wrong | High | Document as decision gap; ship with fallback "Zhone ZNID (Legacy)" bucket; client to confirm via 1-by-1 examples |
| Cache stale data — STATS_CACHE_TTL 60s serves old unnormalized counts | Low | Invalidate cache on deploy; document TTL behavior |
| Case sensitivity in manufacturer strings from GenieACS | Low | Normalize lookup to lower-case; map table keys stored lower-case |
| Filter mismatch — frontend sends normalized value, backend expects raw | Medium | Normalize at filter input too; keep raw in DB for exact matching if needed |

## Rollback Plan

1. Revert `backend/src/routes/devices.js` to use raw `paramValue(DeviceInfo.ModelName) || _deviceId._ProductClass` without normalization
2. Delete `backend/src/utils/device-normalizer.js` and its test file
3. No database changes to revert (presentation-only)
4. Cache auto-expires in 60s (STATS_CACHE_TTL)

## Dependencies

- None external. Uses existing backend Express routes, better-sqlite3 queries, frontend dashboard.js

## Success Criteria

- [ ] GET /api/devices/stats/summary returns manufacturerCount: 3, modelCount: 8-9
- [ ] Brand breakdown shows Zhone, Huawei, ZTE only (no HWTC, ZXIC, Desconocido)
- [ ] Model list shows 5 Zhone buckets + 2 Huawei + 1 ZTE (+ optional Legacy)
- [ ] Manufacturer filter dropdown shows 3 options
- [ ] Model filter dropdown shows normalized buckets
- [ ] All 18 current raw models map correctly in unit tests
- [ ] Unknown manufacturer/model falls to "Otro" without errors
- [ ] Cache serves normalized data within 60s of deploy

## Key Learnings

1. Presentation-only normalization avoids risky database migrations while fixing user-facing confusion
2. Legacy ProductClass-only devices (empty ModelName) require explicit fallback strategy
3. STATS_CACHE_TTL 60s means normalization visible within one minute post-deploy
4. Decision gap on legacy ZNID24xx* mapping must be tracked and resolved with client