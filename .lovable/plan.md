## Phase 16.2 — Source Quality + Routing Precision Hardening

### Step 1: Database Schema Extensions
**Migration** to add:
- New columns on `global_signals`: `official_source`, `canonical_source_name`, `source_rank_score`, `event_cluster_id`, `enrichment_status` (pending/enriched/failed), `enrichment_attempts`, `enrichment_error`, `ingested_at`, `enriched_at`, `routed_at`, `official_source_present`, `merged_source_count`, `routing_score`, `routing_suppressed_reason`
- New table `routing_threshold_config`: configurable routing rules (min_impact, min_confidence, trust_floor, official_boost, multi_source_boost, misinfo_penalty)
- New table `signal_quality_metrics_daily`: daily aggregated routing precision stats
- New table `source_connector_runs`: tracks each ingestion run per source (success/fail, duration, signal count)
- Extend `source_trust_scores` with `official_source` boolean, `country_jurisdiction`
- Seed additional Tier 1/2 official sources (WHO, CDC, Fed, ECB, CISA, etc.)

### Step 2: Ingestion/Enrichment Split
- **`ingest-global-signals`** becomes Stage 1 (fast intake): fetch, normalize, dedup, write as `pending_enrichment`, return quickly
- **New `enrich-global-signals`** edge function as Stage 2: picks pending signals, runs AI classification, scoring, recommendations, updates status to `enriched`
- Schedule enrichment to run every 2 minutes via pg_cron

### Step 3: Source Preference + Event Merging
- Upgrade dedup/merge logic with source rank preference
- Canonical source selection: official > Tier 1 > Tier 2 > recency
- Event cluster ID assignment for related signals
- Merged source count tracking

### Step 4: Routing Precision Metrics
- Build `useRoutingPrecision` hook querying `signal_routing_feedback` aggregates
- Create `RoutingPrecisionPanel` component showing confirm/reject/unclear rates by category and tier
- Add daily metric snapshots via the enrichment function

### Step 5: Threshold Tuning
- Seed default routing thresholds in `routing_threshold_config`
- Apply configurable rules in enrichment: impact >= X, confidence >= Y, trust floor, boosts/penalties
- Make thresholds inspectable in /live

### Step 6: /live UI Hardening
- Official source badge on SignalCard
- Enrichment status indicator (pending/enriched)
- Canonical source display
- Routing precision summary in header
- Ingestion/enrichment health timestamps
- Degraded-mode warning banner

### Step 7: Operational Monitoring
- Source connector run history panel
- Enrichment queue depth indicator
- Stale source warnings

### Files to create/edit:
- Migration SQL
- `supabase/functions/enrich-global-signals/index.ts` (new)
- `supabase/functions/ingest-global-signals/index.ts` (simplify to fast intake)
- `src/hooks/useRoutingPrecision.ts` (new)
- `src/components/live/RoutingPrecisionPanel.tsx` (new)
- `src/components/live/SignalCard.tsx` (badges)
- `src/components/live/SignalDetailPanel.tsx` (enrichment info)
- `src/pages/LiveCommandFeed.tsx` (health indicators)
- `src/hooks/useGlobalSignals.ts` (enrichment status helpers)
