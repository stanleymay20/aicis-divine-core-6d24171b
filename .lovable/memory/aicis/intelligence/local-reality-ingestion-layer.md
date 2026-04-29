---
name: LRIL — Local Reality Ingestion Layer
description: Village/town/suburb event detection. 5 tables (aicis_raw_local_signals, aicis_keyword_packs, aicis_geo_entities, aicis_local_events, aicis_proxy_signals). Edge fns lril-ingest (GDACS+GDELT) + lril-process (detect→geo→classify→cluster→bridge) + lril-proxy. Cron every 30min. Confidence tiers: ≥0.7 high (Confirmed), ≥0.4 medium (Watch), <0.4 low (Early Signal — never suppressed). Events ≥0.4 bridge to normalized_events.
type: feature
---

# LRIL — Local Reality Ingestion Layer

## Tables
- `aicis_raw_local_signals` — raw text from news/gov/ngo/aggregator/proxy with `country_hint`, `language`, `published_at`, `processed_at`, `dedup_key`. RLS read-auth.
- `aicis_keyword_packs` — multilingual `(language, country, domain, subtype, keywords[], weight)`. Seeded EN + FR/ES/PT/AR + GHA/NGA/ZAF/KEN/IND country specifics (incl. dumsor, loadshedding).
- `aicis_geo_entities` — `(iso3, admin_level_1, city, locality, lat, lon, geo_confidence)`. Seeded ~85 capitals.
- `aicis_local_events` — clustered classified events with generated `confidence_tier` column (high/medium/low), `bridged_to_normalized` flag.
- `aicis_proxy_signals` — anomaly readings (night_lights, network_outage, etc.) with z-score deviation.

## Helper functions (search_path = public)
- `lril_detect_keywords(text, language, country)` → matched_terms, domain, subtype, score (top 5)
- `lril_compute_confidence(source_count, reliability, kw_strength, geo_conf, temporal_density, proxy_boost)` → 0–1, weights 35/20/20/15/10 + boost
- `lril_bridge_to_normalized()` — idempotent; bridges events with confidence ≥0.4 + status='active'

## Edge functions
- `lril-ingest` — GDACS (no key, reliable) + GDELT (best-effort, 429-tolerant) + custom POST `{items:[]}` mode
- `lril-process` — pulls 500 unprocessed signals, RPC keyword detection, locality string-match geo, spatial-temporal clustering (25km / 12h window), confidence scoring, bridge to normalized_events
- `lril-proxy` — POST `{readings:[]}`, computes 30d baseline, boosts co-occurring active events (max +0.2)

## pg_cron
- `lril-ingest-30min` — `*/30 * * * *`
- `lril-process-30min` — `5,35 * * * *`

## UI
- `/local-events` global, `/local-events/:iso3` country, `/local-events/:iso3/:locality` village/suburb
- Confidence badges (Confirmed/Watch/Early Signal), evidence drawer with raw signal source links, keyword chips, lat/lon

## Detection guarantee
- Low-confidence events are NEVER suppressed — surfaced as "Early Signal"
- When zero signals exist for a query: UI shows "No detectable digital signals for this locality"
