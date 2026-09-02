-- AICIS Migration Restore Verification v1
-- READ ONLY. No DDL, DML, cron changes, function invocation, export, or model training.
--
-- Purpose:
--   Verify an ISOLATED restore of the Lovable Cloud export before any cutover.
--   This script is intentionally fail-closed: missing critical relations or
--   inconsistent history must be treated as a migration failure, not guessed away.
--
-- Current migration evidence (2026-09-02):
--   - main Lovable dump preserved independently in Google Drive;
--   - source and independent copy sizes: 5,054,844,111 bytes;
--   - Lovable support confirmed public.community_metrics was EXCLUDED from the
--     main dump because of its size;
--   - community_metrics must therefore be restored separately and verified
--     against a source manifest before the migration can be considered complete.

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
--    IMPORTANT: this query must only be accepted after Lovable supplies the
--    source-table manifest (total rows + min/max captured_at + chunk checksums).
-- ---------------------------------------------------------------------------
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

-- Duplicate IDs should be impossible when the original PK is intact. This also
-- detects bad CSV/chunk assembly if data was staged before constraints.
SELECT
  id,
  COUNT(*) AS copies
FROM public.community_metrics
GROUP BY id
HAVING COUNT(*) > 1
ORDER BY copies DESC, id
LIMIT 100;

-- ---------------------------------------------------------------------------
-- F. community_metrics referential-integrity gate
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*) FILTER (
    WHERE cm.region_id IS NOT NULL AND ar.id IS NULL
  ) AS orphan_region_ids,
  COUNT(*) FILTER (
    WHERE cm.reporter_node_id IS NOT NULL AND an.id IS NULL
  ) AS orphan_reporter_node_ids
FROM public.community_metrics cm
LEFT JOIN public.admin_regions ar ON ar.id = cm.region_id
LEFT JOIN public.accountability_nodes an ON an.id = cm.reporter_node_id;

-- ---------------------------------------------------------------------------
-- G. community_metrics coverage profile
--    Compare these outputs to the source manifest. Differences are migration
--    failures unless explicitly explained by a documented snapshot boundary.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- H. L0 current-state consistency signal
--    This is diagnostic, not a reconstruction rule. Historical rows must never
--    be deleted merely because current state is compact.
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*) AS current_state_rows,
  COUNT(DISTINCT region_id) AS current_state_regions,
  COUNT(DISTINCT indicator_key) AS current_state_indicators,
  MIN(last_changed_at) AS earliest_state_change,
  MAX(last_changed_at) AS latest_state_change,
  MAX(updated_at) AS latest_state_update
FROM public.community_metric_state;

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
  pg_total_relation_size(format('public.%I', w.table_name)::regclass) AS total_bytes
FROM wanted w
LEFT JOIN pg_stat_user_tables s
  ON s.schemaname = 'public' AND s.relname = w.table_name
WHERE to_regclass(format('public.%I', w.table_name)) IS NOT NULL
ORDER BY total_bytes DESC NULLS LAST, w.table_name;

-- ---------------------------------------------------------------------------
-- J. Auth-preservation visibility gate
--    Password credentials may not be transferable, but user identity rows/UIDs
--    must be reconciled deliberately rather than silently duplicated.
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*) AS auth_users,
  MIN(created_at) AS earliest_auth_user,
  MAX(created_at) AS latest_auth_user
FROM auth.users;

-- ---------------------------------------------------------------------------
-- K. Final manual acceptance conditions (all required)
-- ---------------------------------------------------------------------------
-- [ ] Main dump restore completed without unexplained pg_restore errors.
-- [ ] Main dump server-side checksum/format/snapshot metadata recorded.
-- [ ] community_metrics separate export manifest received from Lovable.
-- [ ] Every community_metrics chunk checksum verified before import.
-- [ ] community_metrics total row count equals source manifest total.
-- [ ] earliest/latest captured_at equal source manifest boundaries.
-- [ ] no duplicate IDs introduced by chunk assembly.
-- [ ] no orphan region_id or reporter_node_id references introduced.
-- [ ] high-value historical/training assets inventoried.
-- [ ] Auth identities reconciled without accidental duplicate users.
-- [ ] Storage object bytes separately inventoried/migrated.
-- [ ] Edge Functions, secrets, scheduled jobs and Auth configuration reconciled.
-- [ ] Lovable production remains untouched until all acceptance gates pass.
-- [ ] aicis-production remains untouched until isolated restore proof passes.
