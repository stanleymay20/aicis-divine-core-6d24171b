
-- Daily health snapshots for trend tracking
CREATE TABLE IF NOT EXISTS public.forecast_prospective_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  total_forecasts bigint NOT NULL DEFAULT 0,
  realized_count bigint NOT NULL DEFAULT 0,
  pending_count bigint NOT NULL DEFAULT 0,
  tp_accuracy numeric,
  avg_mae numeric,
  domains_covered int NOT NULL DEFAULT 0,
  countries_covered int NOT NULL DEFAULT 0,
  accumulation_status text NOT NULL DEFAULT 'STALLED',
  readiness_status text NOT NULL DEFAULT 'AWAITING_DATA',
  missing_actual_count bigint NOT NULL DEFAULT 0,
  overdue_count bigint NOT NULL DEFAULT 0,
  new_24h bigint NOT NULL DEFAULT 0,
  new_7d bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_date)
);

ALTER TABLE public.forecast_prospective_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Health snapshots are readable by authenticated users"
  ON public.forecast_prospective_health_snapshots FOR SELECT TO authenticated USING (true);

-- PART 1: Accumulation Monitor
CREATE OR REPLACE FUNCTION public.prospective_accumulation_monitor()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_new_24h bigint; v_new_7d bigint;
  v_realized_24h bigint; v_realized_7d bigint;
  v_locked bigint; v_unlocked bigint;
  v_overdue bigint; v_missing bigint; v_dupes bigint;
  v_domains bigint; v_countries bigint; v_models bigint;
  v_status text; v_total bigint;
BEGIN
  SELECT COUNT(*) FILTER (WHERE predicted_at >= now() - interval '24 hours'),
         COUNT(*) FILTER (WHERE predicted_at >= now() - interval '7 days')
  INTO v_new_24h, v_new_7d
  FROM forecast_prospective_evaluations;

  SELECT COUNT(*) FILTER (WHERE realized_at >= now() - interval '24 hours'),
         COUNT(*) FILTER (WHERE realized_at >= now() - interval '7 days')
  INTO v_realized_24h, v_realized_7d
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  SELECT COUNT(*) FILTER (WHERE evaluation_locked), COUNT(*) FILTER (WHERE NOT evaluation_locked)
  INTO v_locked, v_unlocked
  FROM forecast_prospective_evaluations;

  SELECT COUNT(*) INTO v_overdue
  FROM forecast_prospective_evaluations
  WHERE NOT evaluation_locked AND realization_due_at < now() - interval '48 hours';

  SELECT COUNT(*) INTO v_missing
  FROM forecast_prospective_evaluations
  WHERE NOT evaluation_locked AND metadata->>'status' = 'missing_actual';

  SELECT COALESCE(SUM(cnt - 1), 0) INTO v_dupes FROM (
    SELECT COUNT(*) as cnt FROM forecast_prospective_evaluations
    GROUP BY domain, iso3, horizon_days, predicted_at HAVING COUNT(*) > 1
  ) d;

  SELECT COUNT(DISTINCT domain), COUNT(DISTINCT iso3), COUNT(DISTINCT model_version)
  INTO v_domains, v_countries, v_models
  FROM forecast_prospective_evaluations;

  v_total := v_locked + v_unlocked;

  v_status := CASE
    WHEN v_new_24h = 0 THEN 'STALLED'
    WHEN v_new_7d < 20 THEN 'LOW_VOLUME'
    WHEN v_new_7d >= 100 AND v_domains >= 5 THEN 'GROWING'
    WHEN v_new_7d >= 20 AND (v_overdue::numeric / GREATEST(v_total, 1)) < 0.1 THEN 'HEALTHY'
    ELSE 'LOW_VOLUME'
  END;

  RETURN jsonb_build_object(
    'new_24h', v_new_24h, 'new_7d', v_new_7d,
    'realized_24h', v_realized_24h, 'realized_7d', v_realized_7d,
    'locked', v_locked, 'unlocked', v_unlocked,
    'overdue', v_overdue, 'missing_actual', v_missing, 'duplicates', v_dupes,
    'domains', v_domains, 'countries', v_countries, 'models', v_models,
    'accumulation_status', v_status, 'checked_at', now()
  );
