-- ───────────── PHASE 2: ML INFERENCE ─────────────
CREATE TABLE IF NOT EXISTS public.risk_ml_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso3 TEXT NOT NULL,
  domain TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  horizon_days INT NOT NULL DEFAULT 7,
  risk_probability NUMERIC NOT NULL CHECK (risk_probability >= 0 AND risk_probability <= 1),
  baseline_score NUMERIC,
  model_version TEXT NOT NULL,
  feature_snapshot JSONB,
  generation_batch_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_ml_predictions_batch ON public.risk_ml_predictions(generation_batch_id);
CREATE INDEX IF NOT EXISTS idx_risk_ml_predictions_country ON public.risk_ml_predictions(country_iso3, domain, generated_at DESC);

ALTER TABLE public.risk_ml_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "risk_ml_predictions_read_authenticated"
  ON public.risk_ml_predictions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "risk_ml_predictions_service_write"
  ON public.risk_ml_predictions FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ml_model_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version TEXT NOT NULL UNIQUE,
  model_type TEXT NOT NULL DEFAULT 'logistic',
  weights JSONB NOT NULL,
  trained_at TIMESTAMPTZ DEFAULT now(),
  training_rows INT,
  validation_auc NUMERIC,
  active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ml_model_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ml_weights_read_authenticated"
  ON public.ml_model_weights FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "ml_weights_service_write"
  ON public.ml_model_weights FOR ALL
  TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.ml_model_weights (model_version, model_type, weights, training_rows, validation_auc, active)
