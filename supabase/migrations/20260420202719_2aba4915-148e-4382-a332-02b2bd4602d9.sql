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
      COALESCE(metric_volatility_30d, 0) AS f3,
      COALESCE(metric_zscore_vs_90d, 0) AS f4,
      COALESCE(events_count_7d, 0) AS f5,
      COALESCE(event_severity_avg_7d, 0) AS f6,
      COALESCE(neighbor_risk_score, 0) AS f7,
      COALESCE(cross_domain_pressure, 0) AS f8,
      COALESCE(past_forecast_error_30d, 0) AS f9,
      COALESCE(data_density_score, 0.5) AS f10
    FROM public.training_dataset_aicis
    ORDER BY country_iso3, domain, snapshot_date DESC
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
        'metric_trend_7d', f1, 'volatility', f3, 'zscore', f4,
        'neighbor_risk_score', f7, 'cross_domain_pressure', f8
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