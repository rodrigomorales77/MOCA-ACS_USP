# TR-069 SSID Special Characters — Validation Tests

**Date:** 2026-08-25
**Server:** `genie-acs-todd` — 190.92.103.227 (GenieACS, MongoDB `genieacs`, 3926 devices at time of test)
**ONU under test:** `001146-F890L-ZXICCADE0F12` (ZTE F890L V9.1.0P1T1, SN ZXICCADE0F12)

Related: `genieacs/provisions/inform.js`, `docs/INVENTARIO_ONT.md` §6.2 (ZXIC F890L), `genieacs/README.md`

---

## 1. Objective

Verify that SSID values containing XML-significant characters (`&`, `<`, `>`, `!`) are handled correctly end-to-end over CWMP: GenieACS `xmlbuilder` escaping, transport integrity, and ONU firmware validation — without breaking the TR-069 session.

---

## 2. Initial DB Scan (2026-08-25, 3926 devices)

Pre-test scan of production DB to assess existing exposure:

| Query | Count | Detail |
|-------|-------|--------|
| Devices total | 3926 | `genieacs` DB |
| `&` in PPPoE `T&W` username/password or related fields | 1275 | Common credential pattern `T&W` |
| `&` in SSID (`WLANConfiguration.*.SSID`) | 2 | SSIDs `Ane & Melu` (distinct devices) |
| NBSP (`\u00A0`) in `Hosts.Host.*.HostName` | 7 | Android TV hostnames; ` HostName: "Android TV"` with leading NBSP |
| Illegal XML control chars (`0x00-0x08`, `0x0B-0x0C`, `0x0E-0x1F`) in any parameter | 0 | No device stores a raw control character that would break XML serialization |

Implication: `&` is already present in production at scale (credentials and SSIDs) with no observed CWMP breakage. NBSP and `&` occurrences confirm the stack tolerates non-ASCII/extended characters at the transport layer.

---

## 3. Targeted SSID Tests — ONU ZXICCADE0F12

Baseline SSID before tests: `86a6he` (restored after each test).

### Test A — `Test! &<>` (all special chars)

- **Set:** `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID = "Test! &<>"` via `SetParameterValues`
- **Result:** **Rejected by CPE** — CWMP fault `9003 Invalid arguments` (firmware-side SSID validation). Device returned a `FaultStruct` with `FaultCode 9003`.
- **Session integrity:** TR-069 session remained intact. No XML parse error, no `9002 Internal error`, no session drop. GenieACS `xmlbuilder` correctly escaped the payload (`&amp;`, `&lt;`, `&gt;`). Rejection is a firmware policy decision, not a protocol failure.

### Test B — `Test! & Prueba` (ampersand + exclamation)

- **Set:** `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID = "Test! & Prueba"`
- **Result:** **Success.** `SetParameterValuesResponse` status 0, followed by `GetParameterValues` confirming `SSID = "Test! & Prueba"` stored literally on the CPE.
- **Wire verification:** GenieACS serialized `&` as `&amp;` in the SOAP envelope (xmlbuilder default `escapeXml`). CPE decoded and persisted the literal `&`.
- **Revert:** `SetParameterValues` back to `86a6he` — success, verified via `GetParameterValues`.

---

## 4. Conclusion

| Character | Result | Notes |
|-----------|--------|-------|
| `!` | Safe | Accepted and persisted |
| `&` | Safe | Escaped to `&amp;` on wire, stored as `&` on CPE |
| `<`, `>` | Rejected (9003) but safe | Firmware rejects per SSID charset policy; CWMP framing unaffected |

- `!` and `&` are safe for SSID provisioning via TR-069.
- `<` and `>` are rejected by ZTE F890L V9.1.0P1T1 firmware (fault 9003) but **do not corrupt the CWMP XML envelope** — GenieACS escaping is correct and the session survives.
- No evidence of XML injection or session desync from special characters. The existing `xmlbuilder` escaping path is sufficient; no additional sanitization layer required at the ACS.

Recommendation: keep the SSID charset validation on the backend/frontend permissive for `!` and `&`; surface firmware `9003` rejections to the user as "character not allowed by device" rather than a generic ACS error.

---

## 5. Related Fix — cwmp.9002 PeriodicInformTime (2026-08-25)

### Symptom

Devices returned `cwmp.9002 Internal error` / `cwmp fault 9002` on `SetParameterValues` for `PeriodicInformTime`. Visible on ZXICCADE0F12 and other devices during re-provisioning.

### Root Cause

`genieacs/provisions/inform.js:31` set `PeriodicInformTime` to an **integer** (`simpleHash(DeviceID.ID) % 86400`, range 0–86399). The TR-069 data model defines `PeriodicInformTime` as `xsd:dateTime` (e.g. `2026-08-25T00:00:00.000Z`). Strict CPE stacks reject a bare integer as a type violation (fault 9002).

Prior revision (2026-08-21) had fixed `daily % 86400000 == 0` alignment (all devices at `0`) by introducing the per-device hash distribution, but kept the value as seconds-since-midnight integer.

### Fix (deployed 2026-08-25T14:20:13Z)

`genieacs/provisions/inform.js` — compute a per-device offset and format as ISO-8601 UTC:

```js
const informOffset = simpleHash(username) % 86400;
const informTime = new Date(daily + informOffset * 1000).toISOString();
```

- `daily` — `Date.now() - (Date.now() % 86400000)` (midnight UTC, refreshed once per day via `value: daily` dedup key)
- `informOffset` — deterministic 0–86399 s spread via `simpleHash(DeviceID.ID)`
- `informTime` — `xsd:dateTime` string (e.g. `2026-08-25T07:42:11.000Z`)

Both `InternetGatewayDevice.ManagementServer.PeriodicInformTime` and `Device.ManagementServer.PeriodicInformTime` paths are updated identically (`genieacs/provisions/inform.js:37,43`).

### Deployment

```bash
# Update provision in MongoDB
docker exec moca-mongodb mongo --quiet genieacs --eval \
  'db.provisions.updateOne({_id:"inform"},{$set:{script: <new inform.js>}})'

# Restart GenieACS to reload provisions
docker restart moca-genieacs  # OK, 2026-08-25T14:20:13Z
```

### Verification

- `GetParameterValues` on `PeriodicInformTime` now returns an ISO datetime string.
- Subsequent `SetParameterValues` / provision refresh no longer triggers fault 9002 on ZXICCADE0F12.
- No change to `PeriodicInformInterval` (300 s) or `PeriodicInformEnable`.

---

## 6. References

- GenieACS provision: `genieacs/provisions/inform.js`
- GenieACS presets: `genieacs/presets.json`
- Inventory: `docs/INVENTARIO_ONT.md`
- Provisions overview: `genieacs/README.md`
- Test device: `001146-F890L-ZXICCADE0F12` — ZTE F890L V9.1.0P1T1
