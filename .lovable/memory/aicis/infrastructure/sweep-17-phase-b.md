---
name: Sweep 17 — Phase B Trust Drain
description: Authority ingestion, citation backfill, knowledge-graph population, and historical ledger back-chaining via batched cron drains
type: feature
---

## Critical fix discovered
`public.ledger_append()` was silently failing since Sweep 15 because its `search_path` was `public` only — `digest()` lives in `extensions`. All warning/recommendation ledger writes returned NULL via the EXCEPTION handler and the chain stayed empty for those entry_types. Fixed to `SET search_path = public, extensions` and cast input to `ledger_entry_type` enum explicitly.

## Builders (all idempotent, batched)
- `phase_b_build_kg_links(batch)` — adjacency_v3 → entity_links (`trades_in`/`borders`) + entity_link_provenance. ON CONFLICT DO NOTHING against `(source_entity_id, target_entity_id, link_type)` unique index.
- `phase_b_backfill_citations(subject_type, batch)` — lateral-joins to `global_signals` filtered by `affected_countries @> ARRAY[iso3]` + time window. Auto-registers unseen publishers as tier-4 media (one-time seed at migration; per-call upsert removed).
- `phase_b_backchain_ledger(source_table, batch)` — for-loop `ledger_append()` per row; marks payload with `backchain: true`. Handles aicis_early_warnings/risk_action_recommendations/risk_ranking_predictions.

## Seeds
- 247 country `entity_identifiers` (scheme=`iso3`) keyed off canonical_country_list.id.
- 20 international orgs (IMF, WB, WHO, UN, OECD, BIS, ECB, Fed, BoE, BoJ, PBoC, IAEA, OPEC, NATO, EU, WTO, FAO, UNHCR, OCHA, ICAO) with scheme `lei` or `org_key`.
- All distinct publishers from global_signals registered in source_authority_registry (tier 4 media default).

## Performance unlock
GIN index `idx_global_signals_affected_countries_gin` on `global_signals(affected_countries)`. Citation backfill before: 60s timeout per 50 rows. After: 200 rows/batch in <2s.

## pg_cron drains
| Job | Cadence | Batch |
|---|---|---|
| phase_b_kg_links | */2 min | 500 |
| phase_b_citations_warnings | */3 min | 300 |
| phase_b_citations_recs | */3 min | 300 |
| phase_b_ledger_warnings | */4 min | 200 |
| phase_b_ledger_recs | */4 min | 200 |
| phase_b_ledger_rankings | */4 min | 200 |

Expected full drain: ~6–12h depending on global_signals lateral join cost.

## Operator view
`public.phase_b_progress` (security_invoker, granted to anon/authenticated). Returns rows + pct per track. Read from `/federation-admin` or any SQL client.
