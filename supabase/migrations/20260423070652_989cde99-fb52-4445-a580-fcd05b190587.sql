-- Add covering indexes used by build_training_dataset_aicis
CREATE INDEX IF NOT EXISTS idx_norm_metrics_iso3_domain_obs
  ON public.normalized_metrics (iso3, domain, provenance_observed_at DESC)
  WHERE iso3 IS NOT NULL AND domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_norm_events_country_cat_occurred
  ON public.normalized_events (country_iso3, category, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_norm_events_iso3_cat_occurred
  ON public.normalized_events (iso3, category, occurred_at DESC);

-- New 4-arg version: per-country filter for chunked building
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
      COUNT(*) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days')) AS sample_count_30d,
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
      COUNT(*) FILTER (WHERE e.occurred_at >= (c.snapshot_date - INTERVAL '7 days')) AS events_7d,
      COUNT(*) AS events_30d,
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
  neighbor_agg AS (
    SELECT domain, snapshot_date, AVG(zscore_t) AS neighbor_risk
    FROM combined WHERE zscore_t IS NOT NULL
    GROUP BY domain, snapshot_date
  ),
  cross_agg AS (
    SELECT country_iso3, snapshot_date, AVG(ABS(zscore_t)) AS cross_pressure
    FROM combined WHERE zscore_t IS NOT NULL
    GROUP BY country_iso3, snapshot_date
  ),
  final_rows AS (
    SELECT
      c.*,
      n.neighbor_risk,
      x.cross_pressure
    FROM combined c
    LEFT JOIN neighbor_agg n USING (domain, snapshot_date)
    LEFT JOIN cross_agg x USING (country_iso3, snapshot_date)
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
      dataset_split, is_real_data, built_at
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
      COALESCE(sample_count_30d, 0),
      COALESCE(events_7d, 0), COALESCE(events_30d, 0),
      sev_avg_7d, sev_max_7d,
      CASE WHEN events_30d > 0 THEN (events_7d::float / GREATEST(events_30d::float / 4.0, 1.0)) - 1 ELSE NULL END,
      neighbor_risk, cross_pressure,
      LEAST(1.0, sample_count_30d::float / 30.0),
      freshness,
      CASE
        WHEN zscore_horizon IS NULL OR zscore_t IS NULL THEN NULL
        WHEN (zscore_t - zscore_horizon) > 1.0 THEN 1
        ELSE 0
      END,
      zscore_horizon,
      val_at_horizon,
      CASE
        WHEN snapshot_date > p_start_date + ((p_end_date - p_start_date) * 0.8)::int THEN 'test'
        WHEN snapshot_date > p_start_date + ((p_end_date - p_start_date) * 0.6)::int THEN 'val'
        ELSE 'train'
      END,
      true,
      now()
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
      built_at = now()
    RETURNING label_did_deteriorate
  )
  SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE label_did_deteriorate IS NOT NULL)::int
    INTO v_inserted, v_with_label
  FROM ins;

  rows_inserted := v_inserted;
  rows_with_label := v_with_label;
  build_seconds := EXTRACT(EPOCH FROM (clock_timestamp() - t0))::numeric;
  RETURN NEXT;
END;
$$;