END;
$$;

-- PART 2: Match Quality Audit
CREATE OR REPLACE FUNCTION public.audit_prospective_match_quality()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total bigint; v_null_actuals bigint;
  v_within_1d bigint; v_within_3d bigint; v_within_7d bigint;
  v_avg_delay numeric; v_missing_iso3 bigint;
  v_score numeric; v_samples jsonb;
BEGIN
  SELECT COUNT(*) INTO v_total FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('sample_size', 0, 'quality_score', null, 'status', 'NO_DATA');
  END IF;

  SELECT COUNT(*) FILTER (WHERE realized_value IS NULL) INTO v_null_actuals
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  -- Use metadata to check match timing
  SELECT
    COUNT(*) FILTER (WHERE ABS(EXTRACT(epoch FROM (realized_at - realization_due_at))) / 86400 <= 1),
    COUNT(*) FILTER (WHERE ABS(EXTRACT(epoch FROM (realized_at - realization_due_at))) / 86400 <= 3),
    COUNT(*) FILTER (WHERE ABS(EXTRACT(epoch FROM (realized_at - realization_due_at))) / 86400 <= 7),
    COALESCE(AVG(ABS(EXTRACT(epoch FROM (realized_at - realization_due_at))) / 86400), 0)
  INTO v_within_1d, v_within_3d, v_within_7d, v_avg_delay
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = true AND realized_at IS NOT NULL;

  SELECT COUNT(*) INTO v_missing_iso3
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true AND (iso3 IS NULL OR iso3 = '');

  -- Quality score: timeliness (40%) + completeness (30%) + iso3 presence (30%)
  v_score := ROUND(
    (CASE WHEN v_total > 0 THEN v_within_3d::numeric / v_total * 100 ELSE 0 END) * 0.4 +
    (CASE WHEN v_total > 0 THEN (v_total - v_null_actuals)::numeric / v_total * 100 ELSE 0 END) * 0.3 +
    (CASE WHEN v_total > 0 THEN (v_total - v_missing_iso3)::numeric / v_total * 100 ELSE 0 END) * 0.3
  );

  -- Sample rows
  SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_samples FROM (
    SELECT id, domain, iso3, realization_due_at, realized_at,
      ROUND(ABS(EXTRACT(epoch FROM (realized_at - realization_due_at)) / 86400)::numeric, 1) as delay_days,
      CASE WHEN realized_value IS NULL THEN 'missing' ELSE 'matched' END as status
    FROM forecast_prospective_evaluations WHERE evaluation_locked = true
    ORDER BY realized_at DESC NULLS LAST LIMIT 10
  ) s;

  RETURN jsonb_build_object(
    'sample_size', v_total, 'matched_within_1d', v_within_1d,
    'matched_within_3d', v_within_3d, 'matched_within_7d', v_within_7d,
    'average_match_delay_days', ROUND(v_avg_delay, 2),
    'rows_with_null_actuals', v_null_actuals, 'rows_with_missing_iso3', v_missing_iso3,
    'quality_score', v_score, 'samples', v_samples, 'audited_at', now()
  );
END;
$$;

-- PART 4: Coverage Gaps
CREATE OR REPLACE FUNCTION public.prospective_coverage_gaps()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_unrealized_domains jsonb; v_zero_realized_countries jsonb;
  v_top_countries jsonb; v_weak_horizons jsonb;
