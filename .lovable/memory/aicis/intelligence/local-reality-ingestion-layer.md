---
name: LRIL — Local Reality Ingestion Layer
description: Sharp local event detection. v2 adds FIPS→ISO3 mapping + source tiering + log confidence curve. Single tier-1 source ≥0.45 (Watch); 3+ reliable sources ≥0.7 (Confirmed). 100% of events now bridge to normalized_events. Coverage 63+ countries growing.
type: feature
---

# LRIL v2 — Sharpening Notes

## Country code normalization
GDELT publishes FIPS-10-4 + quirky 3-letter aliases. We store both:
- `iso3` = original (preserves audit trail)
- `iso3_normalized` = ISO 3166-1 alpha-3 (UI/API queries)
Function: `lril_fips_to_iso3()` covers FIPS 2-letter (GM→DEU, RP→PHL, SF→ZAF) AND GDELT 3-letter aliases (UNI→USA, NIG→NGA, SOU→ZAF, GER→DEU, PHI→PHL, IRE→IRL, SPA→ESP, POR→PRT).

## Source reliability tiers (`lril_source_tier`)
- 0.95 — gdacs, usgs, nasa_eonet, reliefweb, who, fao, imf, worldbank
- 0.90 — *.gov.* / un.org / europa.eu / who.int
- 0.85 — Reuters, AP, AFP, BBC, Al Jazeera, Bloomberg, NYT, WSJ, FT, Guardian, DW, France24
- 0.75 — Regional dailies (allafrica, punchng, thehindu, scmp, clarin, infobae…)
- 0.50 — default unknown publisher

## Confidence formula (v2)
- Source-count log curve: 1 src=0.35, 2=0.55, 3=0.7, 5=0.85, 10+=1.0
- Weights: 35% src + 25% reliability + 20% kw + 15% geo + 5% temporal + ≤20% proxy
- Floor guarantees: 1 tier-1 src + strong kw → ≥0.45 (Watch); 3+ src @ 0.7+ → ≥0.7 (Confirmed)

## Tiers (UI)
- ≥0.7 Confirmed | ≥0.4 Watch | <0.4 Early Signal (never suppressed)
- Bridge threshold = 0.4

## Last sharpening result (2026-04-30)
- 189 events / 63 countries, 100% bridged
- ZAF xenophobia: 7 events, 2 confirmed (was 1 low-conf)
