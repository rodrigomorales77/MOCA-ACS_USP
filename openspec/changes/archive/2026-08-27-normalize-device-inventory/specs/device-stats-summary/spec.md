# Delta for Device Stats Summary

## Purpose

Dashboard summary endpoint `GET /api/devices/stats/summary` currently counts raw manufacturer/model strings, inflating fleet metrics (18 models, 4 manufacturers). This delta applies the inventory normalization layer so the dashboard reflects commercial reality.

## ADDED Requirements

### Requirement: Normalized Stats Response

The system MUST return normalized `manufacturerCount`, `modelCount`, and `brands[]` in `GET /api/devices/stats/summary`. Normalization MUST be applied before aggregation (Sets/Maps built from normalized values, not raw). The endpoint MUST remain cached with `STATS_CACHE_TTL = 60s` and serve normalized data within 60s of deploy.

#### Scenario: Normalized counts match commercial reality

- GIVEN fleet of 4308 devices with current raw breakdown (18 raw models, 4 raw manufacturers)
- WHEN `GET /api/devices/stats/summary` is called after change
- THEN response `manufacturerCount` is `3` (Zhone, Huawei, ZTE) plus `1` for `"Otro"` only if needed, `modelCount` is `8` (5 Zhone + 2 Huawei + 1 ZTE + optional Otro), and `brands` contains at most 4 entries (Zhone, Huawei, ZTE, Otro) sorted descending

#### Scenario: Cache serves normalized data

- GIVEN `STATS_CACHE_TTL = 60s` and a cached normalized response exists
- WHEN a second request arrives within 60s
- THEN cached normalized response is returned without re-scanning NBI

#### Scenario: Brand chart excludes HWTC and ZXIC after normalization

- GIVEN raw brands `HWTC:1`, `ZXIC:2`, `Huawei Technologies Co., Ltd:340`
- WHEN stats are computed
- THEN `brands` contains single entry `{name: "Huawei", count: 341}` and `{name: "ZTE", count: 2}`, with no `HWTC` or `ZXIC` entries

### Requirement: Listing and Filter Consistency

Manufacturer and model filters, device listing (`GET /api/devices`), and any model/manufacturer dropdowns MUST use the same normalized values as `stats/summary`. Filtering by a normalized value (e.g., `?manufacturer=Huawei`) MUST match all devices whose raw values map to that normalized bucket.

#### Scenario: Filter by normalized manufacturer Huawei matches both aliases

- GIVEN devices with raw manufacturers `"Huawei Technologies Co., Ltd"` and `"HWTC"`
- WHEN `GET /api/devices?manufacturer=Huawei` (normalized) is called
- THEN both device groups are returned

#### Scenario: Filter by normalized model 2424A1 matches variants and legacy

- GIVEN devices with raw models `"ZNID-GPON-2424A1"`, `"ZNID-GPON-2424A1-00"`, `"ZNID24xxA1"`
- WHEN `GET /api/devices?model=2424A1` is called
- THEN all three groups are returned

### Requirement: Otro Bucket Exposed in Stats and Filters

(See also `device-inventory-normalization` spec — this requirement scopes the contract to the stats/listing surface.)

The `brands[]` array and any filter-option endpoints MUST include `"Otro"` when at least one device normalizes to it, with correct count. Frontend `dashboard.js` (`stats.modelCount`, `stats.manufacturerCount`, `brands` chart) MUST render it without code changes beyond consuming the normalized payload.

#### Scenario: Otro appears in brands when present

- GIVEN 5 devices normalize to `"Otro"`
- WHEN stats are fetched and rendered in dashboard
- THEN the "Fabricantes" metric, brand chart, and filter dropdown all include `"Otro"` with count 5

#### Scenario: Otro absent when not needed

- GIVEN 0 devices normalize to `"Otro"`
- WHEN stats are fetched
- THEN `"Otro"` is omitted from `brands` and filter options
