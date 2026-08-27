# Device Inventory Normalization Specification

## Purpose

Normalization layer for manufacturer and model identifiers at the API presentation boundary. Ensures fleet inventory counts match commercial reality (3 manufacturers, ~8 models) and remain deterministic regardless of GenieACS raw string variations.

## Requirements

### Requirement: Manufacturer Normalization

The system MUST normalize raw manufacturer strings from GenieACS to a canonical set before counting, listing, or filtering. Lookup MUST be case-insensitive and trim-aware.

Canonical mapping:
- `Zhone` -> `Zhone`
- `Huawei Technologies Co., Ltd` -> `Huawei`
- `HWTC` -> `Huawei`
- `ZXIC` -> `ZTE`
- `Desconocido` or empty/null -> `Otro`
- Any other unknown value -> `Otro`

#### Scenario: Huawei alias HWTC maps to Huawei

- GIVEN a device reports `_deviceId._Manufacturer = "HWTC"` and `DeviceInfo.Manufacturer` empty
- WHEN `normalizeManufacturer()` is called
- THEN result is `"Huawei"`

#### Scenario: ZTE alias ZXIC maps to ZTE

- GIVEN a device reports manufacturer `"ZXIC"`
- WHEN normalized
- THEN result is `"ZTE"`

#### Scenario: Desconocido maps to Otro

- GIVEN a device reports manufacturer `""` or `"Desconocido"` or null
- WHEN normalized
- THEN result is `"Otro"`

#### Scenario: Unknown future manufacturer maps to Otro

- GIVEN a device reports manufacturer `"AcmeCorp"`
- WHEN normalized
- THEN result is `"Otro"` and no error is thrown

#### Scenario: Case-insensitive lookup

- GIVEN raw manufacturer `"hwtc"` or `"HUAWEI TECHNOLOGIES CO., LTD"`
- WHEN normalized
- THEN result is `"Huawei"`

### Requirement: Zhone Model Normalization — 5 Commercial Buckets

The system MUST map all Zhone raw model strings to exactly 5 canonical model buckets. Suffixes `-00`, `-NA`, `-00-NA`, bare prefix without `ZNID-GPON-` must collapse deterministically. Regex rules MUST be evaluated in specificity order (longest/specific first).

Mapping:
- `ZNID-GPON-2424` (exact) -> `2424`
- `ZNID-GPON-2424A` (exact) -> `2424A`
- `ZNID-GPON-2424A1` + `ZNID-GPON-2424A1-00` -> `2424A1`
- `ZNID-GPON-2426A` + `ZNID-GPON-2426A-00` + `ZNID-GPON-2426A-NA` -> `2426A`
- `ZNID-GPON-2426A1` + `ZNID-GPON-2426A1-00` + `ZNID-GPON-2426A1-NA` + `ZNID-GPON-2426A1-00-NA` -> `2426A1`
- Legacy `ZNID24xxA1` -> `2424A1`
- Legacy `ZNID24xxA_GR` -> `2426A`
- Legacy `ZNID24xx` -> `2424`

#### Scenario: Suffixed variant 2424A1-00 collapses to 2424A1

- GIVEN raw model `"ZNID-GPON-2424A1-00"`
- WHEN `normalizeModel("ZNID-GPON-2424A1-00", "Zhone")` is called
- THEN result is `"2424A1"`

#### Scenario: Suffixed variant 2426A-NA collapses to 2426A

- GIVEN raw model `"ZNID-GPON-2426A-NA"`
- WHEN normalized
- THEN result is `"2426A"`

#### Scenario: Legacy ProductClass ZNID24xxA1 maps to 2424A1

- GIVEN a device has empty `DeviceInfo.ModelName` and `_ProductClass = "ZNID24xxA1"`
- WHEN raw model `"ZNID24xxA1"` is normalized for Zhone
- THEN result is `"2424A1"`

### Requirement: Huawei and ZTE Model Passthrough

Huawei models (`HS8145X6`, `EG8041X6-10`, `BM443GAX4`) and ZTE model (`F890L`) MUST pass through unchanged after manufacturer normalization. They MUST NOT be bucketed with Zhone rules.

#### Scenario: Huawei HS8145X6 unchanged

- GIVEN raw model `"HS8145X6"` with normalized manufacturer `"Huawei"`
- WHEN normalized
- THEN result is `"HS8145X6"`

#### Scenario: ZTE F890L unchanged

- GIVEN raw model `"F890L"` with normalized manufacturer `"ZTE"`
- WHEN normalized
- THEN result is `"F890L"`

### Requirement: Model Fallback to Otro

Empty, null, or unrecognized model strings MUST normalize to `"Otro"`.

#### Scenario: Empty model falls to Otro

- GIVEN raw model `""` or null and any manufacturer
- WHEN normalized
- THEN result is `"Otro"`

#### Scenario: Unknown future model falls to Otro

- GIVEN raw model `"UNKNOWN-9000"`
- WHEN normalized
- THEN result is `"Otro"`

### Requirement: Presentation-Only — Raw Data Preservation

The system MUST NOT mutate raw data in Mongo/GenieACS. Normalization MUST occur only at API response construction (in-memory mapping before `res.json`).

#### Scenario: Raw data preserved in NBI

- GIVEN a device stored as `_ProductClass: "ZNID24xxA1"` in GenieACS
- WHEN stats or listing endpoint is called
- THEN response shows normalized `"2424A1"` but a direct NBI query still returns `"ZNID24xxA1"`

### Requirement: Otro Bucket Visibility in Frontend

Normalized value `"Otro"` MUST be treated as a first-class bucket visible in the frontend when count > 0. It MUST be counted in `manufacturerCount`/`modelCount`, included in `brands[]` breakdown, and appear in manufacturer/model filter dropdowns. When count is 0, it MUST NOT appear. `"Otro"` MUST NOT be stored silently in memory only.

#### Scenario: Otro visible when devices map to unknown manufacturer

- GIVEN 1 device normalizes to manufacturer `"Otro"` and 0 previously
- WHEN `GET /api/devices/stats/summary` is called
- THEN `manufacturerCount` includes `"Otro"`, `brands` contains `{name: "Otro", count: 1}`, and frontend filter dropdown shows `"Otro"` option

#### Scenario: Otro hidden when no device maps to it

- GIVEN no device normalizes to `"Otro"`
- WHEN stats are fetched
- THEN `brands` does not contain `"Otro"` and filter dropdown omits it

#### Scenario: Otro visible for unknown model

- GIVEN a device raw model `"DesconocidoXYZ"` normalizes to model `"Otro"`
- WHEN model list/filters are rendered
- THEN model filter includes `"Otro"` and `modelCount` includes the bucket
