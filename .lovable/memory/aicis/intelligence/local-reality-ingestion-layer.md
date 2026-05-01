---
name: LRIL — Local Reality Ingestion Layer
description: Sharp local event detection. v9 (2026-05-01) repairs the country-code bridge, schedules action recommendations every 30min, expands sub-national geo entities to 880+ rows, and adds keyword packs for water/education/supply_chain/sanctions/elections/cyber/financial_markets. Three crons: lril-ingest, lril-country-sweep, lril-process. Bridge writes iso3_normalized into normalized_events.country_iso3.
type: feature
---

# LRIL v9 — Comprehensive Pipeline Repair

## Three-tier ingestion (unchanged)
1. **`lril-ingest`** /30min — thematic GDELT + GDACS + USGS + EONET + local RSS + Google News locales
2. **`lril-country-sweep`** /30min — cycles 20 lowest-coverage countries per run; full sweep ~5h
3. **`lril-process`** /30min @ +5min — keyword detect → geo resolve → cluster → confidence → bridge

## v9 fixes (gap analysis 2026-05-01)
- **Bridge function**: now writes `coalesce(iso3_normalized, iso3)` into `normalized_events.country_iso3`. Fixed root cause of 62% NULL country codes.
- **Backfill**: existing LRIL + GDACS rows had country code populated retroactively.
- **Action cron**: `generate-risk-actions-30min` runs `generate_risk_action_recommendations(50)` at :15 and :45. Previously last run April 20 — broken since deployment.
- **Legacy disabled**: `gdelt-ingest-30min` (1 country/batch, 47-batch rotation) unscheduled — redundant with country-sweep.
- **Geo entities**: expanded from 750 → 880+ rows. Added Pacific (PNG Bulolo/Lae, Fiji, Solomon, Vanuatu, Samoa, Tonga, Kiribati, Tuvalu, Nauru, Palau, FSM, Marshall), West Africa (Guinea-Bissau, Gambia, Liberia, Côte d'Ivoire, Togo, Benin), Sahel (Mali, Burkina, Niger, Chad), Maghreb (Algeria incl Tissemsilt, Tunisia, Libya), Indian Ocean (Madagascar, Mauritius, Seychelles, Comoros), Caribbean (Haiti, Jamaica, Cuba, DR), Central Asia + Caucasus, Andes, South Asia (Sri Lanka, Nepal, Bhutan, Maldives), SE Asia (Laos, Cambodia, Timor, Brunei), Horn (Somalia, Ethiopia, Eritrea, Djibouti, Sudan, S Sudan), Central Africa (CAR, Congo, DRC incl Goma/Bukavu, Gabon, Equatorial Guinea), Southern Africa, European microstates.
- **Keyword packs**: added water (shortage, contamination), education (closure, attack_on_school), supply_chain (disruption, route_attack), sanctions, elections, cyber, financial_markets — across en/fr/es/pt/ar.

## Known remaining gaps (v9)
- **ReliefWeb HTTP 400** — endpoint v2 changed; pullReliefWeb() needs new POST body format.
- **Sub-national resolution still weak** — `geo_resolved` averages ~10% of events; cluster/fuzzy match in `lril_resolve_geo()` needs tightening.
- **Confidence skew** — 81% events still tier=low; clustering by hash dedup misses semantic title duplicates.
- **Domains under-covered** — water/education/supply_chain/sanctions/elections packs added but not yet validated against live signals.
