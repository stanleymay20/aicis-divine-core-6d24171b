---
name: LRIL — Local Reality Ingestion Layer
description: v10 (2026-05-01) unblocks the bridge. Threshold 0.40→0.35, confidence formula rebalanced (single strong-keyword signals reach 0.42+), fuzzy geo resolver via unaccent+pg_trgm, alias table seeded, lril-process BATCH 500→2000, legacy bridge FIPS-normalizes. Result: 937 events bridged in first run vs 0 prior.
type: feature
---

# LRIL v10 — Bridge Unblock + Geo Resolver

## v10 fixes (gap analysis 2026-05-01 09:30 UTC)
- **Bridge threshold lowered** 0.40 → 0.35 in `lril_bridge_to_normalized()`. First post-fix run bridged 937 events (was 0/day).
- **Confidence formula rebalanced** in `lril_compute_confidence()`:
  - Source-count base: 0.35→0.40
  - Keyword strength weight: 0.20→0.25
  - Geo confidence floor: 0.30→0.35
  - New floor: keyword_strength≥1.0 ⇒ ≥0.42 (was capped at 0.30)
  - 2 sources ⇒ ≥0.50; 3+ sources tier-B ⇒ ≥0.70
- **Fuzzy geo resolver** `lril_resolve_geo_fuzzy(text, iso3)`:
  - Uses `unaccent` + `pg_trgm` extensions
  - 3-tier match: alias exact substring → unaccented locality/city/admin substring → trigram similarity ≥0.45
  - Trigram GIN indexes on `aicis_geo_entities` locality/city/admin_level_1
- **Alias table** `aicis_geo_aliases` seeded with Bombay/Mumbai, Calcutta/Kolkata, Saigon/HCMC, Constantinople/Istanbul, Kiev/Kyiv, Tananarive/Antananarivo, etc.
- **Throughput** `lril-process` BATCH 500 → 2000 (closes 3× deficit vs 14k/day input)
- **Legacy bridge** `bridge-events-to-normalized` now FIPS→ISO3 normalizes for crisis/signals/security writers (fixes 55% NULL country_iso3)

## Three-tier ingestion (unchanged)
1. `lril-ingest` /30min — GDELT thematic + GDACS + USGS + EONET + RSS + Google News
2. `lril-country-sweep` /30min — 20 lowest-coverage countries per run
3. `lril-process` /30min @ +5min — detect → fuzzy geo → cluster → confidence → bridge

## Known remaining gaps (v10)
- **ReliefWeb HTTP 400** — endpoint v2 still broken; pullReliefWeb() needs new POST body format.
- **Classification rate 10%** — 90% of ingested signals don't match any keyword pack. v9 packs (water/education/elections/sanctions) added but live RSS skews to security narratives. Need pack tuning against actual content.
- **GDELT 429 rate-limited** — legacy `gdelt-ingest` skipping every cycle (lril-ingest's GDELT calls work fine).
- **`cron-hourly-crisis-scan` 50% timeout** — needs chunking.
- **Fuzzy resolver coverage** — depends on geo entity density per country; sub-Saharan Africa + Pacific still sparse.
