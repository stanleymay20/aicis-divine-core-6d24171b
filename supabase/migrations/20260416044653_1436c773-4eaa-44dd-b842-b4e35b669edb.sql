
CREATE OR REPLACE VIEW public.daily_accumulation AS
SELECT 'snapshots'::text AS metric, snapshot_date AS day, count(*) AS count
FROM country_performance_snapshots GROUP BY snapshot_date
UNION ALL
SELECT 'forecasts', date(created_at), count(*) FROM forecast_archive GROUP BY date(created_at)
UNION ALL
SELECT 'calibration', date(computed_at), count(*) FROM calibration_metrics GROUP BY date(computed_at)
UNION ALL
SELECT 'vulnerability', date(created_at), count(*) FROM vulnerability_scores GROUP BY date(created_at)
UNION ALL
SELECT 'normalized_metrics', date(created_at), count(*) FROM normalized_metrics GROUP BY date(created_at)
UNION ALL
SELECT 'normalized_events', date(created_at), count(*) FROM normalized_events GROUP BY date(created_at)
UNION ALL
SELECT 'entity_links', date(created_at), count(*) FROM entity_links GROUP BY date(created_at)
UNION ALL
SELECT 'entity_metric_links', date(created_at), count(*) FROM entity_metric_links GROUP BY date(created_at)
UNION ALL
SELECT 'village_indicators', date(created_at), count(*) FROM village_indicators GROUP BY date(created_at)
UNION ALL
SELECT 'intelligence_scores', date(created_at), count(*) FROM intelligence_score_snapshots GROUP BY date(created_at);

CREATE OR REPLACE FUNCTION public.check_accumulation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_stalled int := 0;
  v_layer RECORD;
BEGIN
  FOR v_layer IN
    SELECT * FROM (VALUES
      ('normalized_metrics', (SELECT COUNT(*) FROM normalized_metrics WHERE created_at >= now() - interval '24 hours')),
      ('country_performance_snapshots', (SELECT COUNT(*) FROM country_performance_snapshots WHERE created_at >= now() - interval '24 hours')),
      ('forecast_archive', (SELECT COUNT(*) FROM forecast_archive WHERE created_at >= now() - interval '24 hours')),
      ('calibration_metrics', (SELECT COUNT(*) FROM calibration_metrics WHERE computed_at >= now() - interval '24 hours')),
      ('entity_metric_links', (SELECT COUNT(*) FROM entity_metric_links WHERE created_at >= now() - interval '24 hours')),
      ('entity_links', (SELECT COUNT(*) FROM entity_links WHERE created_at >= now() - interval '24 hours')),
      ('normalized_events', (SELECT COUNT(*) FROM normalized_events WHERE created_at >= now() - interval '24 hours')),
      ('intelligence_score_snapshots', (SELECT COUNT(*) FROM intelligence_score_snapshots WHERE created_at >= now() - interval '24 hours'))
    ) AS t(layer_name, new_records)
  LOOP
    v_result := v_result || jsonb_build_object(
      'layer', v_layer.layer_name,
      'new_24h', v_layer.new_records,
      'healthy', v_layer.new_records > 0
    );
    IF v_layer.new_records = 0 THEN
      v_stalled := v_stalled + 1;
      INSERT INTO alerts (title, message, severity, division, metadata)
      VALUES (
        'Zero Growth: ' || v_layer.layer_name,
        v_layer.layer_name || ' has zero new records in the last 24h. Pipeline may be stalled.',
        CASE WHEN v_layer.layer_name IN ('normalized_metrics','country_performance_snapshots','forecast_archive') THEN 'critical' ELSE 'high' END,
        'system',
        jsonb_build_object('type', 'zero_growth_alert', 'layer', v_layer.layer_name, 'checked_at', now())
      );
    END IF;
  END LOOP;

  INSERT INTO automation_logs (job_name, status, message)
  VALUES (
    'accumulation-health-check',
    CASE WHEN v_stalled = 0 THEN 'success' ELSE 'warning' END,
    v_stalled || '/8 layers stalled in last 24h'
  );

  RETURN jsonb_build_object(
    'healthy', v_stalled = 0,
    'stalled_count', v_stalled,
    'layers', v_result,
    'checked_at', now()
  );
END;
$$;
