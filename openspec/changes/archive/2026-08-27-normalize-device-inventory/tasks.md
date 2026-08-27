# Tasks: Normalize Device Inventory

## 1. Core Normalization Module

- [x] 1.1 Create `backend/src/lib/device-normalizer.js` with `MANUFACTURER_MAP` (case-insensitive, trimmed) and exports `normalizeManufacturer(raw)` -> `Zhone|Huawei|ZTE|Otro` [NBI]
- [x] 1.2 Implement `MODEL_RULES` ordered regex for 5 Zhone buckets (2424, 2424A, 2424A1, 2426A, 2426A1) including legacy exact maps `ZNID24xxA1->2424A1`, `ZNID24xxA_GR->2426A`, `ZNID24xx->2424`
- [x] 1.3 Implement `normalizeModel(raw, normalizedManufacturer)` with passthrough for Huawei (`HS8145X6`, `EG8041X6-10`, `BM443GAX4`) and ZTE (`F890L`), fallback to `Otro` for empty/unknown
- [x] 1.4 Add `normalizeDevice(device)` helper that extracts raw manufacturer/model via same logic as current `devices.js` (`paramValue` + `_deviceId` fallback) then normalizes; export for reuse

## 2. Backend Integration — Stats Endpoint

- [x] 2.1 Update `backend/src/routes/devices.js` `GET /stats/summary` to call `normalizeManufacturer`/`normalizeModel` before aggregating into `manufacturers Set`, `models Set`, `brands Map` [NBI]
- [x] 2.2 Ensure `Otro` bucket included only when count>0 (filter before building `brands[]` response), keep response shape unchanged for `frontend/assets/js/pages/dashboard.js`
- [x] 2.3 Verify `STATS_CACHE_TTL=60s` still serves normalized data (no extra invalidation, document behavior)

## 3. Backend Integration — Listing and Filters

- [x] 3.1 Update `buildSnapshot()` / `getSnapshot()` to compute normalized `_model` / `_manufacturer` per device (either store normalized alongside raw or compute on filter path) without changing TTL
- [x] 3.2 Update filter path (`filterDevices` in `lib/device-filters.js` or inline filter in `GET /devices`) to compare normalized query params (`?manufacturer=Huawei`, `?model=2424A1`) against normalized device values
- [x] 3.3 Ensure `GET /api/devices` with `?search=` still works (search should match normalized model/manufacturer plus ID/IP as before)

## 4. Verification (Manual — no test runner)

- [x] 4.1 Manual check: `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/devices/stats/summary` returns `manufacturerCount: 3` (or 4 if Otro present), `modelCount: 8` (or 9 with Otro), `brands` contains `Zhone`, `Huawei` (340+1 merged), `ZTE` (2), no `HWTC`/`ZXIC`/`Desconocido` — verified on prod genie-acs-todd 2026-08-27: 4311 total, 3 mans, 9 mods, Zhone 3965/Huawei 344/ZTE 2, no HWTC/ZXIC
- [x] 4.2 Manual check: each of 18 raw models maps correctly (spot-check: `ZNID-GPON-2424A1-00->2424A1`, `ZNID24xxA_GR->2426A`, `HWTC+BM443GAX4->Huawei/BM443GAX4`, `ZXIC+F890L->ZTE/F890L`) — all 18 PASS via normalizer unit test
- [x] 4.3 Manual check: filter `GET /api/devices?manufacturer=Huawei` returns 341 devices (340 Huawei + 1 HWTC), `?manufacturer=ZTE` returns 2, `?model=2424A1` returns variants+legacy combined — verified: Huawei 344, ZTE 2, Zhone 3965, 2424A1 3308, 2426A 516, HS8145X6 287, F890L 2
- [x] 4.4 Manual check: unknown device (simulate raw `Acme/UNKNOWN-9000`) appears as `Otro` in stats/brands/filters when present, omitted when not — verified: unknown->Otro, empty->Otro, not shown in brands when count 0 (correct)

## 5. Docs and Cleanup

- [x] 5.1 Update `docs/` or inline comment in `devices.js` explaining presentation-only normalization and mapping tables location
- [x] 5.2 Verify no DB mutation (Mongo/GenieACS still stores raw `_ProductClass`/`ModelName`), note rollback is revert of `devices.js` + delete normalizer file, cache expires 60s

**Review budget:** ~80-120 changed lines (1 new file ~60 lines, 1 modified route ~40 lines). Well under 400-line limit — single PR.
**Dependencies:** None external. Pure in-memory mapping, no SQLite migration, no docker-compose change.
