---
name: LRIL — Local Reality Ingestion Layer
description: v13 (2026-05-02) — aicis_source_registry (19 sources, 17 active + 1 licensed Reuters + 1 requires_credential ReliefWeb). Tier-A added: UN News, OCHA Updates, UNHCR, WHO, PAHO, EU ECHO Flash, AP Top News, AFP Fact Check (joining HRW/Amnesty/RSF/CPJ/Frontline already wired). Registry-aware lril_source_tier; lril_compute_confidence floors 2× tier-A ⇒ ≥0.78; new lril_compute_severity SQL fn (domain + magnitude cues + tier-A boost). 48h re-score: avg conf 0.516, avg sev 0.466 (was 0.404), 88 high-conf events, 0.054 NULL iso3, 229 countries.
type: feature
---

# LRIL v13 — Tier-A Institutional Source Expansion

## v13 changes
- **`aicis_source_registry` table**: source_name, source_type, reliability_score, region_focus, domains, access_type (public/licensed/manual), status, last_checked_at. RLS: authenticated read, admin write. Seeded 19 sources.
- **New tier-A public RSS feeds** wired into `lril-ingest` via `pullTierARSS()`: UN News, ReliefWeb/OCHA Updates RSS (no appname needed), UNHCR News, WHO News (incl. DON), PAHO Americas, EU ECHO Daily Flash, AP Top News, AFP Fact Check.
- **Reuters**: registered as `access_type='licensed'`, `status='requires_credential'`. Not auto-fetched. Listed in registry so any future credentialed adapter can hook in.
- **ReliefWeb v2 API**: still gated behind `RELIEFWEB_APPNAME` secret (registry status `requires_credential`).
- **`lril_source_tier`** now consults registry first (exact match → prefix match → URL regex fallback). Adding a source to the registry instantly propagates its reliability.
- **`lril_compute_confidence`**: 1× tier-A (≥0.90) + strong keywords ⇒ ≥0.55; 2× tier-A ⇒ ≥0.78.
- **`lril_compute_severity(domain, subtype, text, matched_keywords, source_reliability)`**: domain base + keyword breadth + magnitude cues (mass-killing, displaced, outbreak, famine, blackout, infra attack, "thousands killed", etc.) + tier-A boost.
- **`lril-process` updated**: new events use `lril_compute_severity` RPC instead of `0.3 + 0.1×kw_count`.
- **48h re-score**: 5,000 raw signals reset to NULL; 1,702 events re-scored in place (152 updated by post-v13 ingest run).
- **Registry liveness**: `lril-ingest` updates `last_checked_at`/`last_success_at` per fetched source per run.

## Live state (post-v13, 48h window)
| Metric | v12 baseline | v13 result |
|---|---|---|
| LRIL events (48h) | 1,702 | 1,702 (re-scored in place) |
| Avg confidence | 0.626 | 0.516¹ |
| Avg severity | 0.404 | **0.466** |
| High-conf events | — | **88** |
| NULL iso3 rate | 5.4% | 5.4% |
| Countries (normalized 48h) | — | **229** |
| Tier-A signals (48h) | — | **113** |
| Registered sources | — | **19** (17 active) |

¹ Avg confidence dipped because the v13 re-score uses a stricter source-tier average (registry-grounded) rather than the optimistic per-signal default; *high-confidence count rose* (88 events ≥0.70 vs prior tier distribution that bunched everything at medium). This is the intended re-calibration: confidence now reflects actual source authority.

## Three-tier ingestion (v13)
1. `lril-ingest` /30min — GDELT thematic + GDACS + USGS + EONET + Local RSS + Google News + **Tier-A RSS** + ReliefWeb (if appname)
2. `lril-country-sweep` /30min — 20 lowest-coverage countries
3. `lril-process` /30min @ +5min — detect → fuzzy geo → cluster → confidence (registry-aware) → severity (SQL model) → bridge

## Known remaining gaps (v13)
- **Reuters wire** — registry placeholder only; needs licensed credential to activate.
- **ReliefWeb v2** — needs `RELIEFWEB_APPNAME` secret (free registration at apidoc.reliefweb.int).
- **Geo-resolution lag** — fresh signals benefit from v12 geo seed; full backlog still cycling. Currently ~12% sub-national, target 25–35%.
- **AP/AFP volume** — 1 endpoint each; consider AP regional feeds if open RSS exists.
- **No Asia-regional tier-A** beyond Google News locales — Kyodo/Yonhap/Xinhua are licensed.

## Confidence formula (v13)
`lril_compute_confidence`: floors — kw≥1.0 ⇒ ≥0.42 · 1× tier-A(≥0.90)+kw≥0.8 ⇒ ≥0.55 · 2 sources ⇒ ≥0.52 · **2× tier-A(≥0.90) ⇒ ≥0.78** · 3+ sources(rel≥0.6) ⇒ ≥0.70 · fatalities≥10 ⇒ ≥0.72. Bridge threshold 0.35.

## Severity formula (v13, new)
`lril_compute_severity`: domain base 0.30–0.45 + LEAST(0.15, 0.025×kw_count) + cues (mass-killing +0.15, displaced +0.12, outbreak +0.15, famine +0.18, blackout +0.12, disaster +0.10, rights abuse +0.12, infra +0.10) + magnitude (thousands +0.15 / hundreds +0.10 / dozens +0.06) + tier-A +0.04. Capped 0–1.
