
-- ══════════════════════════════════════════════════════
-- 1. SUMMARY STATS (replaces client-side limited fetch)
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.prospective_summary_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
  v_locked bigint;
  v_pending bigint;
  v_tp_total bigint;
  v_tp_hits bigint;
  v_avg_mae numeric;
  v_dir_hits bigint;
  v_domain_count bigint;
  v_country_count bigint;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE evaluation_locked),
         COUNT(*) FILTER (WHERE NOT evaluation_locked)
  INTO v_total, v_locked, v_pending
  FROM forecast_prospective_evaluations;

  SELECT COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable'),
         COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable' AND direction_hit),
         COUNT(*) FILTER (WHERE direction_hit)
  INTO v_tp_total, v_tp_hits, v_dir_hits
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = true;

  SELECT COALESCE(AVG(absolute_error), 0)
  INTO v_avg_mae
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = true AND absolute_error IS NOT NULL;

  SELECT COUNT(DISTINCT domain), COUNT(DISTINCT iso3)
  INTO v_domain_count, v_country_count
  FROM forecast_prospective_evaluations;

  RETURN jsonb_build_object(
    'total', v_total,
    'locked', v_locked,
    'pending', v_pending,
    'tp_total', v_tp_total,
    'tp_hits', v_tp_hits,
    'tp_accuracy', CASE WHEN v_tp_total > 0 THEN ROUND(v_tp_hits::numeric / v_tp_total * 100) ELSE 0 END,
    'avg_mae', ROUND(v_avg_mae, 2),
    'direction_hit_rate', CASE WHEN v_locked > 0 THEN ROUND(v_dir_hits::numeric / v_locked * 100) ELSE 0 END,
    'domain_count', v_domain_count,
    'country_count', v_country_count
  );
END;
$$;

-- ══════════════════════════════════════════════════════
-- 2. DOMAIN BREAKDOWN
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.prospective_domain_breakdown()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY sample_size DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'domain', domain,
        'sample_size', COUNT(*),
        'tp_total', COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable'),
        'tp_hits', COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable' AND direction_hit),
        'tp_accuracy', CASE
          WHEN COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable') > 0
          THEN ROUND(COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable' AND direction_hit)::numeric
               / COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable') * 100)
          ELSE 0 END,
        'mae', ROUND(COALESCE(AVG(absolute_error) FILTER (WHERE absolute_error IS NOT NULL), 0), 2),
        'status', CASE
          WHEN COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable') = 0 THEN 'no_data'
          WHEN ROUND(COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable' AND direction_hit)::numeric
               / NULLIF(COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable'), 0) * 100) >= 60 THEN 'good'
          WHEN ROUND(COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable' AND direction_hit)::numeric
               / NULLIF(COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable'), 0) * 100) >= 30 THEN 'moderate'
          ELSE 'weak' END
      ) AS row_data,
      COUNT(*) AS sample_size
      FROM forecast_prospective_evaluations
      WHERE evaluation_locked = true
      GROUP BY domain
    ) sub
  );
END;
$$;

-- ══════════════════════════════════════════════════════
-- 3. HORIZON BREAKDOWN
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.prospective_horizon_breakdown()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY min_h), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'horizon', CASE
          WHEN horizon_days <= 7 THEN '7d'
          WHEN horizon_days <= 14 THEN '14d'
          WHEN horizon_days <= 30 THEN '30d'
          WHEN horizon_days <= 60 THEN '60d'
          ELSE '90d+' END,
        'sample_size', COUNT(*),
        'accuracy', CASE WHEN COUNT(*) > 0
          THEN ROUND(COUNT(*) FILTER (WHERE direction_hit)::numeric / COUNT(*) * 100)
          ELSE 0 END,
        'mae', ROUND(COALESCE(AVG(absolute_error) FILTER (WHERE absolute_error IS NOT NULL), 0), 2)
      ) AS row_data,
      MIN(horizon_days) AS min_h
      FROM forecast_prospective_evaluations
      WHERE evaluation_locked = true
      GROUP BY CASE
        WHEN horizon_days <= 7 THEN '7d'
        WHEN horizon_days <= 14 THEN '14d'
        WHEN horizon_days <= 30 THEN '30d'
        WHEN horizon_days <= 60 THEN '60d'
        ELSE '90d+' END
    ) sub
  );
END;
$$;

