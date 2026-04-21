
-- 1. Read-only version of check_accumulation_health (no INSERTs)
CREATE OR REPLACE FUNCTION public.check_accumulation_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_layers jsonb := '[]'::jsonb;
  v_layer RECORD;
  v_stalled int := 0;
  v_healthy int := 0;
BEGIN
  FOR v_layer IN
    SELECT * FROM (VALUES
      ('normalized_metrics', 'Metrics'),
      ('normalized_events', 'Events'),
      ('entity_links', 'Entity Links'),
      ('entity_metric_links', 'Metric Links'),
      ('entity_event_links', 'Event Links'),
      ('country_performance_snapshots', 'Snapshots'),
      ('forecast_archive', 'Forecasts'),
      ('village_indicators', 'Village Indicators'),
      ('canonical_entities', 'Entities'),
      ('crisis_events', 'Crisis')
    ) AS t(tbl, label)
  LOOP
    DECLARE
      v_total bigint;
      v_recent bigint;
      v_last_insert timestamptz;
      v_hours_stale numeric;
      v_is_stalled boolean;
    BEGIN
      EXECUTE format('SELECT COUNT(*) FROM %I', v_layer.tbl) INTO v_total;
      EXECUTE format('SELECT COUNT(*) FROM %I WHERE created_at > NOW() - INTERVAL ''24 hours''', v_layer.tbl) INTO v_recent;
      EXECUTE format('SELECT MAX(created_at) FROM %I', v_layer.tbl) INTO v_last_insert;

      v_hours_stale := CASE WHEN v_last_insert IS NOT NULL
        THEN EXTRACT(EPOCH FROM (NOW() - v_last_insert)) / 3600
        ELSE 9999 END;
      v_is_stalled := v_recent = 0 AND v_total > 0;

      IF v_is_stalled THEN v_stalled := v_stalled + 1;
      ELSE v_healthy := v_healthy + 1; END IF;

      v_layers := v_layers || jsonb_build_object(
        'layer', v_layer.label, 'table', v_layer.tbl,
        'total', v_total, 'growth_24h', v_recent,
        'hours_stale', ROUND(v_hours_stale::numeric, 1),
        'status', CASE
          WHEN v_recent > 0 THEN 'healthy'
          WHEN v_hours_stale < 48 THEN 'recent'
          WHEN v_hours_stale < 168 THEN 'stale'
          ELSE 'critical'
        END
      );
    EXCEPTION WHEN OTHERS THEN
      v_layers := v_layers || jsonb_build_object(
        'layer', v_layer.label, 'table', v_layer.tbl,
        'total', 0, 'growth_24h', 0, 'hours_stale', 9999,
        'status', 'critical', 'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'checked_at', NOW(),
    'healthy', v_healthy,
    'stalled', v_stalled,
    'layers', v_layers
  );
END;
$function$;

-- 2. Side-effecting variant for the cron to write audit + alerts
CREATE OR REPLACE FUNCTION public.run_accumulation_health_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_report jsonb;
  v_layer jsonb;
  v_healthy int;
  v_stalled int;
BEGIN
  v_report := public.check_accumulation_health();
  v_healthy := (v_report->>'healthy')::int;
  v_stalled := (v_report->>'stalled')::int;

  FOR v_layer IN SELECT * FROM jsonb_array_elements(v_report->'layers')
  LOOP
    IF (v_layer->>'status') IN ('stale','critical')
       AND (v_layer->>'hours_stale')::numeric > 48 THEN
      INSERT INTO alerts (title, message, severity, division, metadata)
      VALUES (
        'Stalled: ' || (v_layer->>'layer'),
        (v_layer->>'layer') || ' has no new data in ' ||
          ROUND((v_layer->>'hours_stale')::numeric) || ' hours',
        CASE WHEN (v_layer->>'hours_stale')::numeric > 168 THEN 'critical' ELSE 'high' END,
        'system',
        v_layer
      );
    END IF;
  END LOOP;

  INSERT INTO data_quality_audits (audit_type, layer, score, passed, findings, sample_size)
  VALUES (
    'accumulation_health', 'all_layers',
    ROUND((v_healthy::numeric / GREATEST(v_healthy + v_stalled, 1)) * 100, 1),
    v_stalled = 0,
    v_report,
    v_healthy + v_stalled
  );

  RETURN v_report;
END;
$function$;

-- 3. Drop heartbeat rows for pipelines that have no implementation
DELETE FROM public.pipeline_heartbeats
WHERE pipeline_name IN ('check-daily-accumulation-misses', 'snapshot-prospective-health');
