
CREATE OR REPLACE FUNCTION public.realize_due_prospective_forecasts(limit_count int DEFAULT 500)
RETURNS TABLE (run_id uuid, rows_realized int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_id uuid;
  v_realized int := 0;
BEGIN
  INSERT INTO public.forecast_realization_runs (limit_count, status)
  VALUES (limit_count, 'running')
  RETURNING id INTO v_run_id;

  WITH due AS (
    SELECT fpe.id, fpe.iso3, fpe.domain, fpe.predicted_value, fpe.predicted_direction
    FROM public.forecast_prospective_evaluations fpe
    WHERE fpe.realized_at IS NULL
      AND fpe.evaluation_locked = false
      AND fpe.realization_due_at <= now()
    ORDER BY fpe.realization_due_at ASC
    LIMIT GREATEST(limit_count, 1)
    FOR UPDATE SKIP LOCKED
  ),
  realized AS (
    SELECT
      d.id,
      d.predicted_value,
      d.predicted_direction,
      (
        SELECT m.value
        FROM public.normalized_metrics m
        WHERE m.iso3 = d.iso3
          AND m.domain = d.domain
          AND m.provenance_observed_at >= now() - interval '14 days'
        ORDER BY m.provenance_observed_at DESC
        LIMIT 1
      ) AS realized_value
    FROM due d
  )
  UPDATE public.forecast_prospective_evaluations fpe
  SET
    realized_value     = r.realized_value,
    realized_direction = CASE
      WHEN r.realized_value IS NULL THEN NULL
      WHEN r.realized_value > fpe.predicted_value THEN 'up'
      WHEN r.realized_value < fpe.predicted_value THEN 'down'
      ELSE 'flat'
    END,
    direction_hit = CASE
      WHEN r.realized_value IS NULL THEN NULL
      ELSE (
        (r.realized_value > fpe.predicted_value AND fpe.predicted_direction = 'up')
        OR (r.realized_value < fpe.predicted_value AND fpe.predicted_direction = 'down')
        OR (r.realized_value = fpe.predicted_value AND fpe.predicted_direction = 'flat')
      )
    END,
    absolute_error    = CASE WHEN r.realized_value IS NULL THEN NULL ELSE abs(r.realized_value - fpe.predicted_value) END,
    realized_at       = now(),
    evaluation_locked = true
  FROM realized r
  WHERE fpe.id = r.id;

  GET DIAGNOSTICS v_realized = ROW_COUNT;

  UPDATE public.forecast_realization_runs
  SET finished_at = now(),
      rows_realized = v_realized,
      status = 'success'
  WHERE id = v_run_id;

  RETURN QUERY SELECT v_run_id, v_realized;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.forecast_realization_runs
  SET finished_at = now(),
      status = 'failed',
      error_message = SQLERRM
  WHERE id = v_run_id;
  RAISE;
END;
$$;
