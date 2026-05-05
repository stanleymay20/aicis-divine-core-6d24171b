---
name: Phase 3 — Coverage Equity, Multilingual, Geo Resolution
description: Coverage floor enforcer + signal-translator + signal-geocoder edge fns; new global_signals language/geo cols; coverage_equity_log table; /coverage-equity page
type: feature
---

## Schema additions on `global_signals`
- Multilingual: `source_language`, `original_title`, `original_summary`, `translated_title`, `translated_summary`, `translation_status` (pending|translated|not_needed|failed|skipped), `translation_model`, `translated_at`.
- Geo: `geo_admin0_iso3`, `geo_admin1`, `geo_admin2`, `geo_lat`, `geo_lng`, `geo_confidence`, `geo_method` (affected_country|centroid|place_extraction|admin_match|failed), `geocoded_at`.
- Partial indexes for translation/geocode pending queues.

## `web_search_sweep_queries` additions
`language` (default 'en'), `country_iso3`, `auto_generated`, `last_run_at`, `expires_at`. Coverage enforcer dedup tuple = (query, language, country_iso3, auto_generated).

## `coverage_equity_log` table
country_iso3/name, signals_7d, floor=3, gap, language_codes[], queries_generated, status. RLS read for authenticated.

## Edge fns
- **signal-translator** (cron `*/5 * * * *`): script-range + stopword heuristic detect; non-English → Lovable AI `google/gemini-3-flash-preview` JSON translate; copies originals always; batch=60.
- **signal-geocoder** (cron `*/10 * * * *`): single-country signals → match aicis_geo_entities (city > admin2 > admin1) → fallback `admin_regions` admin_level=0 centroid; never blocks ingestion; batch=500.
- **coverage-equity-enforcer** (cron `15 4 * * *`): bottom-50 ISO3s below 3/wk canonical; LANG_HINT map per ISO3; 1 EN + 1-2 local-language sweep queries; expires +3d.

## UI
- `/coverage-equity` page: stats + latest gap table.
- LiveSignalStream: shows `translated_title` as primary, original-language `[xx]` chip + italic original line, source_language badge for non-en/und.

## Known gap
`affected_countries` is empty on most rows → geocoder marks `failed` (375/500 first run). Future work: extract ISO3 from title/summary for unattributed signals.
