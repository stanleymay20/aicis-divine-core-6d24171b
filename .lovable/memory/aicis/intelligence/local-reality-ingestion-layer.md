---
name: LRIL — Local Reality Ingestion Layer
description: v11 (2026-05-01) — keyword packs 268→380 (+42%, 22 domains, 16 langs), ReliefWeb v2 with optional RELIEFWEB_APPNAME secret (gracefully skipped when absent), cron-hourly-crisis-scan 55s watchdog prevents 1h zombies. Result: 984 LRIL events bridged in 24h (was 937), avg confidence 0.569, 179 countries covered.
type: feature
---

# LRIL v11 — Pack Expansion + ReliefWeb Graceful Skip + Watchdog

## v11 fixes
- **Keyword packs +112 (268→380)**: 22 domains × 16 languages. New narratives: corruption, sanctions/embargo, militants/offensive/casualties, impeachment, torture/press_freedom, outbreak/disease/health_strike, inflation/recession/default/currency, flood/cyclone/wildfire/heatwave, water crisis/contamination, famine/aid_blocked, displacement/border_crisis, election fraud, cyber breach/infra_attack, supply chain disruption, blackout/pipeline, infrastructure collapse/transport/telecom, narcotics, school attacks, market crash/bond yields, diplomacy expulsion/treaty.
- **ReliefWeb**: v1 decommissioned (HTTP 410), v2 now requires registered appname (HTTP 403 anonymous). Updated `pullReliefWeb()` to read optional `RELIEFWEB_APPNAME` secret; if missing, returns [] silently — no longer throws and pollutes logs.
- **cron-hourly-crisis-scan watchdog**: 55s AbortController prevents the 1h zombie state when crisis-scan stalls. crisis-scan itself already has internal 50s deadline.
- **Legacy gdelt-ingest cron**: Confirmed already inactive (only `ingest-gdelt-fan-out` exists, inactive). lril-ingest is the active GDELT puller.

## Three-tier ingestion (unchanged)
1. `lril-ingest` /30min — GDELT thematic + GDACS + USGS + EONET + RSS + Google News (+ ReliefWeb if appname configured)
2. `lril-country-sweep` /30min — 20 lowest-coverage countries per run
3. `lril-process` /30min @ +5min — detect → fuzzy geo → cluster → confidence → bridge

## Live state (post-v11, 24h window)
- Signals ingested: 14,311
- LRIL events created: 884 (avg confidence 0.569)
- LRIL bridged to normalized_events: 984
- Countries covered: 179 of ~211
- Geo-resolved (entity match): 106 (~12% — still the main remaining gap)
- NULL iso3 in normalized_events: 140 of 1,239 (11.3%)

## Known remaining gaps (v11)
- **Geo-resolution ~12%** — needs more aicis_geo_entities density in sub-Saharan Africa, Pacific, Central Asia. Current 882 entities is enough for capital/major-city resolution; village-level needs 5–10k more.
- **ReliefWeb dormant** — user can set `RELIEFWEB_APPNAME` secret after registering at https://apidoc.reliefweb.int/parameters#appname to re-enable.
- **Classification rate** — needs another tuning pass after live RSS sample (24–48h post-v11).
- **`lril-process` BATCH=2000** still has occasional small-batch runs (98 fetched in last log) when signal influx is bursty — fine.

## Confidence formula (v10, unchanged in v11)
`lril_compute_confidence`: source_count base 0.40, keyword_strength weight 0.25, geo floor 0.35. Single strong-keyword ⇒ ≥0.42; 2 sources ⇒ ≥0.50; 3+ tier-B sources ⇒ ≥0.70. Bridge threshold 0.35.
