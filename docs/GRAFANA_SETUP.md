# Grafana Integration - Data Extraction & Dashboards

**Status:** Planning phase  
**Date:** 2026-05-18  
**Context:** After server restart, GenieACS reconnected. Now building Grafana dashboards for device monitoring.

---

## Goal

Extract CPE device data from GenieACS and visualize in Grafana dashboards:

1. **WiFi Network Connectivity** — How many devices per network SSID
2. **Signal Strength Analysis** — Color-coded by quality (good/weak/poor)
3. **Bandwidth Usage** — In/Out bytes per interface to measure user consumption

---

## Critical Questions (MUST ANSWER)

### 1. Device Capabilities & Parameters

- [ ] Which **TR-069 parameters** are your CPEs reporting?
- [ ] Specifically:
  - WiFi SSID available?
  - Signal strength (RSSI/dBm)?
  - Interface counters (RxBytes, TxBytes, RxPackets, TxPackets)?
  - Which device models are deployed?

**How to check:** 
```bash
curl http://190.92.103.227:7557/devices | jq '.[0]' # Sample device params
# Or via ACS backend: GET /api/devices/:deviceId
```

### 2. Grafana Infrastructure

- [ ] Is Grafana already installed/running?
- [ ] If not, add to `docker-compose.yml`?
- [ ] Port preference (default 3000 conflicts with backend)?

### 3. Data Storage & Collection

- [ ] Metrics database choice:
  - **Prometheus** (time-series, scrape-based) — RECOMMENDED for this use case
  - **InfluxDB** (time-series, push-based)
  - **PostgreSQL** (relational, simple)
  - Direct query from ACS SQLite?

- [ ] Collection strategy:
  - Batch job every 5min from GenieACS NBI?
  - Real-time updates via callbacks?
  - Scheduled scheduler extension?

### 4. Update Frequency

- [ ] Dashboard refresh rate: 5sec / 30sec / 5min / 15min?
- [ ] How fresh must data be for use case?

---

## Technical Approach (Tentative)

```
CPE Device
    ↓ (reports to TR-069)
GenieACS NBI
    ↓ (query params)
ACS Backend [NEW: metrics collector job]
    ↓ (write metrics)
Prometheus/InfluxDB
    ↓ (query)
Grafana
    ↓
Dashboards (WiFi, Signal, Bandwidth)
```

**Implementation:**
1. Create scheduler job in `backend/src/jobs/` to poll GenieACS every N min
2. Extract WiFi SSID, signal strength, interface stats
3. Push to Prometheus or InfluxDB
4. Configure Grafana datasources
5. Build 3 dashboards per requirements

---

## Files to Create/Modify

- `docker-compose.yml` — add Prometheus + Grafana services
- `backend/src/jobs/metrics-collector.js` — NEW job to extract & push metrics
- `.env` — Prometheus/InfluxDB credentials
- Grafana dashboards (JSON exports)

---

## Blockers / Open Issues

- Need TR-069 param names/availability
- Need Grafana infrastructure decision
- Need metrics DB choice

---

## Next Steps

1. Answer 4 critical questions above
2. Validate CPE params via GenieACS API
3. Set up Prometheus + Grafana in docker-compose
4. Write metrics collector job
5. Build dashboards