VALUES (
  'logistic-baseline-v1',
  'logistic',
  jsonb_build_object(
    'intercept', -2.1,
    'coefficients', jsonb_build_object(
      'metric_trend_7d', 1.8,
      'metric_trend_30d', 0.9,
      'volatility', 1.2,
      'anomaly_score', 1.5,
      'recent_events_count_7d', 0.15,
      'event_severity_avg', 0.6,
      'neighbor_risk_score', 0.8,
      'regional_risk_score', 0.5,
      'past_forecast_error', 0.4,
      'data_density_score', -0.3
    )
  ),
  0, NULL, true
) ON CONFLICT (model_version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.infer_risk_probabilities(p_horizon_days INT DEFAULT 7)
RETURNS TABLE(batch_id UUID, rows_inserted BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_batch UUID := gen_random_uuid();
  v_model RECORD;
  v_intercept NUMERIC;
  v_coef JSONB;
  v_count BIGINT := 0;
BEGIN
  SELECT * INTO v_model FROM public.ml_model_weights WHERE active = true ORDER BY trained_at DESC LIMIT 1;
  IF v_model IS NULL THEN RAISE EXCEPTION 'No active model'; END IF;

  v_intercept := (v_model.weights->>'intercept')::NUMERIC;
  v_coef := v_model.weights->'coefficients';

  WITH latest_features AS (
    SELECT DISTINCT ON (country_iso3, domain)
      country_iso3, domain,
      COALESCE(metric_trend_7d, 0) AS f1,
      COALESCE(metric_trend_30d, 0) AS f2,
      COALESCE(volatility, 0) AS f3,
      COALESCE(anomaly_score, 0) AS f4,
      COALESCE(recent_events_count_7d, 0) AS f5,
      COALESCE(event_severity_avg, 0) AS f6,
      COALESCE(neighbor_risk_score, 0) AS f7,
      COALESCE(regional_risk_score, 0) AS f8,
      COALESCE(past_forecast_error, 0) AS f9,
      COALESCE(data_density_score, 0.5) AS f10
    FROM public.training_dataset_aicis
    ORDER BY country_iso3, domain, observation_ts DESC
  ),
  scored AS (
    SELECT
      country_iso3, domain,
      v_intercept
        + (v_coef->>'metric_trend_7d')::NUMERIC * f1
        + (v_coef->>'metric_trend_30d')::NUMERIC * f2
        + (v_coef->>'volatility')::NUMERIC * f3
        + (v_coef->>'anomaly_score')::NUMERIC * f4
        + (v_coef->>'recent_events_count_7d')::NUMERIC * f5
        + (v_coef->>'event_severity_avg')::NUMERIC * f6
        + (v_coef->>'neighbor_risk_score')::NUMERIC * f7
        + (v_coef->>'regional_risk_score')::NUMERIC * f8
        + (v_coef->>'past_forecast_error')::NUMERIC * f9
        + (v_coef->>'data_density_score')::NUMERIC * f10 AS logit,
      jsonb_build_object(
        'metric_trend_7d', f1, 'volatility', f3, 'anomaly_score', f4,
        'neighbor_risk_score', f7, 'regional_risk_score', f8
      ) AS snap
    FROM latest_features
  )
  INSERT INTO public.risk_ml_predictions
    (country_iso3, domain, horizon_days, risk_probability, model_version, feature_snapshot, generation_batch_id)
  SELECT
    country_iso3, domain, p_horizon_days,
    GREATEST(0.001, LEAST(0.999, 1.0 / (1.0 + EXP(-logit)))),
    v_model.model_version, snap, v_batch
  FROM scored;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_batch, v_count;
END $$;

-- ───────────── PHASE 5: GRAPH PROPAGATION ─────────────
CREATE TABLE IF NOT EXISTS public.risk_propagation_score (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_iso3 TEXT NOT NULL,
  target_iso3 TEXT NOT NULL,
  domain TEXT NOT NULL,
  propagation_score NUMERIC NOT NULL,
  contagion_path JSONB,
  hop_count INT DEFAULT 1,
  computed_at TIMESTAMPTZ DEFAULT now(),
  generation_batch_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_propagation_origin ON public.risk_propagation_score(origin_iso3, domain);
CREATE INDEX IF NOT EXISTS idx_propagation_target ON public.risk_propagation_score(target_iso3, domain);
CREATE INDEX IF NOT EXISTS idx_propagation_batch ON public.risk_propagation_score(generation_batch_id);

ALTER TABLE public.risk_propagation_score ENABLE ROW LEVEL SECURITY;

CREATE POLICY "propagation_read_authenticated"
  ON public.risk_propagation_score FOR SELECT TO authenticated USING (true);
CREATE POLICY "propagation_service_write"
  ON public.risk_propagation_score FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.compute_risk_propagation()
RETURNS TABLE(batch_id UUID, rows_inserted BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_batch UUID := gen_random_uuid();
  v_count BIGINT := 0;
BEGIN
  WITH high_risk AS (
    SELECT DISTINCT ON (country_iso3, domain)
      country_iso3, domain, risk_probability
    FROM public.risk_ml_predictions
    WHERE risk_probability > 0.4
    ORDER BY country_iso3, domain, generated_at DESC
  ),
  hop1 AS (
    SELECT
      hr.country_iso3 AS origin_iso3,
      unnest(cbs.affected_iso3) AS target_iso3,
      hr.domain,
      hr.risk_probability * COALESCE(cbs.intensity, 0.5) AS prop_score,
      jsonb_build_array(
        jsonb_build_object('iso3', hr.country_iso3, 'role', 'origin'),
        jsonb_build_object('role', 'direct', 'signal_type', cbs.signal_type)
      ) AS path,
      1 AS hop
    FROM high_risk hr
    JOIN public.cross_border_signals cbs
      ON cbs.origin_iso3 = hr.country_iso3
     AND cbs.domain = hr.domain
     AND cbs.detected_at > now() - interval '90 days'
  )
  INSERT INTO public.risk_propagation_score
    (origin_iso3, target_iso3, domain, propagation_score, contagion_path, hop_count, generation_batch_id)
  SELECT origin_iso3, target_iso3, domain,
         GREATEST(0, LEAST(1, prop_score)),
         path, hop, v_batch
  FROM hop1
  WHERE target_iso3 IS NOT NULL AND target_iso3 <> origin_iso3;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_batch, v_count;
END $$;

-- ───────────── PHASE 6: SIMULATION ENGINE ─────────────
CREATE TABLE IF NOT EXISTS public.simulation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_name TEXT NOT NULL,
  scenario_type TEXT NOT NULL DEFAULT 'shock',
  shock_domain TEXT NOT NULL,
  shock_iso3 TEXT,
  shock_magnitude NUMERIC NOT NULL,
  shock_direction TEXT NOT NULL DEFAULT 'down',
  baseline_snapshot JSONB,
  cascade_results JSONB,
  affected_countries JSONB,
  estimated_global_impact NUMERIC,
  confidence NUMERIC DEFAULT 0.7,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.simulation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "simulation_read_authenticated"
  ON public.simulation_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "simulation_insert_authenticated"
  ON public.simulation_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by OR created_by IS NULL);
CREATE POLICY "simulation_service_write"
  ON public.simulation_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.run_simulation(
  p_name TEXT,
  p_domain TEXT,
  p_magnitude NUMERIC,
  p_iso3 TEXT DEFAULT NULL,
  p_direction TEXT DEFAULT 'down'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_baseline JSONB;
  v_cascade JSONB;
  v_affected JSONB;
  v_global_impact NUMERIC;
BEGIN
  SELECT jsonb_build_object(
    'baseline_avg_index', AVG(performance_index),
    'baseline_country_count', COUNT(DISTINCT iso3)
  ) INTO v_baseline
  FROM public.country_performance_snapshots
  WHERE domain = p_domain
    AND snapshot_date > CURRENT_DATE - 30;

  WITH origin_countries AS (
    SELECT DISTINCT iso3
    FROM public.country_performance_snapshots
    WHERE domain = p_domain
      AND (p_iso3 IS NULL OR iso3 = p_iso3)
      AND snapshot_date > CURRENT_DATE - 30
  ),
  cascade_targets AS (
    SELECT
      unnest(cbs.affected_iso3) AS iso3,
      AVG(cbs.intensity) AS avg_intensity
    FROM public.cross_border_signals cbs
    JOIN origin_countries oc ON oc.iso3 = cbs.origin_iso3
    WHERE cbs.domain = p_domain
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'iso3', iso3,
    'projected_impact', ROUND((p_magnitude * COALESCE(avg_intensity, 0.3) * CASE WHEN p_direction='down' THEN -1 ELSE 1 END)::numeric, 4)
  )) INTO v_affected
  FROM cascade_targets;

  v_cascade := jsonb_build_object(
    'shock_domain', p_domain,
    'shock_magnitude', p_magnitude,
    'direction', p_direction,
    'cascade_target_count', COALESCE(jsonb_array_length(v_affected), 0)
  );

  v_global_impact := p_magnitude * COALESCE(jsonb_array_length(v_affected), 1) * 0.1;

  INSERT INTO public.simulation_runs
    (id, scenario_name, scenario_type, shock_domain, shock_iso3, shock_magnitude, shock_direction,
     baseline_snapshot, cascade_results, affected_countries, estimated_global_impact, created_by)
  VALUES (v_id, p_name, 'shock', p_domain, p_iso3, p_magnitude, p_direction,
          v_baseline, v_cascade, COALESCE(v_affected, '[]'::jsonb), v_global_impact, auth.uid());

  RETURN v_id;
END $$;