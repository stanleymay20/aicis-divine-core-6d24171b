-- AICIS Historical Training Asset Audit v1
-- READ ONLY. No DDL, DML, cron, function invocation, export or model training.
-- Run against the historical/source AICIS database before any source retirement.
--
-- Purpose:
--   1. quantify accumulated intelligence assets;
--   2. measure temporal coverage;
--   3. identify scientifically eligible knowledge-time-proven rows;
--   4. separate raw evidence, derived intelligence and ground-truth assets;
--   5. expose gaps without converting NULL/unknown into zero.

-- ---------------------------------------------------------------------------
-- A. High-value table inventory (catalog estimates; does not scan row contents)
-- ---------------------------------------------------------------------------
WITH wanted(table_name, asset_class) AS (
  VALUES
    ('global_signals', 'raw_and_derived_signal'),
    ('normalized_events', 'raw_normalized_evidence'),
    ('normalized_metrics', 'raw_normalized_evidence'),
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
  s.n_dead_tup AS estimated_dead_rows,
  pg_total_relation_size(format('public.%I', w.table_name)::regclass) AS total_bytes,
  s.last_analyze,
  s.last_autoanalyze
FROM wanted w
LEFT JOIN pg_stat_user_tables s
  ON s.schemaname = 'public' AND s.relname = w.table_name
WHERE to_regclass(format('public.%I', w.table_name)) IS NOT NULL
ORDER BY total_bytes DESC NULLS LAST, w.table_name;

-- ---------------------------------------------------------------------------
-- B. Training dataset temporal coverage and label availability
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT country_iso3) AS countries,
  COUNT(DISTINCT domain) AS domains,
  MIN(snapshot_date) AS earliest_snapshot_date,
  MAX(snapshot_date) AS latest_snapshot_date,
  COUNT(*) FILTER (WHERE label_did_deteriorate IS NOT NULL) AS labeled_rows,
  COUNT(*) FILTER (WHERE label_did_deteriorate IS NULL) AS unlabeled_rows,
  COUNT(*) FILTER (WHERE dataset_split = 'train') AS train_rows,
  COUNT(*) FILTER (WHERE dataset_split = 'val') AS validation_rows,
  COUNT(*) FILTER (WHERE dataset_split = 'test') AS test_rows,
  COUNT(*) FILTER (WHERE dataset_split = 'unlabeled') AS explicitly_unlabeled_rows
FROM public.training_dataset_aicis;

-- ---------------------------------------------------------------------------
-- C. Knowledge-time eligibility. Only verified_leakage_safe is scientifically
--    admissible under the existing truth-floor contract.
-- ---------------------------------------------------------------------------
SELECT
  knowledge_time_status,
  COUNT(*) AS rows,
  MIN(snapshot_date) AS earliest_snapshot_date,
  MAX(snapshot_date) AS latest_snapshot_date,
  COUNT(*) FILTER (WHERE label_did_deteriorate IS NOT NULL) AS labeled_rows,
  COUNT(*) FILTER (
    WHERE knowledge_time_status = 'verified_leakage_safe'
      AND historical_cutoff_at IS NOT NULL
      AND knowledge_time_proof_version IS NOT NULL
      AND knowledge_time_proof_sha256 ~ '^[0-9a-f]{64}$'
      AND knowledge_time_verified_at IS NOT NULL
      AND knowledge_time_verification_method IS NOT NULL
  ) AS rows_with_complete_proof_shape
FROM public.training_dataset_aicis
GROUP BY knowledge_time_status
ORDER BY knowledge_time_status;

-- ---------------------------------------------------------------------------
-- D. Eligible state-transition corpus by horizon/domain.
--    Do not infer missing labels or missing knowledge-time proof.
-- ---------------------------------------------------------------------------
SELECT
  horizon_days,
  domain,
  COUNT(*) AS eligible_rows,
  COUNT(DISTINCT country_iso3) AS countries,
  MIN(snapshot_date) AS earliest_snapshot_date,
  MAX(snapshot_date) AS latest_snapshot_date,
  AVG(label_did_deteriorate::numeric) AS observed_positive_rate
