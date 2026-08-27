-- AICIS Atomic ML Training Manifest Snapshot v1
--
-- Freezes the exact eligible modelling rows for one running training attempt in
-- one database transaction. The trainer reads only this immutable manifest.
-- No geographic/network neighbour feature is included until AICIS has a
-- verified adjacency definition.

CREATE OR REPLACE FUNCTION public.prepare_ml_training_manifest(
  p_training_run_id uuid,
  p_horizon_days integer,
  p_feature_version text DEFAULT 'truth-floor-v2',
  p_split_strategy text DEFAULT 'chronological_distinct_date_60_20_20_v2'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_run_horizon integer;
  v_total_candidates integer := 0;
  v_eligible integer := 0;
  v_train integer := 0;
  v_val integer := 0;
  v_test integer := 0;
  v_train_positive integer := 0;
  v_val_positive integer := 0;
  v_test_positive integer := 0;
  v_manifest_checksum text;
  v_missing_core integer := 0;
  v_missing_event_severity integer := 0;
  v_missing_feature_hash integer := 0;
BEGIN
  IF p_training_run_id IS NULL THEN
    RAISE EXCEPTION 'p_training_run_id is required';
  END IF;
  IF p_horizon_days IS NULL OR p_horizon_days < 1 OR p_horizon_days > 90 THEN
    RAISE EXCEPTION 'p_horizon_days must be between 1 and 90';
  END IF;

  SELECT status, horizon_days
  INTO v_status, v_run_horizon
  FROM public.ml_model_training_runs
  WHERE id = p_training_run_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'training run % does not exist', p_training_run_id;
  END IF;
  IF v_status <> 'running' THEN
    RAISE EXCEPTION 'training run % is %, not running', p_training_run_id, v_status;
  END IF;
  IF v_run_horizon <> p_horizon_days THEN
    RAISE EXCEPTION 'training run horizon % does not match requested horizon %', v_run_horizon, p_horizon_days;
  END IF;

  -- A retry is allowed only while the run is still running.
  DELETE FROM public.ml_model_training_manifest_rows
  WHERE training_run_id = p_training_run_id;

  SELECT COUNT(*)::integer
  INTO v_total_candidates
  FROM public.training_dataset_aicis t
  WHERE t.horizon_days = p_horizon_days
    AND t.feature_version = p_feature_version
    AND t.split_strategy = p_split_strategy
    AND t.dataset_split IN ('train','val','test')
    AND t.label_did_deteriorate IN (0,1)
    AND t.is_real_data = true
    AND t.is_leakage_safe = true;

  SELECT
    COUNT(*) FILTER (
      WHERE t.metric_zscore_vs_90d IS NULL
         OR t.metric_trend_7d IS NULL
         OR t.metric_trend_30d IS NULL
         OR t.metric_volatility_30d IS NULL
         OR t.metric_sample_count_30d IS NULL
         OR t.events_count_7d IS NULL
         OR t.cross_domain_pressure IS NULL
         OR t.data_density_score IS NULL
         OR t.freshness_score IS NULL
    )::integer,
    COUNT(*) FILTER (
      WHERE t.events_count_7d > 0 AND t.event_severity_avg_7d IS NULL
    )::integer,
    COUNT(*) FILTER (WHERE t.feature_hash IS NULL)::integer
  INTO v_missing_core, v_missing_event_severity, v_missing_feature_hash
  FROM public.training_dataset_aicis t
  WHERE t.horizon_days = p_horizon_days
    AND t.feature_version = p_feature_version
    AND t.split_strategy = p_split_strategy
    AND t.dataset_split IN ('train','val','test')
    AND t.label_did_deteriorate IN (0,1)
    AND t.is_real_data = true
    AND t.is_leakage_safe = true;

  INSERT INTO public.ml_model_training_manifest_rows (
    training_run_id,
    training_row_id,
    country_iso3,
    domain,
    snapshot_date,
    dataset_split,
    feature_version,
    feature_hash,
    label,
    feature_snapshot
  )
  SELECT
    p_training_run_id,
    t.id,
    t.country_iso3,
    t.domain,
    t.snapshot_date,
    t.dataset_split,
    t.feature_version,
    t.feature_hash,
    t.label_did_deteriorate,
    jsonb_build_object(
      'metric_zscore_vs_90d', t.metric_zscore_vs_90d,
      'metric_trend_7d', t.metric_trend_7d,
      'metric_trend_30d', t.metric_trend_30d,
      'metric_volatility_30d', t.metric_volatility_30d,
      'metric_sample_count_30d', t.metric_sample_count_30d,
      'events_count_7d', t.events_count_7d,
      'event_severity_effective_7d', CASE
        WHEN t.event_severity_avg_7d IS NOT NULL THEN t.event_severity_avg_7d
        WHEN t.events_count_7d = 0 THEN 0
        ELSE NULL
      END,
      'cross_domain_pressure', t.cross_domain_pressure,
      'data_density_score', t.data_density_score,
      'freshness_score', t.freshness_score
    )
  FROM public.training_dataset_aicis t
  WHERE t.horizon_days = p_horizon_days
    AND t.feature_version = p_feature_version
    AND t.split_strategy = p_split_strategy
    AND t.dataset_split IN ('train','val','test')
    AND t.label_did_deteriorate IN (0,1)
    AND t.is_real_data = true
    AND t.is_leakage_safe = true
    AND t.feature_hash IS NOT NULL
    AND t.metric_zscore_vs_90d IS NOT NULL
    AND t.metric_trend_7d IS NOT NULL
    AND t.metric_trend_30d IS NOT NULL
    AND t.metric_volatility_30d IS NOT NULL
    AND t.metric_sample_count_30d IS NOT NULL
    AND t.metric_sample_count_30d >= 0
    AND t.events_count_7d IS NOT NULL
    AND t.events_count_7d >= 0
    AND (t.event_severity_avg_7d IS NOT NULL OR t.events_count_7d = 0)
    AND t.cross_domain_pressure IS NOT NULL
    AND t.data_density_score IS NOT NULL
    AND t.freshness_score IS NOT NULL;

  GET DIAGNOSTICS v_eligible = ROW_COUNT;

  SELECT
    COUNT(*) FILTER (WHERE dataset_split = 'train')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'val')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'test')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'train' AND label = 1)::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'val' AND label = 1)::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'test' AND label = 1)::integer,
    md5(COALESCE(string_agg(
      training_row_id::text || '|' || feature_hash || '|' || dataset_split || '|' || label::text || '|' || feature_snapshot::text,
      E'\n' ORDER BY snapshot_date, country_iso3, domain, training_row_id
    ), ''))
  INTO
    v_train,
    v_val,
    v_test,
    v_train_positive,
    v_val_positive,
    v_test_positive,
    v_manifest_checksum
  FROM public.ml_model_training_manifest_rows
  WHERE training_run_id = p_training_run_id;

  UPDATE public.ml_model_training_runs
  SET
    train_rows = v_train,
    validation_rows = v_val,
    test_rows = v_test,
    excluded_rows = GREATEST(0, v_total_candidates - v_eligible),
    train_positive_rate = CASE
      WHEN v_train > 0 THEN v_train_positive::numeric / v_train::numeric
      ELSE NULL
    END,
    manifest_checksum = v_manifest_checksum,
    metadata = metadata || jsonb_build_object(
      'manifest_prepared_at', now(),
      'eligible_rows', v_eligible,
      'total_candidate_rows', v_total_candidates,
      'excluded_rows', GREATEST(0, v_total_candidates - v_eligible),
      'exclusion_diagnostics_nonexclusive', jsonb_build_object(
        'missing_core_feature_rows', v_missing_core,
        'positive_event_count_but_missing_severity_rows', v_missing_event_severity,
        'missing_feature_hash_rows', v_missing_feature_hash
      ),
      'split_class_counts', jsonb_build_object(
        'train', jsonb_build_object('rows', v_train, 'positive', v_train_positive),
        'val', jsonb_build_object('rows', v_val, 'positive', v_val_positive),
        'test', jsonb_build_object('rows', v_test, 'positive', v_test_positive)
      ),
      'event_severity_transform', 'severity=0 only when events_count_7d=0; positive event count with missing severity is excluded',
      'neighbor_feature', 'excluded_until_verified_adjacency_exists'
    )
  WHERE id = p_training_run_id;

  RETURN jsonb_build_object(
    'training_run_id', p_training_run_id,
    'horizon_days', p_horizon_days,
    'feature_version', p_feature_version,
    'split_strategy', p_split_strategy,
    'total_candidate_rows', v_total_candidates,
    'eligible_rows', v_eligible,
    'excluded_rows', GREATEST(0, v_total_candidates - v_eligible),
    'train_rows', v_train,
    'validation_rows', v_val,
    'test_rows', v_test,
    'train_positive_rows', v_train_positive,
    'validation_positive_rows', v_val_positive,
    'test_positive_rows', v_test_positive,
    'manifest_checksum', v_manifest_checksum
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_ml_training_manifest(uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_ml_training_manifest(uuid, integer, text, text)
  TO service_role;

COMMENT ON FUNCTION public.prepare_ml_training_manifest(uuid, integer, text, text) IS
  'Service-only atomic snapshot of truth-floor-v2 leakage-safe labeled temporal splits into immutable training manifest rows. Missing core evidence is excluded, not imputed. Event severity is encoded as zero only when observed event count is exactly zero.';
