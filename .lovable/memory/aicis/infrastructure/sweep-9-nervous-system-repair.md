---
name: Sweep #9 Nervous System Repair
description: Entity link backfill engine + ISO3 normalizer + /data-integrity dashboard surfacing live G7-grade integrity score
type: feature
---
Closes the "knowledge graph leak" where 269K events (63%) and 135K metrics had no entity_event_links / entity_metric_links rows.

**SQL surface (public schema, all SECURITY DEFINER except integrity view):**
- `f_normalize_iso3(text)` — IMMUTABLE INVOKER; maps dirty codes (ENG→GBR, NIG→NGA, IRA→IRN, SIN→SGP, MAL→MYS, LIB→LBY, LAT→LVA, GUI→GIN, CHI→CHN, JAP→JPN, GER→DEU) and returns NULL for continent tags (EUROPE/ASIA/Global)
- `f_backfill_event_links_by_entity(batch)` — fills entity_event_links from normalized_events.entity_id
- `f_backfill_event_links_by_iso3(batch)` — fills via canonical_entities country join
- `f_backfill_metric_links_by_iso3(batch)` — same for normalized_metrics
- `f_force_missing_snapshots()` — inserts placeholder country_performance_snapshots for canonical countries lacking a 7-day fresh snapshot
- `f_data_integrity_snapshot()` (SECURITY INVOKER, authenticated only) — returns 8 checks: event/metric link completeness, iso3 cleanliness, country coverage, ingestion/h, snapshot freshness h, ER freshness h with severity ok/warn/critical
- `v_data_integrity_snapshot` view (security_invoker=on, authenticated only)

**Crons (pg_cron):**
- `sweep9-bf-ev-entity` `*/5 * * * *` batch 3000
- `sweep9-bf-ev-iso3` `1-59/5 * * * *` batch 3000
- `sweep9-bf-met-iso3` `2-59/5 * * * *` batch 3000
- `sweep9-force-missing-snapshots` `17 */6 * * *`
- Legacy crons (`backfill-event-entity-iso3-5min`, `backfill-metric-entity-iso3-1min`, `planetary-metric-entity-links`) update `normalized_events.entity_id` / call edge function — they fill the FK column, NOT the link tables. Both layers needed.

**UI:** /data-integrity (Protected route, lazy-loaded in App.tsx). PanelBoundary-wrapped cards, 30s React Query refetchInterval, trust score = (ok + 0.5×warn) / total.

**Known limitation:** ~260K orphan events from `internal:global_signals` have NULL iso3 + NULL entity_id; they require NLP title/description resolution (out of Sweep #9 scope). Sweep #9 fixes the ~9K entity_id-resolvable + ~3.6K dirty-iso3-resolvable + ~127K metric-iso3-resolvable rows.

**Baseline at sweep start:** events_orphan=269,704 (63%), metrics_orphan=135,475 (3.4%), dirty_iso3_rows=3,607, coverage_gap=33/209, snapshot_stale=22h, ER_stale=405h.
