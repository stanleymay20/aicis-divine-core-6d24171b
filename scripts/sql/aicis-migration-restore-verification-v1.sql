-- AICIS Migration Restore Verification v1
-- READ ONLY. No DDL, DML, cron changes, application-function invocation, export,
-- writer activation, or model training.
--
-- Run with psql and ON_ERROR_STOP=1. Client-side \if gates allow the main dump
-- to be audited before community_metrics arrives while preserving an explicit
-- BLOCKED result for migration completeness.
--
-- Purpose:
--   Verify an ISOLATED restore of the Lovable Cloud export before any cutover.
--   This script is intentionally fail-closed: missing critical relations or
--   inconsistent history must be treated as a migration failure/blocker, not
--   guessed away or converted into synthetic zeroes.
--
-- Current migration evidence (2026-09-07):
--   - main Lovable dump preserved independently in Google Drive;
--   - source and independent copy sizes were reported as 5,054,844,111 bytes;
--   - Stanley-owned Drive object currently records 5,054,844,111 bytes;
--   - Lovable support confirmed public.community_metrics was EXCLUDED from the
--     main dump because of its size;
--   - community_metrics must therefore be restored separately and verified
--     against a source manifest before the migration can be considered complete.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- A. Restore environment identity
-- ---------------------------------------------------------------------------
SELECT
  current_database() AS database_name,
  current_user AS connected_role,
  current_setting('server_version') AS postgres_version,
  current_setting('TimeZone') AS timezone,
  now() AS verification_started_at;

-- ---------------------------------------------------------------------------
-- B. Object inventory after restore
-- ---------------------------------------------------------------------------
SELECT
  n.nspname AS schema_name,
  COUNT(*) FILTER (WHERE c.relkind = 'r') AS tables,
  COUNT(*) FILTER (WHERE c.relkind = 'p') AS partitioned_tables,
  COUNT(*) FILTER (WHERE c.relkind = 'v') AS views,
  COUNT(*) FILTER (WHERE c.relkind = 'm') AS materialized_views,
  COUNT(*) FILTER (WHERE c.relkind = 'S') AS sequences,
  COUNT(*) FILTER (WHERE c.relkind = 'f') AS foreign_tables
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
GROUP BY n.nspname
ORDER BY n.nspname;

SELECT
  n.nspname AS schema_name,
  COUNT(*) AS functions
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
GROUP BY n.nspname
ORDER BY n.nspname;

SELECT
  schemaname,
  COUNT(*) AS rls_policies
FROM pg_policies
GROUP BY schemaname
ORDER BY schemaname;

SELECT
  event_object_schema AS schema_name,
  COUNT(*) AS trigger_count
FROM information_schema.triggers
GROUP BY event_object_schema
ORDER BY event_object_schema;

-- ---------------------------------------------------------------------------
-- C. Critical AICIS relation presence gate
-- ---------------------------------------------------------------------------
WITH critical(table_name, asset_class) AS (
  VALUES
    ('admin_regions', 'geographic_reference'),
    ('accountability_nodes', 'identity_reference'),
    ('community_metrics', 'l0_longitudinal_history'),
    ('community_metric_state', 'l0_current_state'),
    ('urban_metrics', 'l1_rollup'),
    ('country_performance_snapshots', 'l2_rollup'),
    ('regional_insights', 'l3_rollup'),
    ('global_signals', 'raw_and_derived_signal'),
    ('normalized_events', 'raw_normalized_evidence'),
    ('normalized_metrics', 'raw_normalized_evidence'),
    ('training_dataset_aicis', 'derived_training_candidate'),
    ('predictive_forecasts', 'derived_forecast'),
    ('forecast_ground_truth', 'ground_truth'),
    ('forecast_validation_events', 'ground_truth_support'),
    ('ml_model_training_manifest_rows', 'immutable_training_manifest'),
    ('ml_model_training_runs', 'training_run_audit')
)
SELECT
  c.asset_class,
  c.table_name,
  to_regclass(format('public.%I', c.table_name)) IS NOT NULL AS present
FROM critical c
ORDER BY c.asset_class, c.table_name;

-- Capture safe relation-presence booleans for later psql client-side gates.
SELECT
  to_regclass('public.community_metrics') IS NOT NULL AS has_community_metrics,
  to_regclass('public.community_metric_state') IS NOT NULL AS has_community_metric_state,
  to_regclass('public.admin_regions') IS NOT NULL AS has_admin_regions,
  to_regclass('public.accountability_nodes') IS NOT NULL AS has_accountability_nodes,
  to_regclass('auth.users') IS NOT NULL AS has_auth_users
\gset aicis_

SELECT
  CASE
    WHEN to_regclass('public.community_metrics') IS NOT NULL THEN 'full_candidate_data_present'
    ELSE 'main_dump_only_blocked_pending_community_metrics'
  END AS verification_stage;