-- ══════════════════════════════════════════════════════
-- 4. MODEL BREAKDOWN
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.prospective_model_breakdown()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY sample_size DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'model_version', model_version,
        'sample_size', COUNT(*),
        'tp_accuracy', CASE
          WHEN COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable') > 0
          THEN ROUND(COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable' AND direction_hit)::numeric
               / COUNT(*) FILTER (WHERE realized_direction IS NOT NULL AND realized_direction != 'stable') * 100)
          ELSE 0 END,
        'mae', ROUND(COALESCE(AVG(absolute_error) FILTER (WHERE absolute_error IS NOT NULL), 0), 2)
      ) AS row_data,
      COUNT(*) AS sample_size
      FROM forecast_prospective_evaluations
      WHERE evaluation_locked = true
      GROUP BY model_version
    ) sub
  );
END;
$$;

-- ══════════════════════════════════════════════════════
-- 5. PROSPECTIVE HEALTH CHECK (alerts)
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_prospective_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_24h bigint;
  v_overdue bigint;
  v_missing_rate numeric;
  v_missing_total bigint;
  v_checked_total bigint;
  v_duplicates bigint;
  v_alerts jsonb := '[]'::jsonb;
BEGIN
  -- 1. Zero new prospective forecasts in 24h
  SELECT COUNT(*) INTO v_new_24h
  FROM forecast_prospective_evaluations
  WHERE created_at >= now() - interval '24 hours';

  IF v_new_24h = 0 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'type', 'zero_new_forecasts',
      'severity', 'warning',
      'message', 'No new prospective forecasts inserted in the last 24 hours',
      'value', 0
    );
  END IF;

  -- 2. Overdue unrealized forecasts (due > 48h ago, still unlocked, no missing_actual)
  SELECT COUNT(*) INTO v_overdue
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = false
    AND realization_due_at < now() - interval '48 hours'
    AND (metadata IS NULL OR metadata->>'status' IS DISTINCT FROM 'missing_actual');

  IF v_overdue > 0 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'type', 'overdue_unrealized',
      'severity', CASE WHEN v_overdue > 50 THEN 'critical' ELSE 'warning' END,
      'message', v_overdue || ' forecasts are overdue for realization (>48h past due)',
      'value', v_overdue
    );
  END IF;

  -- 3. High missing_actual rate
  SELECT COUNT(*) FILTER (WHERE metadata->>'status' = 'missing_actual'),
         COUNT(*) FILTER (WHERE realization_due_at < now())
  INTO v_missing_total, v_checked_total
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = false;

  v_missing_rate := CASE WHEN v_checked_total > 0
    THEN ROUND(v_missing_total::numeric / v_checked_total * 100, 1)
    ELSE 0 END;

  IF v_missing_rate > 50 AND v_checked_total >= 10 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'type', 'high_missing_actual',
      'severity', 'warning',
      'message', v_missing_rate || '% of due forecasts have no matching actual data (' || v_missing_total || '/' || v_checked_total || ')',
      'value', v_missing_rate
    );
  END IF;

  -- 4. Duplicate prospective inserts (same forecast_id + horizon_days)
  SELECT COUNT(*) INTO v_duplicates
  FROM (
    SELECT forecast_id, horizon_days, COUNT(*) AS cnt
    FROM forecast_prospective_evaluations
    WHERE forecast_id IS NOT NULL
    GROUP BY forecast_id, horizon_days
    HAVING COUNT(*) > 1
  ) dups;

  IF v_duplicates > 0 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'type', 'duplicate_inserts',
      'severity', 'warning',
      'message', v_duplicates || ' duplicate forecast+horizon combinations detected',
      'value', v_duplicates
    );
  END IF;

  -- Insert critical alerts
  FOR i IN 0..jsonb_array_length(v_alerts) - 1 LOOP
    IF (v_alerts->i->>'severity') IN ('critical', 'warning') THEN
      INSERT INTO critical_alerts (headline, level, event_type, meta)
      VALUES (
        'Prospective: ' || (v_alerts->i->>'message'),
        v_alerts->i->>'severity',
        'prospective_health',
        v_alerts->i
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_alerts) = 0,
    'alerts', v_alerts,
    'new_24h', v_new_24h,
    'overdue', v_overdue,
    'missing_rate_pct', v_missing_rate,
    'duplicates', v_duplicates,
    'checked_at', now()
  );
END;
$$;