FROM public.ml_training_rows_knowledge_time_eligible_v3
WHERE label_did_deteriorate IS NOT NULL
GROUP BY horizon_days, domain
ORDER BY horizon_days, eligible_rows DESC, domain;

-- ---------------------------------------------------------------------------
-- E. Raw evidence temporal coverage. These are evidence observations, not labels.
-- ---------------------------------------------------------------------------
SELECT
  'global_signals' AS dataset,
  COUNT(*) AS rows,
  MIN(COALESCE(ingested_at, created_at)) AS earliest_known_record_time,
  MAX(COALESCE(ingested_at, created_at)) AS latest_known_record_time,
  COUNT(DISTINCT category) AS distinct_domains
FROM public.global_signals
UNION ALL
SELECT
  'normalized_events',
  COUNT(*),
  MIN(created_at),
  MAX(created_at),
  COUNT(DISTINCT category)
FROM public.normalized_events
UNION ALL
SELECT
  'normalized_metrics',
  COUNT(*),
  MIN(created_at),
  MAX(created_at),
  COUNT(DISTINCT domain)
FROM public.normalized_metrics;

-- ---------------------------------------------------------------------------
-- F. Forecast/outcome corpus. A forecast is not training truth until an outcome
--    exists and was validated after the forecast was created.
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_forecasts,
  COUNT(*) FILTER (WHERE fgt.forecast_id IS NOT NULL) AS forecasts_with_ground_truth,
  COUNT(*) FILTER (
    WHERE fgt.forecast_id IS NOT NULL
      AND fgt.validated_at > pf.created_at
      AND NULLIF(btrim(fgt.realized_outcome), '') IS NOT NULL
  ) AS temporally_valid_ground_truth_pairs,
  MIN(pf.created_at) AS earliest_forecast,
  MAX(pf.created_at) AS latest_forecast,
  MIN(fgt.validated_at) FILTER (WHERE fgt.forecast_id IS NOT NULL) AS earliest_validation,
  MAX(fgt.validated_at) FILTER (WHERE fgt.forecast_id IS NOT NULL) AS latest_validation
FROM public.predictive_forecasts pf
LEFT JOIN public.forecast_ground_truth fgt
  ON fgt.forecast_id = pf.id;

-- ---------------------------------------------------------------------------
-- G. Existing immutable training manifests. Legacy/unverified manifests are
--    retained for audit but must not be silently upgraded to scientific proof.
-- ---------------------------------------------------------------------------
SELECT
  knowledge_time_status,
  COUNT(*) AS manifest_rows,
  COUNT(DISTINCT training_run_id) AS training_runs,
  COUNT(*) FILTER (
    WHERE knowledge_time_status = 'verified_leakage_safe'
      AND historical_cutoff_at IS NOT NULL
      AND knowledge_time_proof_version IS NOT NULL
      AND knowledge_time_proof_sha256 ~ '^[0-9a-f]{64}$'
  ) AS manifest_rows_with_complete_knowledge_time_proof
FROM public.ml_model_training_manifest_rows
GROUP BY knowledge_time_status
ORDER BY knowledge_time_status;

-- ---------------------------------------------------------------------------
-- H. Training-data density by calendar month. Useful for deciding whether a
--    temporal model has enough longitudinal depth for honest backtesting.
-- ---------------------------------------------------------------------------
SELECT
  date_trunc('month', snapshot_date::timestamptz)::date AS month,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE label_did_deteriorate IS NOT NULL) AS labeled_rows,
  COUNT(*) FILTER (WHERE knowledge_time_status = 'verified_leakage_safe') AS leakage_safe_rows,
  COUNT(DISTINCT country_iso3) AS countries,
  COUNT(DISTINCT domain) AS domains
FROM public.training_dataset_aicis
GROUP BY 1
ORDER BY 1;