BEGIN
  -- Domains with entries but no realized rows
  SELECT COALESCE(jsonb_agg(domain), '[]'::jsonb) INTO v_unrealized_domains
  FROM (
    SELECT DISTINCT domain FROM forecast_prospective_evaluations
    WHERE domain NOT IN (
      SELECT DISTINCT domain FROM forecast_prospective_evaluations WHERE evaluation_locked = true
    )
  ) d;

  -- Countries with zero realized
  SELECT COALESCE(jsonb_agg(iso3), '[]'::jsonb) INTO v_zero_realized_countries
  FROM (
    SELECT DISTINCT iso3 FROM forecast_prospective_evaluations
    WHERE iso3 NOT IN (
      SELECT DISTINCT iso3 FROM forecast_prospective_evaluations WHERE evaluation_locked = true
    )
  ) c;

  -- Top countries by volume
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_countries FROM (
    SELECT iso3, COUNT(*) as total, COUNT(*) FILTER (WHERE evaluation_locked) as realized
    FROM forecast_prospective_evaluations GROUP BY iso3 ORDER BY total DESC LIMIT 10
  ) t;

  -- Weakest horizons
  SELECT COALESCE(jsonb_agg(row_to_json(h)), '[]'::jsonb) INTO v_weak_horizons FROM (
    SELECT horizon_days, COUNT(*) as total,
      COUNT(*) FILTER (WHERE evaluation_locked) as realized,
      ROUND(AVG(absolute_error) FILTER (WHERE evaluation_locked), 3) as avg_mae
    FROM forecast_prospective_evaluations GROUP BY horizon_days ORDER BY realized ASC
  ) h;

  RETURN jsonb_build_object(
    'domains_no_realized', v_unrealized_domains,
    'countries_no_realized', v_zero_realized_countries,
    'top_countries', v_top_countries,
    'horizon_coverage', v_weak_horizons,
    'checked_at', now()
  );
END;
$$;

-- PART 6: Daily snapshot function
CREATE OR REPLACE FUNCTION public.snapshot_prospective_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_mon jsonb; v_ready jsonb;
  v_tp_acc numeric; v_mae numeric;
  v_total bigint; v_realized bigint; v_pending bigint;
  v_domains int; v_countries int;
BEGIN
  v_mon := prospective_accumulation_monitor();
  v_ready := evaluate_forecast_readiness();

  SELECT COUNT(*), COUNT(*) FILTER (WHERE evaluation_locked), COUNT(*) FILTER (WHERE NOT evaluation_locked)
  INTO v_total, v_realized, v_pending FROM forecast_prospective_evaluations;

  SELECT CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE direction_hit)::numeric / COUNT(*) * 100, 1) ELSE null END,
         ROUND(AVG(absolute_error), 3)
  INTO v_tp_acc, v_mae
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = true AND realized_direction IS NOT NULL AND realized_direction NOT IN ('stable');

  SELECT COUNT(DISTINCT domain), COUNT(DISTINCT iso3) INTO v_domains, v_countries
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  INSERT INTO forecast_prospective_health_snapshots (
    snapshot_date, total_forecasts, realized_count, pending_count,
    tp_accuracy, avg_mae, domains_covered, countries_covered,
    accumulation_status, readiness_status,
    missing_actual_count, overdue_count, new_24h, new_7d
  ) VALUES (
    CURRENT_DATE, v_total, v_realized, v_pending,
    v_tp_acc, v_mae, v_domains, v_countries,
    v_mon->>'accumulation_status', v_ready->>'status',
    (v_mon->>'missing_actual')::bigint, (v_mon->>'overdue')::bigint,
    (v_mon->>'new_24h')::bigint, (v_mon->>'new_7d')::bigint
  ) ON CONFLICT (snapshot_date) DO UPDATE SET
    total_forecasts = EXCLUDED.total_forecasts, realized_count = EXCLUDED.realized_count,
    pending_count = EXCLUDED.pending_count, tp_accuracy = EXCLUDED.tp_accuracy,
    avg_mae = EXCLUDED.avg_mae, domains_covered = EXCLUDED.domains_covered,
    countries_covered = EXCLUDED.countries_covered,
    accumulation_status = EXCLUDED.accumulation_status, readiness_status = EXCLUDED.readiness_status,
    missing_actual_count = EXCLUDED.missing_actual_count, overdue_count = EXCLUDED.overdue_count,
    new_24h = EXCLUDED.new_24h, new_7d = EXCLUDED.new_7d;

  RETURN jsonb_build_object('ok', true, 'snapshot_date', CURRENT_DATE, 'accumulation_status', v_mon->>'accumulation_status');
END;
$$;
