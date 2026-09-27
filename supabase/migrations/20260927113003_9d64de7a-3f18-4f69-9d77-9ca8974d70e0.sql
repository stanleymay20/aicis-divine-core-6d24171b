-- 1) Accumulation health: stop full COUNT(*) scans on multi-million row tables (hourly timeout)
CREATE OR REPLACE FUNCTION public.check_accumulation_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  v_layers jsonb := '[]'::jsonb;
  v_layer RECORD;
  v_attention int := 0;
  v_healthy int := 0;
BEGIN
  FOR v_layer IN
    SELECT *
    FROM (
      VALUES
        ('normalized_metrics', 'Metrics', 'created_at', 24::numeric),
        ('normalized_events', 'Events', 'created_at', 24::numeric),
        ('entity_links', 'Entity Links', 'created_at', 168::numeric),
        ('entity_metric_links', 'Metric Links', 'created_at', 72::numeric),
        ('entity_event_links', 'Event Links', 'created_at', 24::numeric),
        ('country_performance_snapshots', 'Snapshots', 'created_at', 24::numeric),
        ('forecast_archive', 'Forecasts', 'created_at', 24::numeric),
        ('village_indicators', 'Village Indicators', 'COALESCE(observed_at, created_at)', 720::numeric),
        ('canonical_entities', 'Entities', 'COALESCE(updated_at, created_at)', 168::numeric),
        ('crisis_events', 'Crisis', 'created_at', 24::numeric)
    ) AS t(tbl, label, freshness_expr, target_hours)
  LOOP
    DECLARE
      v_total bigint;
      v_recent bigint;
      v_last_seen timestamptz;
      v_hours_stale numeric;
      v_status text;
    BEGIN
      -- Planner statistics estimate: exact counts time out at planetary scale.
      SELECT GREATEST(COALESCE(c.reltuples, 0), 0)::bigint INTO v_total
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_layer.tbl;

      EXECUTE format(
        'SELECT COUNT(*) FROM (SELECT 1 FROM %I WHERE %s > NOW() - INTERVAL ''24 hours'' LIMIT 100000) s',
        v_layer.tbl,
        v_layer.freshness_expr
      ) INTO v_recent;
      EXECUTE format('SELECT MAX(%s) FROM %I', v_layer.freshness_expr, v_layer.tbl) INTO v_last_seen;

      v_hours_stale := CASE
        WHEN v_last_seen IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - v_last_seen)) / 3600
        ELSE 9999
      END;

      v_status := CASE
        WHEN v_recent > 0 THEN 'healthy'
        WHEN v_last_seen IS NULL THEN 'critical'
        WHEN v_hours_stale <= v_layer.target_hours THEN 'recent'
        WHEN v_hours_stale <= v_layer.target_hours * 4 THEN 'stale'
        ELSE 'critical'
      END;

      IF v_status IN ('healthy', 'recent') THEN
        v_healthy := v_healthy + 1;
      ELSE
        v_attention := v_attention + 1;
      END IF;

      v_layers := v_layers || jsonb_build_object(
        'layer', v_layer.label,
        'table', v_layer.tbl,
        'total', v_total,
        'total_is_estimate', true,
        'growth_24h', v_recent,
        'hours_stale', ROUND(v_hours_stale::numeric, 1),
        'status', v_status
      );
    EXCEPTION WHEN OTHERS THEN
      v_attention := v_attention + 1;
      v_layers := v_layers || jsonb_build_object(
        'layer', v_layer.label,
        'table', v_layer.tbl,
        'total', 0,
        'growth_24h', 0,
        'hours_stale', 9999,
        'status', 'critical',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'checked_at', NOW(),
    'healthy', v_healthy,
    'stalled', v_attention,
    'layers', v_layers
  );
END;
$function$;

-- 2) Daily accumulation miss alert violated critical_alerts_level_check ('critical' is not an allowed level)
CREATE OR REPLACE FUNCTION public.check_daily_accumulation_misses()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_snapshots bigint;
  v_forecasts bigint;
  v_alerts int := 0;
BEGIN
  SELECT COUNT(*) INTO v_snapshots FROM country_performance_snapshots WHERE created_at::date = v_today;
  SELECT COUNT(*) INTO v_forecasts FROM forecast_archive WHERE created_at::date = v_today;

  IF v_snapshots = 0 THEN
    INSERT INTO critical_alerts (headline, level, event_type, severity, meta)
    VALUES ('Accumulation MISS: Performance Snapshots = 0 today', 'urgent', 'accumulation_miss', 9,
      jsonb_build_object('layer','snapshots','expected',1629,'actual',0,'date',v_today));
    v_alerts := v_alerts + 1;
  END IF;

  IF v_forecasts = 0 THEN
    INSERT INTO critical_alerts (headline, level, event_type, severity, meta)
    VALUES ('Accumulation MISS: Forecast Archive = 0 today', 'urgent', 'accumulation_miss', 9,
      jsonb_build_object('layer','forecasts','expected',1629,'actual',0,'date',v_today));
    v_alerts := v_alerts + 1;
  END IF;

  RETURN jsonb_build_object('date', v_today, 'snapshots', v_snapshots, 'forecasts', v_forecasts,
    'alerts_raised', v_alerts, 'checked_at', now());
END;
$function$;

-- 3) Long-running maintenance/aggregation functions need more than the default statement timeout
ALTER FUNCTION public.snap_planetary_stats() SET statement_timeout TO '900s';
ALTER FUNCTION public.refresh_quantivis_materialized() SET statement_timeout TO '900s';
ALTER FUNCTION public.compute_cross_domain_influence() SET statement_timeout TO '900s';
ALTER FUNCTION public.compute_pns_certification() SET statement_timeout TO '900s';