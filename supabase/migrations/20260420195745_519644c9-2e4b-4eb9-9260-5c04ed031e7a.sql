CREATE TABLE IF NOT EXISTS public.training_dataset_aicis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso3 text NOT NULL,
  domain text NOT NULL,
  snapshot_date date NOT NULL,
  horizon_days int NOT NULL DEFAULT 7,
  metric_value_t double precision,
  metric_trend_7d double precision,
  metric_trend_30d double precision,
  metric_volatility_30d double precision,
  metric_zscore_vs_90d double precision,
  metric_sample_count_30d int,
  events_count_7d int DEFAULT 0,
  events_count_30d int DEFAULT 0,
  event_severity_avg_7d double precision,
  event_severity_max_7d double precision,
  event_velocity double precision,
  neighbor_risk_score double precision,
  cross_domain_pressure double precision,
  past_forecast_error_30d double precision,
  forecast_confidence_avg double precision,
  data_density_score double precision,
  freshness_score double precision,
  label_did_deteriorate int,
  label_zscore_at_horizon double precision,
  label_metric_value_at_horizon double precision,
  dataset_split text NOT NULL DEFAULT 'train',
  is_real_data boolean NOT NULL DEFAULT true,
  built_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_dataset_aicis_unique UNIQUE (country_iso3, domain, snapshot_date, horizon_days)
);

CREATE INDEX IF NOT EXISTS idx_tda_country_domain ON public.training_dataset_aicis(country_iso3, domain);
CREATE INDEX IF NOT EXISTS idx_tda_snapshot_date ON public.training_dataset_aicis(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_tda_split ON public.training_dataset_aicis(dataset_split);
CREATE INDEX IF NOT EXISTS idx_tda_label ON public.training_dataset_aicis(label_did_deteriorate) WHERE label_did_deteriorate IS NOT NULL;

ALTER TABLE public.training_dataset_aicis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and operators can view training dataset"
  ON public.training_dataset_aicis FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

CREATE POLICY "Service role manages training dataset"
  ON public.training_dataset_aicis FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.build_training_dataset_aicis(
  p_start_date date,
  p_end_date date,
  p_horizon_days int DEFAULT 7
)
RETURNS TABLE(rows_inserted int, rows_with_label int, build_seconds numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_inserted int := 0;
  v_labeled int := 0;
BEGIN
  WITH
  universe AS (
    SELECT DISTINCT iso3 AS country_iso3, domain
    FROM normalized_metrics
    WHERE iso3 IS NOT NULL AND domain IS NOT NULL
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
      AVG(m.value) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '7 days') AND m.provenance_observed_at <= c.snapshot_date) AS val_7d_avg,
      AVG(m.value) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days') AND m.provenance_observed_at <= c.snapshot_date) AS val_30d_avg,
      AVG(m.value) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '90 days') AND m.provenance_observed_at <= c.snapshot_date) AS val_90d_avg,
      STDDEV(m.value) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '90 days') AND m.provenance_observed_at <= c.snapshot_date) AS val_90d_std,
      STDDEV(m.value) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days') AND m.provenance_observed_at <= c.snapshot_date) AS val_30d_std,
      COUNT(*) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days') AND m.provenance_observed_at <= c.snapshot_date) AS sample_count_30d,
      AVG(m.freshness_score) FILTER (WHERE m.provenance_observed_at >= (c.snapshot_date - INTERVAL '30 days') AND m.provenance_observed_at <= c.snapshot_date) AS freshness
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
    ORDER BY c.country_iso3, c.domain, c.snapshot_date, m.provenance_observed_at DESC NULLS LAST
  ),
  event_features AS (
    SELECT
      c.country_iso3, c.domain, c.snapshot_date,
      COUNT(*) FILTER (WHERE e.occurred_at >= (c.snapshot_date - INTERVAL '7 days') AND e.occurred_at <= c.snapshot_date) AS events_7d,
      COUNT(*) FILTER (WHERE e.occurred_at >= (c.snapshot_date - INTERVAL '30 days') AND e.occurred_at <= c.snapshot_date) AS events_30d,
      AVG(e.severity) FILTER (WHERE e.occurred_at >= (c.snapshot_date - INTERVAL '7 days') AND e.occurred_at <= c.snapshot_date) AS sev_avg_7d,
      MAX(e.severity) FILTER (WHERE e.occurred_at >= (c.snapshot_date - INTERVAL '7 days') AND e.occurred_at <= c.snapshot_date) AS sev_max_7d
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
  )
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
    built_at = now();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT COUNT(*) INTO v_labeled
  FROM training_dataset_aicis
  WHERE snapshot_date BETWEEN p_start_date AND p_end_date
    AND horizon_days = p_horizon_days
    AND label_did_deteriorate IS NOT NULL;

  RETURN QUERY SELECT v_inserted, v_labeled, EXTRACT(EPOCH FROM (clock_timestamp() - v_start))::numeric;
END;
$$;

GRANT EXECUTE ON FUNCTION public.build_training_dataset_aicis(date, date, int) TO authenticated;