---
name: LRIL — Local Reality Ingestion Layer
description: Sharp local event detection. v3 adds per-country GDELT sweeps (lril-country-sweep) cycling 20 underrepresented countries / 30min so all ~190 countries are queried within 5h. Combined with v2 source tiering and FIPS→ISO3 normalization. 65+ countries actively covered, growing every cron tick.
type: feature
---

# LRIL v3 — Planetary Coverage Sweep

## Three-tier ingestion architecture
1. **`lril-ingest`** (every 30min): thematic queries (xenophobia, dumsor, RSF, Houthis...) + GDACS + ReliefWeb + USGS + EONET. Catches global hotspots regardless of country.
2. **`lril-country-sweep`** (every 30min): cycles 20 lowest-coverage countries per run, queries GDELT with `"<country name>" AND <broad incident terms>`. Full sweep covers ~190 countries every ~5h. Crucial for small/low-news countries that thematic queries miss.
3. **`lril-process`** (every 30min, offset +5min): keyword detect → geo resolve → cluster → confidence score → bridge.

## Why country-sweep was needed
Thematic queries surface incidents from wherever GDELT happens to index. Big-press countries (USA, UK, India, China, ZAF) dominate; small countries (Lesotho, Sierra Leone, Iceland, Bhutan, Pacific islands) get zero signals even when real events occur. The sweep explicitly searches FOR those countries by name, overriding GDELT's publisher-country bias.

## Country code normalization (v2 carryover)
- `iso3` = original (audit trail)
- `iso3_normalized` = ISO 3166-1 alpha-3 (UI/API queries)
- `lril_fips_to_iso3()` covers FIPS 2-letter (GM→DEU, RP→PHL, SF→ZAF) AND GDELT 3-letter aliases (UNI→USA, NIG→NGA, SOU→ZAF, GER→DEU, PHI→PHL).

## Source reliability tiers (`lril_source_tier`)
- 0.95 — gdacs, usgs, nasa_eonet, reliefweb, who, fao, imf, worldbank
- 0.90 — *.gov.* / un.org / europa.eu / who.int
- 0.85 — Reuters, AP, AFP, BBC, Al Jazeera, Bloomberg, NYT, WSJ, FT, Guardian, DW
- 0.75 — Regional dailies (allafrica, punchng, thehindu, scmp, clarin, infobae...)
- 0.50 — default unknown publisher

## Confidence formula
- Source-count log curve: 1=0.35, 2=0.55, 3=0.7, 5=0.85, 10+=1.0
- Weights: 35% src + 25% reliability + 20% kw + 15% geo + 5% temporal + ≤20% proxy
- Floors: 1 tier-1 src + strong kw → ≥0.45 (Watch); 3+ src @ 0.7+ → ≥0.7 (Confirmed)

## Tiers (UI)
- ≥0.7 Confirmed | ≥0.4 Watch | <0.4 Early Signal (never suppressed)
- Bridge threshold = 0.4 — 100% of actionable events flow to normalized_events → risk_action_recommendations

## Last sweep result (2026-04-30)
- 216 events / 65 countries / 30 confirmed / 100% bridged
- Country-sweep cron will continue expanding coverage every 30min
- Cron jobs: `lril-ingest-30min`, `lril-process-30min`, `lril-country-sweep-30min`
