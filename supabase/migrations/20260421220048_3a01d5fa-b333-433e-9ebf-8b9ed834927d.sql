
CREATE OR REPLACE FUNCTION public.compute_risk_scores()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch_id uuid := gen_random_uuid();
  v_inserted int := 0;
BEGIN
  INSERT INTO public.risk_scores (
    country_iso3, domain, score, components, generation_batch_id
  )
  SELECT
    country_iso3,
    domain,
    LEAST(100, GREATEST(0,
      50
      + COALESCE(metric_trend_30d, 0) * 30
      + COALESCE(metric_volatility_30d, 0) * 20
      + COALESCE(event_severity_avg_7d, 0) * 0.25
      + COALESCE(neighbor_risk_score, 0) * 15
      + COALESCE(cross_domain_pressure, 0) * 10
    )) AS score,
    jsonb_build_object(
      'metric_trend_30d', metric_trend_30d,
      'metric_volatility_30d', metric_volatility_30d,
      'event_severity_avg_7d', event_severity_avg_7d,
      'neighbor_risk_score', neighbor_risk_score,
      'cross_domain_pressure', cross_domain_pressure,
      'feature_version', feature_version,
      'data_density_score', data_density_score
    ) AS components,
    v_batch_id
  FROM (
    SELECT DISTINCT ON (country_iso3, domain)
      country_iso3, domain,
      metric_trend_30d, metric_volatility_30d,
      event_severity_avg_7d, neighbor_risk_score,
      cross_domain_pressure, feature_version, data_density_score
    FROM public.training_dataset_aicis
    WHERE is_leakage_safe = true
    ORDER BY country_iso3, domain, snapshot_date DESC
  ) latest;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO public.automation_logs (job_name, status, message)
  VALUES ('compute_risk_scores', 'success',
    format('Inserted %s risk_scores (batch %s)', v_inserted, v_batch_id));

  RETURN jsonb_build_object('batch_id', v_batch_id, 'rows_inserted', v_inserted);
END;
$function$;
