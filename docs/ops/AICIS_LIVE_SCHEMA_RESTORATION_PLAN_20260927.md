# AICIS live-schema restoration plan — 2026-09-27

## Authority and safety boundary

Canonical repo: `stanleymay20/aicis-divine-core-6d24171b`

Canonical Supabase project reference from `supabase/config.toml`:

```text
psonnnuhjjskrdazrakk
```

The Supabase project currently exposed to ChatGPT's connector is a different project
(`qpphncfgbhizvnovzivw`, labelled `aicis-production`) and currently contains zero
public tables/views/routines. **Do not apply AICIS migrations to that connected project.**

The live database audited by Lovable must therefore remain the only schema authority for
production restoration work.

This plan does **not** authorize a replay of the late-August migration backlog.

## Recovery doctrine

1. Observe the live schema first.
2. Restore page-critical capabilities in the smallest dependency-complete units.
3. Prefer additive/idempotent object creation.
4. Treat view replacement, scoring changes, bulk rewrites, cron changes and model semantics
   as separate controlled changes.
5. Do not mark an object restored merely because SQL executed; prove the dependent route/function.
6. Unknown data remains unknown. Never backfill fabricated values.
7. One recovery batch at a time, with rollback evidence and route verification.

## Priority 0 — frontend containment

Already implemented on `main`:
- forecast lifecycle calls now use `supabase.functions.invoke` instead of raw cross-origin fetch;
- Analyst top-risk query uses baseline columns that exist in the original table contract;
- Resolution nested-button warning removed;
- Admin organization access stays database-denied without crashing Settings;
- missing command/live-operation views render unavailable states instead of errors or synthetic activity;
- Pilot Truth missing learning views render unavailable states;
- auth session validation is deduplicated by access token to address the observed update-depth loop;
- Analyst no longer invents global confidence or source-health splits;
- landing intelligence badge no longer says live when the sanitized snapshot is unavailable.

A fresh Lovable route crawl is required to prove the refresh-loop fix.

## Priority 1 — surgical additive restores

### A. Opportunities research tracker

Missing live object:
`public.strategic_research_runs_v1`

Canonical migration:
`supabase/migrations/20260927150000_strategic_research_runs_v1.sql`

Characteristics:
- additive user-scoped table;
- RLS enabled;
- immutable action-snapshot guard;
- lifecycle timestamp trigger;
- authenticated own-row SELECT/INSERT/UPDATE only;
- no bulk data rewrite.

Dependent Edge Functions:
- `sync-strategic-research-runs`
- `update-strategic-research-run`
- `list-strategic-research-runs`
- `complete-strategic-research-actions`

Restore condition:
- verify the table is absent;
- apply the exact migration or an equivalent reviewed successor;
- deploy/verify the four functions;
- signed-in `/opportunities` must return an empty tracker rather than HTTP 500.

### B. Public landing snapshot

Missing live routine:
`public.public_intelligence_snapshot()`

Canonical source migration:
`supabase/migrations/20260825190500_security_truth_floor_and_public_snapshot.sql`

Direct dependencies used by the function:
- `country_performance_snapshots`
- `risk_ml_predictions`
- `simulation_runs`
- `ml_inference_audit`
- `risk_ranking_predictions`

Do **not** replay the whole historical migration simply to get the function.
First prove every dependency exists with compatible columns, then extract/review the current
function definition and grants as a surgical successor migration.

Restore condition:
- RPC returns sanitized data under anon/authenticated access;
- `public-intelligence` Edge Function returns 200;
- landing feed uses only returned production data.

## Priority 2 — page-critical dependency closures

### Telemetry / World / Command Center

Missing object:
`telemetry_backbone_command_view`

Historical creation / truth-floor chain:
- `20260513143000_distributed_planetary_telemetry_backbone.sql`
- `20260827215950_drop_legacy_telemetry_backbone_views_v1.sql`
- `20260827220000_telemetry_backbone_truth_floor_v1.sql`
- `20260827221000_telemetry_queue_priority_truth_floor_v2.sql`

Known dependencies include:
- `telemetry_event_bus`
- `telemetry_shard_workers`
- `telemetry_replay_checkpoints`
- `telemetry_lineage_records`
- `telemetry_priority_rules`
- `telemetry_observations`
- `telemetry_connectors`
- `telemetry_reasoning_attempts`

