## Phase 16.2 — Source Quality + Routing Precision Hardening

### Objective
Harden the Global Signal Engine for commercial trust by improving source quality, splitting ingestion/enrichment, adding routing precision metrics, and making thresholds configurable.

### Completed
1. **Database**: Extended `global_signals` with enrichment pipeline fields (enrichment_status, ingested_at, enriched_at, routed_at, official_source, canonical_source_name, source_rank_score, routing_score, routing_suppressed_reason). Created `routing_threshold_config`, `source_connector_runs`, `signal_quality_metrics_daily` tables. Seeded 24 additional official/institutional sources (WHO, CDC, Federal Reserve, ECB, IMF, CISA, NATO, etc.).
2. **Ingestion/Enrichment Split**: Refactored `ingest-global-signals` to fast intake (1.3s avg) — no AI, just fetch/dedup/write. Created `enrich-global-signals` edge function for async AI classification/scoring (15s). Scheduled enrichment every 2 minutes via pg_cron.
3. **Source Preference**: Canonical source selection prefers official > Tier 1 > Tier 2. Source rank scoring. Merged source count tracking. Official source badges.
4. **Routing Precision**: Configurable threshold rules in `routing_threshold_config`. Routing score calculation with official boost, multi-source boost, misinfo penalty. Suppression reasons tracked. `RoutingPrecisionPanel` component with confirm/reject/unclear rates by category and tier.
5. **UI Hardening**: Official source badges, enrichment status indicators, canonical source display, routing info in detail panel, engine health metrics, pending enrichment count, staleness warnings for both ingestion and enrichment.
6. **Operational Monitoring**: `source_connector_runs` logging per source. Enrichment queue depth. Failed run tracking. Last ingest/enrich timestamps.

### Key Results
- Intake: 1.3s (previously timed out)
- Enrichment: 15.4s (async, non-blocking)
- 7 signals ingested, all enriched with routing decisions
- Low-impact signals correctly suppressed with reasons
- Connector run health logged
