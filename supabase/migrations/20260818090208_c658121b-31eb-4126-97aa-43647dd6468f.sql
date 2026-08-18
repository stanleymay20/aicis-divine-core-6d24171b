CREATE INDEX IF NOT EXISTS idx_global_signals_iso3_ingested
  ON public.global_signals (geo_admin0_iso3, ingested_at DESC)
  WHERE geo_admin0_iso3 IS NOT NULL;

CREATE OR REPLACE FUNCTION public.detect_weak_signals(
  p_window_days integer DEFAULT 14,
  p_baseline_days integer DEFAULT 180,
  p_anomaly_z numeric DEFAULT 2.5,
  p_weak_z numeric DEFAULT 1.5,
  p_min_baseline_n integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_max_date date;
  v_stale int;
  v_scanned int := 0;
  v_written int := 0;
  v_status text := 'success';
BEGIN
  SELECT max(snapshot_date) INTO v_max_date FROM public.country_performance_snapshots;
  IF v_max_date IS NULL THEN
    INSERT INTO public.weak_signal_runs (status, completed_at, error)
    VALUES ('error', now(), 'No country_performance_snapshots rows available')
    RETURNING id INTO v_run_id;
    RETURN jsonb_build_object('run_id', v_run_id, 'status', 'error',
      'reason', 'no input data', 'detections', 0);
  END IF;

  v_stale := (CURRENT_DATE - v_max_date);
  IF v_stale > 21 THEN v_status := 'stale_input'; END IF;

  INSERT INTO public.weak_signal_runs (input_max_date, input_stale_days, parameters)
  VALUES (v_max_date, v_stale, jsonb_build_object(
    'window_days', p_window_days, 'baseline_days', p_baseline_days,
    'anomaly_z', p_anomaly_z, 'weak_z', p_weak_z, 'min_baseline_n', p_min_baseline_n))
  RETURNING id INTO v_run_id;

  CREATE TEMP TABLE _ws_scored ON COMMIT DROP AS
  WITH recent AS (
    SELECT iso3, domain, avg(performance_index) AS obs, count(*) AS n_recent
    FROM public.country_performance_snapshots
    WHERE snapshot_date > v_max_date - p_window_days
      AND performance_index IS NOT NULL
    GROUP BY iso3, domain
  ),
  baseline AS (
    SELECT iso3, domain, avg(performance_index) AS mu,
           stddev_samp(performance_index) AS sd, count(*) AS n
    FROM public.country_performance_snapshots
    WHERE snapshot_date <= v_max_date - p_window_days
      AND snapshot_date > v_max_date - p_window_days - p_baseline_days
      AND performance_index IS NOT NULL
    GROUP BY iso3, domain
  )
  SELECT r.iso3, r.domain, r.obs, b.mu, b.sd, b.n,
         ((r.obs - b.mu) / b.sd)::numeric AS z
  FROM recent r
  JOIN baseline b ON b.iso3 = r.iso3 AND b.domain = r.domain
  WHERE b.sd IS NOT NULL AND b.sd > 0 AND b.n >= p_min_baseline_n;

  CREATE TEMP TABLE _ws_src ON COMMIT DROP AS
  SELECT geo_admin0_iso3 AS iso3, count(DISTINCT ingestion_source)::int AS corr_sources
  FROM public.global_signals
  WHERE geo_admin0_iso3 IS NOT NULL
    AND ingested_at > now() - (p_window_days || ' days')::interval
  GROUP BY geo_admin0_iso3;

  WITH flagged AS (
    SELECT s.*, (CASE WHEN abs(s.z) >= p_weak_z THEN 1 ELSE 0 END) AS hot
    FROM _ws_scored s
  ),
  corr AS (
    SELECT f.*, (sum(f.hot) OVER (PARTITION BY f.iso3) - f.hot)::int AS corr_domains
    FROM flagged f
  )
  INSERT INTO public.weak_signal_detections (
    run_id, iso3, domain, signal_class, observed_value, baseline_mean, baseline_stddev,
    baseline_sample_size, z_score, window_days, corroborating_domains, corroborating_sources,
    novelty_score, confidence, method, evidence)
  SELECT
    v_run_id, c.iso3, c.domain,
    CASE
      WHEN abs(c.z) >= p_anomaly_z THEN 'anomaly'
      WHEN c.corr_domains >= 2 THEN 'corroborated_cluster'
      ELSE 'weak_signal'
    END,
    round(c.obs::numeric, 4), round(c.mu::numeric, 4), round(c.sd::numeric, 4), c.n,
    round(c.z, 4), p_window_days, c.corr_domains, COALESCE(x.corr_sources, 0),
    round(LEAST(1.0, abs(c.z) / 6.0), 4),
    round(LEAST(1.0,
      (LEAST(1.0, abs(c.z) / p_anomaly_z) * 0.5)
      + (LEAST(1.0, c.corr_domains::numeric / 3.0) * 0.25)
      + (LEAST(1.0, COALESCE(x.corr_sources, 0)::numeric / 5.0) * 0.25)), 4),
    'snapshot_zscore_v1',
    jsonb_build_object(
      'source_table', 'country_performance_snapshots',
      'input_max_date', v_max_date,
      'input_stale_days', v_stale,
      'baseline_window_days', p_baseline_days,
      'corroborating_source_table', 'global_signals')
  FROM corr c
  LEFT JOIN _ws_src x ON x.iso3 = c.iso3
  WHERE c.hot = 1
  ON CONFLICT (iso3, domain, signal_class, detected_on) DO NOTHING;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  SELECT count(*) INTO v_scanned FROM _ws_scored;

  UPDATE public.weak_signal_runs
     SET completed_at = now(), status = v_status,
         candidates_scanned = v_scanned, detections_written = v_written
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'status', v_status, 'input_max_date', v_max_date,
    'input_stale_days', v_stale, 'candidates_scanned', v_scanned,
    'detections', v_written);
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_weak_signals(integer, integer, numeric, numeric, integer) TO service_role;