The Lovable audit says `telemetry_observations` and `telemetry_connectors` are also missing.
Therefore restoring only the view is invalid.

Required action:
build a dependency-complete telemetry restoration batch and prove it on staging/transactionally
before production.

### Intervention governance / Command Center

Missing object:
`intervention_governance_command_view`

Historical chain:
- `20260513170000_intervention_governance_safety_layer.sql`
- `20260828051900_drop_legacy_intervention_views_v1.sql`
- `20260828052000_intervention_governance_epistemic_truth_floor_v1.sql`

Known dependencies include:
- `intervention_simulations`
- `intervention_safety_policies`
- `intervention_approval_workflows`
- `intervention_safety_evaluations`
- `intervention_human_review_queue`
- `coordination_response_plans`
- `intervention_outcome_ledger`
- `planetary_propagation_events`

Do not restore the view until its base relations and current epistemic semantics are present.

### Executive insights / Command Center

Missing object:
`executive_planetary_insights_view`

Historical source:
- `20260513110000_executive_planetary_dashboard_layer.sql`
- later operational-reporting migration `20260513190000_executive_briefing_and_operational_reporting.sql`

Known dependencies include:
- `global_signals`
- `global_telemetry_coverage_command_view`
- `predictive_forecasts`
- `institutional_trust_scorecards`
- `analyst_review_queue`
- `intervention_recommendations`
- executive snapshot/cache/action tables created by that layer.

This must be restored only after the upstream coverage/forecast/trust/review contracts are verified.

### Pilot Truth learning

Missing object:
`risk_action_learning_leaderboard`

Historical source:
`20260502091916_2045d797-62af-4979-a8e8-3bfb83e4f64e.sql`

Known dependencies include:
- `risk_action_recommendations`
- `decision_outcome_log`
- `recommendation_quality_score`
- `risk_action_performance_summary`
- `risk_action_score_adjustments`

This is a smaller closure than the telemetry/intervention stacks. Verify base relations and current
learning semantics, then restore the views/table/function as one reviewed learning batch.

## Priority 3 — operational observability

Examples from the Lovable audit:
- `operational_source_health_view`
- `operational_incident_command_view`
  - historical source: `20260515_operational_hardening.sql`
- `validation_trust_command_view`
  - historical source: `20260516_corroboration_and_drift_validation.sql`
- `v_analyst_review_console`
  - historical source: `20260512_temporal_trace_anomaly_response_analyst_workflows.sql`

Restore only after the page-critical batches above unless one becomes a dependency.

## Priority 4 — remaining missing cognitive/model/graph/SC objects

The remaining objects in the 108-object Lovable audit include model execution, graph governance,
cognitive hypotheses, world graph, SC ledger/wallet/emissions, ML training, abstention ledgers,
telemetry/observability and related routines.

They must be classified before application into:
- additive schema;
- view/function replacement;
- semantic/scoring change;
- data backfill/rewrite;
- cron/scheduler change;
- obsolete/superseded;
- dependency only.

No object in this class should be created merely because application code references it.

## Live-schema probe

Run the read-only probe in:
`docs/ops/sql/aicis_live_schema_probe_20260927.sql`

Save the complete output as production evidence before applying any restore batch.

## Batch acceptance contract

For every production restore batch capture:
- pre-change object existence and definitions;
- exact SQL SHA-256 / repo commit;
- dependency proof;
- transaction/rollback plan;
- post-change object definitions;
- RLS/grant proof where relevant;
- affected Edge Function smoke test;
- affected signed-in route smoke test;
- scheduler impact;
- row-count/data-freshness comparison;
- error-rate comparison.

A batch is not accepted merely because SQL returned success.

## Scheduler backlog — separate from schema restoration

Do not combine scheduler repair with schema restoration.

Open scheduler defects from the Lovable audit:
- `refresh-quantivis-mvs-hourly` timeout;
- `check-accumulation-health` timeout;
- `sgi-cross-domain-influence` timeout;
- ~115 HTTP jobs do not set a reply timeout, causing the scheduler to stop waiting at ~5 seconds;
- ~330 calls/hour therefore have unknown outcomes;
- 17 HTTP failures serialize as `[object Object]`.

These require a separate scheduler-observability change set after route/schema stabilization.
