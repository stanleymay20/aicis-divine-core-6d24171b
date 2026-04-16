
-- Add metadata column for audit logging
ALTER TABLE public.forecast_prospective_evaluations
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Make iso3 NOT NULL with a safe default for existing rows
UPDATE public.forecast_prospective_evaluations SET iso3 = 'GLB' WHERE iso3 IS NULL;
ALTER TABLE public.forecast_prospective_evaluations ALTER COLUMN iso3 SET NOT NULL;
ALTER TABLE public.forecast_prospective_evaluations ALTER COLUMN iso3 SET DEFAULT 'GLB';

-- Composite index for realization cron (unlocked + due)
CREATE INDEX IF NOT EXISTS idx_prospective_pending_realization
  ON public.forecast_prospective_evaluations (realization_due_at)
  WHERE evaluation_locked = false;

-- Index for domain+iso3 lookups during realization
CREATE INDEX IF NOT EXISTS idx_prospective_domain_iso3
  ON public.forecast_prospective_evaluations (domain, iso3);

-- ══════════════════════════════════════════════════════
-- evaluate_forecast_readiness(): promotion gate
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.evaluate_forecast_readiness(
  _mae_threshold numeric DEFAULT 5.0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
  v_tp_total bigint;
  v_tp_hits bigint;
  v_tp_accuracy numeric;
  v_avg_mae numeric;
  v_domain_count bigint;
  v_min_domain_accuracy numeric;
  v_ready boolean;
  v_status text;
  v_details jsonb;
BEGIN
  -- Only locked evaluations count
  SELECT COUNT(*) INTO v_total
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE direction_hit)
  INTO v_tp_total, v_tp_hits
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = true AND realized_direction IS NOT NULL AND realized_direction != 'stable';

  v_tp_accuracy := CASE WHEN v_tp_total > 0 THEN ROUND(v_tp_hits::numeric / v_tp_total * 100, 1) ELSE 0 END;

  SELECT COALESCE(AVG(absolute_error), 0) INTO v_avg_mae
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true AND absolute_error IS NOT NULL;

  SELECT COUNT(DISTINCT domain) INTO v_domain_count
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  -- Min domain accuracy (domains with >= 5 samples)
  SELECT COALESCE(MIN(acc), 100) INTO v_min_domain_accuracy
  FROM (
    SELECT domain, ROUND(COUNT(*) FILTER (WHERE direction_hit)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS acc
    FROM forecast_prospective_evaluations
    WHERE evaluation_locked = true AND realized_direction IS NOT NULL AND realized_direction != 'stable'
    GROUP BY domain
    HAVING COUNT(*) >= 5
  ) domain_stats;

  -- Evaluate
  v_ready := v_total >= 50
    AND v_tp_accuracy >= 60
    AND v_avg_mae <= _mae_threshold
    AND v_domain_count >= 3
    AND v_min_domain_accuracy >= 30;

  v_status := CASE
    WHEN v_total = 0 THEN 'AWAITING_DATA'
    WHEN v_total < 30 THEN 'INSUFFICIENT_SAMPLE'
    WHEN v_total < 50 THEN 'EMERGING'
    WHEN v_ready THEN 'DECISION_GRADE'
    ELSE 'EVALUABLE'
  END;

  v_details := jsonb_build_object(
    'ready', v_ready,
    'status', v_status,
    'sample_size', v_total,
    'turning_point_total', v_tp_total,
    'turning_point_hits', v_tp_hits,
    'turning_point_accuracy', v_tp_accuracy,
    'avg_mae', ROUND(v_avg_mae, 3),
    'mae_threshold', _mae_threshold,
    'domain_count', v_domain_count,
    'min_domain_accuracy', v_min_domain_accuracy,
    'criteria', jsonb_build_object(
      'sample_50', v_total >= 50,
      'tp_accuracy_60', v_tp_accuracy >= 60,
      'mae_below_threshold', v_avg_mae <= _mae_threshold,
      'domains_3_plus', v_domain_count >= 3,
      'no_domain_below_30', v_min_domain_accuracy >= 30
    ),
    'evaluated_at', now()
  );

  RETURN v_details;
END;
$$;

-- ══════════════════════════════════════════════════════
-- compute_prospective_score(): clean score for truth harness
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_prospective_score()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
  v_tp_total bigint;
  v_tp_hits bigint;
  v_tp_accuracy numeric;
  v_avg_mae numeric;
  v_mae_score numeric;
  v_sample_confidence numeric;
  v_score numeric;
  v_status text;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('score', null, 'status', 'AWAITING_DATA', 'sample_size', 0);
  END IF;

  IF v_total < 30 THEN
    RETURN jsonb_build_object('score', null, 'status', 'INSUFFICIENT_SAMPLE', 'sample_size', v_total);
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE direction_hit)
  INTO v_tp_total, v_tp_hits
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = true AND realized_direction IS NOT NULL AND realized_direction != 'stable';

  v_tp_accuracy := CASE WHEN v_tp_total > 0 THEN v_tp_hits::numeric / v_tp_total * 100 ELSE 50 END;

  SELECT COALESCE(AVG(absolute_error), 0) INTO v_avg_mae
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true AND absolute_error IS NOT NULL;

  v_mae_score := GREATEST(0, 100 - v_avg_mae * 10);
  v_sample_confidence := LEAST(100, (v_total::numeric / 100) * 100);

  v_score := ROUND(v_tp_accuracy * 0.4 + v_mae_score * 0.3 + v_sample_confidence * 0.3);

  v_status := CASE
    WHEN v_total < 50 THEN 'INSUFFICIENT_SAMPLE'
    ELSE 'EVALUABLE'
  END;

  RETURN jsonb_build_object(
    'score', v_score,
    'status', v_status,
    'sample_size', v_total,
    'turning_point_accuracy', ROUND(v_tp_accuracy, 1),
    'turning_point_total', v_tp_total,
    'turning_point_hits', v_tp_hits,
    'avg_mae', ROUND(v_avg_mae, 3),
    'mae_score', ROUND(v_mae_score, 1),
    'sample_confidence', ROUND(v_sample_confidence, 1),
    'computed_at', now()
  );
END;
$$;
