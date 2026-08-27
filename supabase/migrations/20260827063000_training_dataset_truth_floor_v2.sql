-- AICIS Training Dataset Truth Floor v2
--
-- Goals:
--   * never turn absence of joined events into a fabricated event count;
--   * never label a global domain average as a geographic/network neighbour signal;
--   * derive cross-domain pressure from OTHER domains only;
--   * keep new rows out of train/val/test until a completed execution assigns
--     one chronological split per distinct snapshot date;
--   * make version positive-rate/checksum metadata describe observed row content,
--     not execution metadata or unlabeled rows.
--
-- No accumulated training rows are deleted by this migration.

ALTER TABLE public.training_dataset_aicis
  ADD COLUMN IF NOT EXISTS feature_semantics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS label_semantics text,
  ADD COLUMN IF NOT EXISTS split_strategy text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS split_assigned_at timestamptz;

ALTER TABLE public.training_dataset_versions
  ADD COLUMN IF NOT EXISTS version_scope text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS split_strategy text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS labeled_row_count integer,
  ADD COLUMN IF NOT EXISTS train_row_count integer,
  ADD COLUMN IF NOT EXISTS val_row_count integer,
  ADD COLUMN IF NOT EXISTS test_row_count integer,
  ADD COLUMN IF NOT EXISTS unlabeled_row_count integer,
  ADD COLUMN IF NOT EXISTS quality_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.set_training_dataset_truth_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.feature_version := 'truth-floor-v2';
  NEW.label_horizon_end_at := NEW.snapshot_date::timestamptz + make_interval(days => NEW.horizon_days);
  NEW.feature_hash := md5(
    jsonb_build_object(
      'country_iso3', NEW.country_iso3,
      'domain', NEW.domain,
      'snapshot_date', NEW.snapshot_date,
      'horizon_days', NEW.horizon_days,
      'metric_value_t', NEW.metric_value_t,
      'metric_trend_7d', NEW.metric_trend_7d,
      'metric_trend_30d', NEW.metric_trend_30d,
      'metric_volatility_30d', NEW.metric_volatility_30d,
      'metric_zscore_vs_90d', NEW.metric_zscore_vs_90d,
      'metric_sample_count_30d', NEW.metric_sample_count_30d,
      'events_count_7d', NEW.events_count_7d,
      'events_count_30d', NEW.events_count_30d,
      'event_severity_avg_7d', NEW.event_severity_avg_7d,
      'event_severity_max_7d', NEW.event_severity_max_7d,
      'event_velocity', NEW.event_velocity,
      'neighbor_risk_score', NEW.neighbor_risk_score,
      'cross_domain_pressure', NEW.cross_domain_pressure,
      'data_density_score', NEW.data_density_score,
      'freshness_score', NEW.freshness_score,
      'label_did_deteriorate', NEW.label_did_deteriorate,
      'label_zscore_at_horizon', NEW.label_zscore_at_horizon,
      'label_metric_value_at_horizon', NEW.label_metric_value_at_horizon,
      'feature_semantics', NEW.feature_semantics,
      'label_semantics', NEW.label_semantics
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_dataset_truth_metadata
  ON public.training_dataset_aicis;
CREATE TRIGGER trg_training_dataset_truth_metadata
  BEFORE INSERT OR UPDATE OF
    country_iso3, domain, snapshot_date, horizon_days,
    metric_value_t, metric_trend_7d, metric_trend_30d,
    metric_volatility_30d, metric_zscore_vs_90d,
    metric_sample_count_30d, events_count_7d, events_count_30d,
    event_severity_avg_7d, event_severity_max_7d, event_velocity,
    neighbor_risk_score, cross_domain_pressure, data_density_score,
    freshness_score, label_did_deteriorate, label_zscore_at_horizon,
    label_metric_value_at_horizon, feature_semantics, label_semantics
  ON public.training_dataset_aicis
  FOR EACH ROW EXECUTE FUNCTION public.set_training_dataset_truth_metadata();

CREATE OR REPLACE FUNCTION public.repartition_training_dataset_aicis(
  p_horizon_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_train integer := 0;
  v_val integer := 0;
  v_test integer := 0;
  v_unlabeled integer := 0;
  v_dates integer := 0;
BEGIN
  IF p_horizon_days IS NULL OR p_horizon_days <= 0 THEN
    RAISE EXCEPTION 'p_horizon_days must be positive';
  END IF;

  SELECT COUNT(*)::integer
    INTO v_dates
  FROM (
    SELECT DISTINCT snapshot_date
    FROM public.training_dataset_aicis
    WHERE horizon_days = p_horizon_days
      AND label_did_deteriorate IS NOT NULL
  ) d;

  -- Unresolved outcomes never enter a modelling split.
  UPDATE public.training_dataset_aicis
  SET dataset_split = 'unlabeled',
      split_strategy = 'chronological_distinct_date_60_20_20_v2',
      split_assigned_at = now()
  WHERE horizon_days = p_horizon_days
    AND label_did_deteriorate IS NULL;

  -- Split by DISTINCT DATE, not by row. Every country/domain from the same day
  -- remains in the same partition, preventing same-date leakage across train,
  -- validation and test. With very few labeled dates, a split may legitimately
  -- be empty; later training must abstain rather than invent validation data.
  WITH ranked_dates AS (
    SELECT
      snapshot_date,
      percent_rank() OVER (ORDER BY snapshot_date) AS chronological_fraction
    FROM (
      SELECT DISTINCT snapshot_date
      FROM public.training_dataset_aicis
      WHERE horizon_days = p_horizon_days
        AND label_did_deteriorate IS NOT NULL
    ) d
  )
  UPDATE public.training_dataset_aicis t
  SET dataset_split = CASE
        WHEN r.chronological_fraction < 0.60 THEN 'train'
        WHEN r.chronological_fraction < 0.80 THEN 'val'
        ELSE 'test'
      END,
      split_strategy = 'chronological_distinct_date_60_20_20_v2',
      split_assigned_at = now()
  FROM ranked_dates r
  WHERE t.horizon_days = p_horizon_days
    AND t.label_did_deteriorate IS NOT NULL
    AND t.snapshot_date = r.snapshot_date;

  SELECT
    COUNT(*) FILTER (WHERE dataset_split = 'train')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'val')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'test')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'unlabeled')::integer
  INTO v_train, v_val, v_test, v_unlabeled
  FROM public.training_dataset_aicis
  WHERE horizon_days = p_horizon_days;

  RETURN jsonb_build_object(
    'horizon_days', p_horizon_days,
    'strategy', 'chronological_distinct_date_60_20_20_v2',
    'distinct_labeled_dates', v_dates,
    'train_rows', v_train,
    'val_rows', v_val,
    'test_rows', v_test,
    'unlabeled_rows', v_unlabeled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repartition_training_dataset_aicis(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repartition_training_dataset_aicis(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.repartition_training_dataset_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM public.repartition_training_dataset_aicis(NEW.horizon_days);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_execution_repartition
  ON public.training_executions;
CREATE TRIGGER trg_training_execution_repartition
  AFTER UPDATE OF status ON public.training_executions
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.repartition_training_dataset_on_completion();

CREATE OR REPLACE FUNCTION public.set_training_dataset_version_truth_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_labeled integer := 0;
  v_positives integer := 0;
  v_train integer := 0;
  v_val integer := 0;
  v_test integer := 0;
  v_unlabeled integer := 0;
  v_manifest text;
BEGIN
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE label_did_deteriorate IS NOT NULL)::integer,
    COUNT(*) FILTER (WHERE label_did_deteriorate = 1)::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'train')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'val')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'test')::integer,
    COUNT(*) FILTER (WHERE dataset_split = 'unlabeled')::integer,
    md5(COALESCE(string_agg(
      COALESCE(feature_hash, 'missing-feature-hash') || '|' ||
      id::text || '|' || dataset_split || '|' ||
      COALESCE(label_did_deteriorate::text, 'unlabeled'),
      '' ORDER BY snapshot_date, country_iso3, domain, id
    ), ''))
  INTO
    v_total, v_labeled, v_positives,
    v_train, v_val, v_test, v_unlabeled, v_manifest
  FROM public.training_dataset_aicis
  WHERE horizon_days = NEW.horizon_days
    AND snapshot_date BETWEEN NEW.window_start AND NEW.window_end;

  NEW.row_count := v_total;
  NEW.labeled_row_count := v_labeled;
  NEW.train_row_count := v_train;
  NEW.val_row_count := v_val;
  NEW.test_row_count := v_test;
  NEW.unlabeled_row_count := v_unlabeled;
  NEW.positive_rate := CASE
    WHEN v_labeled > 0 THEN v_positives::numeric / v_labeled::numeric
    ELSE NULL
  END;
  NEW.checksum := v_manifest;
  NEW.version_scope := 'execution_window_delta';
  NEW.split_strategy := 'chronological_distinct_date_60_20_20_v2';
  NEW.quality_summary := jsonb_build_object(
    'checksum_semantics', 'ordered_row_content_manifest_md5_v2',
    'positive_rate_denominator', 'labeled_rows_only',
    'labeled_rows', v_labeled,
    'positive_rows', v_positives,
    'train_rows', v_train,
    'val_rows', v_val,
    'test_rows', v_test,
    'unlabeled_rows', v_unlabeled,
    'neighbor_feature', 'unavailable_without_verified_adjacency',
    'event_count_semantics', 'events_observed_in_aicis_corpus_not_world_event_total',
    'cross_domain_pressure', 'mean_abs_zscore_of_other_domains_same_country_date'
  );
  NEW.source_snapshot := COALESCE(NEW.source_snapshot, '{}'::jsonb) || jsonb_build_object(
    'version_scope', 'execution_window_delta',
    'content_manifest_checksum', v_manifest,
    'split_strategy', 'chronological_distinct_date_60_20_20_v2'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_dataset_version_truth_metadata
  ON public.training_dataset_versions;
CREATE TRIGGER trg_training_dataset_version_truth_metadata
  BEFORE INSERT ON public.training_dataset_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_training_dataset_version_truth_metadata();

CREATE OR REPLACE FUNCTION public.build_training_dataset_aicis(
  p_start_date date,
  p_end_date date,
  p_horizon_days integer,
  p_iso3_filter text
)
RETURNS TABLE(rows_inserted integer, rows_with_label integer, build_seconds numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  v_inserted integer := 0;
  v_with_label integer := 0;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid training date range';
  END IF;
  IF p_horizon_days IS NULL OR p_horizon_days <= 0 THEN
    RAISE EXCEPTION 'p_horizon_days must be positive';
  END IF;

  WITH
  universe AS (
    SELECT DISTINCT iso3 AS country_iso3, domain
    FROM normalized_metrics
    WHERE iso3 IS NOT NULL AND domain IS NOT NULL
      AND (p_iso3_filter IS NULL OR iso3 = p_iso3_filter)
      AND provenance_observed_at >= (p_start_date - INTERVAL '180 days')
  ),
  date_series AS (
    SELECT generate_series(p_start_date, p_end_date, INTERVAL '1 day')::date AS snapshot_date
  ),
  cells AS (
    SELECT u.country_iso3, u.domain, d.snapshot_date
    FROM universe u CROSS JOIN date_series d
  ),
  metric_features AS (
    SELECT
      c.country_iso3, c.domain, c.snapshot_date,
      AVG(m.value) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '7 days')) AS val_7d_avg,
      AVG(m.value) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days')) AS val_30d_avg,
      AVG(m.value) AS val_90d_avg,
      STDDEV(m.value) AS val_90d_std,
      STDDEV(m.value) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days')) AS val_30d_std,
      COUNT(m.id) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days')) AS sample_count_30d,
      AVG(m.freshness_score) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days')) AS freshness
    FROM cells c
    LEFT JOIN normalized_metrics m
      ON m.iso3 = c.country_iso3 AND m.domain = c.domain
     AND m.provenance_observed_at <= c.snapshot_date
     AND m.provenance_observed_at >= (c.snapshot_date - INTERVAL '90 days')
    GROUP BY c.country_iso3, c.domain, c.snapshot_date
  ),
  metric_latest AS (
    SELECT DISTINCT ON (c.country_iso3, c.domain, c.snapshot_date)
      c.country_iso3, c.domain, c.snapshot_date, m.value AS metric_value_t
    FROM cells c
    LEFT JOIN normalized_metrics m
      ON m.iso3 = c.country_iso3 AND m.domain = c.domain
     AND m.provenance_observed_at <= c.snapshot_date
     AND m.provenance_observed_at >= (c.snapshot_date - INTERVAL '90 days')
    ORDER BY c.country_iso3, c.domain, c.snapshot_date, m.provenance_observed_at DESC NULLS LAST
  ),
  event_features AS (
    SELECT
      c.country_iso3, c.domain, c.snapshot_date,
      COUNT(e.id) FILTER (WHERE e.occurred_at >= (c.snapshot_date - INTERVAL '7 days')) AS events_7d,
      COUNT(e.id) AS events_30d,
      AVG(e.severity) FILTER (WHERE e.occurred_at >= (c.snapshot_date - INTERVAL '7 days')) AS sev_avg_7d,
      MAX(e.severity) FILTER (WHERE e.occurred_at >= (c.snapshot_date - INTERVAL '7 days')) AS sev_max_7d
    FROM cells c
    LEFT JOIN normalized_events e
      ON COALESCE(e.country_iso3, e.iso3) = c.country_iso3
     AND e.category = c.domain
     AND e.occurred_at <= c.snapshot_date
     AND e.occurred_at >= (c.snapshot_date - INTERVAL '30 days')
    GROUP BY c.country_iso3, c.domain, c.snapshot_date
  ),
  metric_horizon AS (
    SELECT DISTINCT ON (c.country_iso3, c.domain, c.snapshot_date)
      c.country_iso3, c.domain, c.snapshot_date, m.value AS val_at_horizon
    FROM cells c
    LEFT JOIN normalized_metrics m
      ON m.iso3 = c.country_iso3 AND m.domain = c.domain
     AND m.provenance_observed_at > c.snapshot_date
     AND m.provenance_observed_at <= (c.snapshot_date + (p_horizon_days || ' days')::interval)
    ORDER BY c.country_iso3, c.domain, c.snapshot_date, m.provenance_observed_at DESC NULLS LAST
  ),
  combined AS (
    SELECT
      c.country_iso3, c.domain, c.snapshot_date,
      ml.metric_value_t,
      mf.val_7d_avg, mf.val_30d_avg, mf.val_90d_avg, mf.val_90d_std, mf.val_30d_std,
      mf.sample_count_30d, mf.freshness,
      ef.events_7d, ef.events_30d, ef.sev_avg_7d, ef.sev_max_7d,
      mh.val_at_horizon,
      CASE WHEN mf.val_90d_std > 0 AND ml.metric_value_t IS NOT NULL AND mf.val_90d_avg IS NOT NULL
           THEN (ml.metric_value_t - mf.val_90d_avg) / mf.val_90d_std ELSE NULL END AS zscore_t,
      CASE WHEN mf.val_90d_std > 0 AND mh.val_at_horizon IS NOT NULL AND mf.val_90d_avg IS NOT NULL
           THEN (mh.val_at_horizon - mf.val_90d_avg) / mf.val_90d_std ELSE NULL END AS zscore_horizon
    FROM cells c
    LEFT JOIN metric_features mf USING (country_iso3, domain, snapshot_date)
    LEFT JOIN metric_latest ml USING (country_iso3, domain, snapshot_date)
    LEFT JOIN event_features ef USING (country_iso3, domain, snapshot_date)
    LEFT JOIN metric_horizon mh USING (country_iso3, domain, snapshot_date)
  ),
  cross_domain AS (
    SELECT
      base.country_iso3,
      base.domain,
      base.snapshot_date,
      AVG(ABS(other.zscore_t)) FILTER (WHERE other.zscore_t IS NOT NULL) AS cross_pressure
    FROM combined base
    LEFT JOIN combined other
      ON other.country_iso3 = base.country_iso3
     AND other.snapshot_date = base.snapshot_date
     AND other.domain <> base.domain
    GROUP BY base.country_iso3, base.domain, base.snapshot_date
  ),
  final_rows AS (
    SELECT
      c.*,
      x.cross_pressure
    FROM combined c
    LEFT JOIN cross_domain x USING (country_iso3, domain, snapshot_date)
  ),
  ins AS (
    INSERT INTO training_dataset_aicis (
      country_iso3, domain, snapshot_date, horizon_days,
      metric_value_t, metric_trend_7d, metric_trend_30d, metric_volatility_30d,
      metric_zscore_vs_90d, metric_sample_count_30d,
      events_count_7d, events_count_30d, event_severity_avg_7d, event_severity_max_7d,
      event_velocity, neighbor_risk_score, cross_domain_pressure,
      data_density_score, freshness_score,
      label_did_deteriorate, label_zscore_at_horizon, label_metric_value_at_horizon,
      dataset_split, is_real_data, built_at,
      feature_semantics, label_semantics, split_strategy, split_assigned_at,
      is_leakage_safe
    )
    SELECT
      country_iso3, domain, snapshot_date, p_horizon_days,
      metric_value_t,
      CASE WHEN val_30d_avg IS NOT NULL AND val_30d_avg <> 0 AND val_7d_avg IS NOT NULL
           THEN (val_7d_avg - val_30d_avg) / NULLIF(ABS(val_30d_avg),0) ELSE NULL END,
      CASE WHEN val_90d_avg IS NOT NULL AND val_90d_avg <> 0 AND val_30d_avg IS NOT NULL
           THEN (val_30d_avg - val_90d_avg) / NULLIF(ABS(val_90d_avg),0) ELSE NULL END,
      val_30d_std,
      zscore_t,
      sample_count_30d,
      events_7d,
      events_30d,
      sev_avg_7d,
      sev_max_7d,
      CASE WHEN events_30d > 0
           THEN (events_7d::double precision / GREATEST(events_30d::double precision / 4.0, 1.0)) - 1
           ELSE NULL END,
      NULL::double precision,
      cross_pressure,
      CASE WHEN sample_count_30d IS NULL THEN NULL
           ELSE LEAST(1.0, sample_count_30d::double precision / 30.0) END,
      freshness,
      CASE
        WHEN zscore_horizon IS NULL OR zscore_t IS NULL THEN NULL
        WHEN (zscore_t - zscore_horizon) > 1.0 THEN 1
        ELSE 0
      END,
      zscore_horizon,
      val_at_horizon,
      'unassigned',
      true,
      now(),
      jsonb_build_object(
        'metric_features', 'observed_metrics_up_to_snapshot_date',
        'event_counts', 'events_observed_in_aicis_corpus_not_world_event_total',
        'neighbor_risk_score', 'unavailable_without_verified_adjacency',
        'cross_domain_pressure', 'mean_abs_zscore_of_other_domains_same_country_date',
        'data_density_score', 'observed_metric_sample_count_ratio_capped_at_30',
        'freshness_score', 'mean_of_available_upstream_metric_freshness_values',
        'missing_value_policy', 'preserve_null_no_numeric_fallback'
      ),
      'binary_1_when_zscore_drops_more_than_1_between_snapshot_and_latest_observation_within_horizon',
      'pending_repartition',
      NULL,
      true
    FROM final_rows
    ON CONFLICT (country_iso3, domain, snapshot_date, horizon_days) DO UPDATE SET
      metric_value_t = EXCLUDED.metric_value_t,
      metric_trend_7d = EXCLUDED.metric_trend_7d,
      metric_trend_30d = EXCLUDED.metric_trend_30d,
      metric_volatility_30d = EXCLUDED.metric_volatility_30d,
      metric_zscore_vs_90d = EXCLUDED.metric_zscore_vs_90d,
      metric_sample_count_30d = EXCLUDED.metric_sample_count_30d,
      events_count_7d = EXCLUDED.events_count_7d,
      events_count_30d = EXCLUDED.events_count_30d,
      event_severity_avg_7d = EXCLUDED.event_severity_avg_7d,
      event_severity_max_7d = EXCLUDED.event_severity_max_7d,
      event_velocity = EXCLUDED.event_velocity,
      neighbor_risk_score = EXCLUDED.neighbor_risk_score,
      cross_domain_pressure = EXCLUDED.cross_domain_pressure,
      data_density_score = EXCLUDED.data_density_score,
      freshness_score = EXCLUDED.freshness_score,
      label_did_deteriorate = EXCLUDED.label_did_deteriorate,
      label_zscore_at_horizon = EXCLUDED.label_zscore_at_horizon,
      label_metric_value_at_horizon = EXCLUDED.label_metric_value_at_horizon,
      dataset_split = EXCLUDED.dataset_split,
      is_real_data = EXCLUDED.is_real_data,
      built_at = now(),
      feature_semantics = EXCLUDED.feature_semantics,
      label_semantics = EXCLUDED.label_semantics,
      split_strategy = EXCLUDED.split_strategy,
      split_assigned_at = EXCLUDED.split_assigned_at,
      is_leakage_safe = EXCLUDED.is_leakage_safe
    RETURNING label_did_deteriorate
  )
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE label_did_deteriorate IS NOT NULL)::integer
  INTO v_inserted, v_with_label
  FROM ins;

  rows_inserted := v_inserted;
  rows_with_label := v_with_label;
  build_seconds := EXTRACT(EPOCH FROM (clock_timestamp() - t0))::numeric;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.build_training_dataset_aicis(date,date,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_training_dataset_aicis(date,date,integer,text) TO service_role;

COMMENT ON COLUMN public.training_dataset_aicis.neighbor_risk_score IS
  'NULL in truth-floor-v2 unless a verified adjacency/network definition is available. Historical non-NULL values may represent a legacy global-domain average and must not be assumed to be geographic neighbours.';
COMMENT ON COLUMN public.training_dataset_aicis.dataset_split IS
  'truth-floor-v2 uses unassigned during a running build, unlabeled for unresolved outcomes, then chronological distinct-date train/val/test assignment on successful completion.';
COMMENT ON COLUMN public.training_dataset_versions.version_scope IS
  'truth-floor-v2 dataset versions currently describe the rows rebuilt in one execution window (a delta), not an immutable snapshot of the entire training corpus.';