-- ---------------------------------------------------------------------------
-- D. Public-table size / estimate inventory
--    Uses catalog estimates first; exact full-table COUNTs on very large tables
--    are intentionally limited to the critical sections below.
-- ---------------------------------------------------------------------------
SELECT
  s.relname AS table_name,
  s.n_live_tup AS estimated_live_rows,
  s.n_dead_tup AS estimated_dead_rows,
  pg_relation_size(s.relid) AS heap_bytes,
  pg_indexes_size(s.relid) AS index_bytes,
  pg_total_relation_size(s.relid) AS total_bytes,
  s.last_analyze,
  s.last_autoanalyze
FROM pg_stat_user_tables s
WHERE s.schemaname = 'public'
ORDER BY total_bytes DESC, s.relname;

-- ---------------------------------------------------------------------------
-- E. community_metrics exact completeness gate
--    Runs only after the table exists. Absence is an explicit blocker, not zero.
--    The output is not accepted as complete until Lovable supplies the source
--    manifest (total rows + snapshot/time boundaries + chunk checksums).
-- ---------------------------------------------------------------------------
\if :aicis_has_community_metrics
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT id) AS distinct_ids,
  COUNT(DISTINCT country_iso3) AS countries,
  COUNT(DISTINCT domain) AS domains,
  COUNT(DISTINCT indicator_key) AS indicators,
  COUNT(DISTINCT source) AS sources,
  MIN(captured_at) AS earliest_captured_at,
  MAX(captured_at) AS latest_captured_at,
  MIN(created_at) AS earliest_created_at,
  MAX(created_at) AS latest_created_at,
  COUNT(*) FILTER (WHERE id IS NULL) AS null_ids,
  COUNT(*) FILTER (WHERE country_iso3 IS NULL OR btrim(country_iso3) = '') AS missing_country,
  COUNT(*) FILTER (WHERE domain IS NULL OR btrim(domain) = '') AS missing_domain,
  COUNT(*) FILTER (WHERE indicator_key IS NULL OR btrim(indicator_key) = '') AS missing_indicator,
  COUNT(*) FILTER (WHERE value IS NULL) AS missing_value,
  COUNT(*) FILTER (WHERE captured_at IS NULL) AS missing_captured_at,
  COUNT(*) FILTER (WHERE created_at IS NULL) AS missing_created_at
FROM public.community_metrics;

SELECT
  id,
  COUNT(*) AS copies
FROM public.community_metrics
GROUP BY id
HAVING COUNT(*) > 1
ORDER BY copies DESC, id
LIMIT 100;
\else
SELECT
  'BLOCKED' AS status,
  'public.community_metrics_not_present' AS reason,
  'main-dump verification may continue, but migration completeness cannot pass' AS consequence;
\endif

-- ---------------------------------------------------------------------------
-- F. community_metrics referential-integrity gates
--    Each reference is independently guarded so a missing reference table is
--    reported instead of aborting the rest of the read-only audit.
-- ---------------------------------------------------------------------------
\if :aicis_has_community_metrics
\if :aicis_has_admin_regions
SELECT
  COUNT(*) AS orphan_region_ids
FROM public.community_metrics cm
LEFT JOIN public.admin_regions ar ON ar.id = cm.region_id
WHERE cm.region_id IS NOT NULL
  AND ar.id IS NULL;
\else
SELECT 'BLOCKED' AS status, 'public.admin_regions_not_present' AS reason;
\endif

\if :aicis_has_accountability_nodes
SELECT
  COUNT(*) AS orphan_reporter_node_ids
FROM public.community_metrics cm
LEFT JOIN public.accountability_nodes an ON an.id = cm.reporter_node_id
WHERE cm.reporter_node_id IS NOT NULL
  AND an.id IS NULL;
\else
SELECT 'BLOCKED' AS status, 'public.accountability_nodes_not_present' AS reason;
\endif
\else
SELECT 'BLOCKED' AS status, 'community_metrics_referential_checks_pending_table_delivery' AS reason;
\endif

-- ---------------------------------------------------------------------------
-- G. community_metrics coverage profile
-- ---------------------------------------------------------------------------
\if :aicis_has_community_metrics
SELECT
  source,
  COUNT(*) AS rows,
  COUNT(DISTINCT country_iso3) AS countries,
  COUNT(DISTINCT domain) AS domains,
  MIN(captured_at) AS earliest_captured_at,
  MAX(captured_at) AS latest_captured_at
FROM public.community_metrics
GROUP BY source
ORDER BY rows DESC, source;

SELECT
  date_trunc('month', captured_at)::date AS month,
  COUNT(*) AS rows,
  COUNT(DISTINCT country_iso3) AS countries,
  COUNT(DISTINCT domain) AS domains,
  COUNT(DISTINCT indicator_key) AS indicators
FROM public.community_metrics
GROUP BY 1
ORDER BY 1;

SELECT
  country_iso3,
  domain,
  COUNT(*) AS rows,
  MIN(captured_at) AS earliest_captured_at,
  MAX(captured_at) AS latest_captured_at
