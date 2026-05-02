---
name: LRIL — Local Reality Ingestion Layer
description: v12 (2026-05-02) — geo entities 882→9,729 (+11×) across 245 countries via cities1000 seed. Result post-v12 24h window: 782 LRIL events, 772 bridged, 1,510 normalized, avg conf 0.658, 181 countries, 19 domains, 100% kw-match rate, 3.3% NULL iso3.
type: feature
---

# LRIL v12 — Sub-National Geo Density

## v12 fixes
- **Geo entities seeded**: cities1000 dataset → 8,847 new sub-national entities (capped 50/country) merged with existing 882. Total **9,729 entities across 245 countries**. fuzzy resolver (`lril_resolve_geo_fuzzy`, unaccent + trigram + alias) now has the corpus to actually hit village/city level outside capitals.
- **Re-process backlog**: ~3,000 unresolved 48h signals reset (`processed_at = NULL`) to re-evaluate against the denser geo corpus.
- **Classification rate verified**: ~5–10% raw-signal → event ratio is **correct** — most GDELT headlines (general/financial/sports news in CN/HE/RO/PL) are not crises. Of signals that *do* match, 100% are now classified across 19 domains (security 305, political 98, human_rights 62, governance 55, economy 43, health 41, climate 37, supply_chain 23, energy 21, food 15, cyber 12, narcotics 8, migration 7, water 4, infrastructure 4, diplomacy 3, financial_markets 3, sanctions 2, population 1).

## Three-tier ingestion (unchanged)
1. `lril-ingest` /30min — GDELT thematic + GDACS + USGS + EONET + RSS + Google News (+ ReliefWeb if appname configured)
2. `lril-country-sweep` /30min — 20 lowest-coverage countries per run
3. `lril-process` /30min @ +5min — detect → fuzzy geo → cluster → confidence → bridge

## Live state (post-v12, 24h window)
- Geo entities: **9,729** across **245 countries** (was 882/195)
- LRIL events created: **782** (avg confidence **0.658**, 19 domains)
- LRIL bridged to normalized_events: **772**
- LRIL rows in normalized_events: **1,510** of 1,784 total (85% of all normalized intel is LRIL-sourced)
- Countries covered: **181 of ~211**
- Geo-resolved (entity match): 90 (~11.5% — improvement expected over next 24h as denser entities cycle through fuzzy resolver)
- NULL iso3 in normalized_events: 58 of 1,784 (**3.3%**, was 11.3%)

## Known remaining gaps (v12)
- **Geo-resolution lag** — corpus is now planet-wide but only fresh signals (post-seed) benefit. Expect 25–35% sub-national rate within 48h as cron cycles re-process the backlog.
- **ReliefWeb dormant** — user can set `RELIEFWEB_APPNAME` secret after registering at https://apidoc.reliefweb.int/parameters#appname.
- **Source dominance** — top sources are language-specific media (storm.mg/jpost/163.com); a UN/HRW/AI/AP wire feed would lift severity tier. Optional v13.

## Confidence formula (v10, unchanged)
`lril_compute_confidence`: source_count base 0.40, keyword_strength weight 0.25, geo floor 0.35. Single strong-keyword ⇒ ≥0.42; 2 sources ⇒ ≥0.50; 3+ tier-B sources ⇒ ≥0.70. Bridge threshold 0.35.
