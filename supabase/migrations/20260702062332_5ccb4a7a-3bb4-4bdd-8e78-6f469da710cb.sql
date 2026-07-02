CREATE OR REPLACE FUNCTION public.compute_risk_ranking_baseline(p_top_n integer DEFAULT 200)
RETURNS TABLE(batch_id uuid, rows_inserted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_batch UUID := gen_random_uuid();
  v_count INTEGER;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (iso3, domain)
      iso3, domain, performance_index, momentum_score, volatility_index,
      forecast_direction, confidence_score, snapshot_date
    FROM country_performance_snapshots
    WHERE snapshot_date >= CURRENT_DATE - INTERVAL '14 days'
    ORDER BY iso3, domain, snapshot_date DESC
  ),
  scored AS (
    SELECT
      iso3, domain, performance_index, momentum_score, volatility_index,
      forecast_direction, confidence_score,
      LEAST(0.99, GREATEST(0.01,
        0.35 * GREATEST(0, -COALESCE(momentum_score, 0))
        + 0.25 * LEAST(1, COALESCE(volatility_index, 0))
        + 0.25 * LEAST(1, GREATEST(0, ((50 - performance_index) / NULLIF(GREATEST(volatility_index * 100, 5), 0)) / 3.0))
        + 0.15 * (CASE WHEN forecast_direction = 'decreasing' THEN 1 WHEN forecast_direction = 'stable' THEN 0.4 ELSE 0 END)
      )) AS prob
    FROM latest
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY prob DESC) AS rnk FROM scored
  )
  INSERT INTO risk_ranking_predictions (
    country_iso3, domain, risk_probability, rank_position, horizon_days,
    factors, model_version, generation_batch_id
  )
  SELECT iso3, domain, prob::NUMERIC, rnk::INTEGER, 7,
    jsonb_build_object(
      'performance_index', performance_index,
      'momentum_score', momentum_score,
      'volatility_index', volatility_index,
      'forecast_direction', forecast_direction,
      'confidence_score', confidence_score
    ),
    'baseline-v1', v_batch
  FROM ranked WHERE rnk <= p_top_n;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_batch, v_count;
END;
$function$;