FROM public.community_metrics
GROUP BY country_iso3, domain
ORDER BY rows DESC, country_iso3, domain;
\else
SELECT 'BLOCKED' AS status, 'community_metrics_coverage_profile_pending_table_delivery' AS reason;
\endif

-- ---------------------------------------------------------------------------
-- H. L0 current-state consistency signal
--    Diagnostic only. Historical rows must never be deleted merely because
--    current state is compact.
-- ---------------------------------------------------------------------------
\if :aicis_has_community_metric_state
SELECT
  COUNT(*) AS current_state_rows,
  COUNT(DISTINCT region_id) AS current_state_regions,
  COUNT(DISTINCT indicator_key) AS current_state_indicators,
  MIN(last_changed_at) AS earliest_state_change,
  MAX(last_changed_at) AS latest_state_change,
  MAX(updated_at) AS latest_state_update
FROM public.community_metric_state;
\else
SELECT 'BLOCKED' AS status, 'public.community_metric_state_not_present' AS reason;
\endif

-- ---------------------------------------------------------------------------
-- I. High-value historical/training assets after restore
-- ---------------------------------------------------------------------------
WITH wanted(table_name, asset_class) AS (
  VALUES
    ('global_signals', 'raw_and_derived_signal'),
    ('normalized_events', 'raw_normalized_evidence'),
    ('normalized_metrics', 'raw_normalized_evidence'),
    ('community_metrics', 'l0_longitudinal_history'),
    ('training_dataset_aicis', 'derived_training_candidate'),
    ('predictive_forecasts', 'derived_forecast'),
    ('forecast_ground_truth', 'ground_truth'),
    ('forecast_validation_events', 'ground_truth_support'),
    ('strategic_causal_links', 'derived_causal_graph'),
    ('weak_signal_detections', 'derived_weak_signal'),
    ('strategic_narrative_clusters', 'derived_narrative'),
    ('civilization_memory_nodes', 'derived_memory'),
    ('reinforcement_learning_events', 'derived_learning_memory'),
    ('ml_model_training_manifest_rows', 'immutable_training_manifest'),
    ('ml_model_training_runs', 'training_run_audit')
)
SELECT
  w.asset_class,
  w.table_name,
  s.n_live_tup AS estimated_live_rows,
  pg_total_relation_size(to_regclass(format('public.%I', w.table_name))) AS total_bytes,
  to_regclass(format('public.%I', w.table_name)) IS NOT NULL AS present
FROM wanted w
LEFT JOIN pg_stat_user_tables s
  ON s.schemaname = 'public' AND s.relname = w.table_name
ORDER BY present DESC, total_bytes DESC NULLS LAST, w.table_name;

-- ---------------------------------------------------------------------------
-- J. Auth-preservation visibility gate
--    Password credentials may not be transferable, but user identity rows/UIDs
--    must be reconciled deliberately rather than silently duplicated.
-- ---------------------------------------------------------------------------
\if :aicis_has_auth_users
SELECT
  COUNT(*) AS auth_users,
  MIN(created_at) AS earliest_auth_user,
  MAX(created_at) AS latest_auth_user
FROM auth.users;
\else
SELECT
  'BLOCKED' AS status,
  'auth.users_not_present_in_restore' AS reason,
  'auth identity migration requires separate reconciliation' AS consequence;
\endif

-- ---------------------------------------------------------------------------
-- K. Explicit completeness status
-- ---------------------------------------------------------------------------
\if :aicis_has_community_metrics
SELECT
  'CANDIDATE_ONLY' AS migration_completeness_status,
  'community_metrics present; source-manifest, snapshot/delta, Auth, Storage, functions, secrets and cron checks still required' AS reason;
\else
SELECT
  'BLOCKED' AS migration_completeness_status,
  'community_metrics absent by confirmed source-export omission' AS reason;
\endif

-- ---------------------------------------------------------------------------
-- L. Final manual acceptance conditions (all required)
-- ---------------------------------------------------------------------------
-- [ ] Main dump restore completed without unexplained pg_restore errors.
-- [ ] Main dump remote/local checksum, format and snapshot metadata recorded.
-- [ ] community_metrics separate export manifest received from Lovable.
-- [ ] Every community_metrics chunk checksum verified before import.
-- [ ] community_metrics total row count equals source manifest total.
-- [ ] earliest/latest captured_at equal source manifest boundaries.
-- [ ] main dump and community_metrics snapshot/delta relationship reconciled.
-- [ ] post-main-dump live Lovable writes reconciled to final cutover boundary.
-- [ ] no duplicate IDs introduced by chunk assembly.
-- [ ] no orphan region_id or reporter_node_id references introduced.
-- [ ] high-value historical/training assets inventoried.
-- [ ] Auth identities reconciled without accidental duplicate users.
-- [ ] Storage object bytes separately inventoried/migrated.
-- [ ] Edge Functions, secrets, scheduled jobs and Auth configuration reconciled.
-- [ ] Lovable production remains untouched until all acceptance gates pass.
-- [ ] aicis-production remains untouched until isolated restore proof passes.
