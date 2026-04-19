
-- Fix 1: Repair snap_planetary_stats — remove non-existent retrieved_at column
CREATE OR REPLACE FUNCTION public.snap_planetary_stats()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_metrics bigint; v_entities bigint; v_ml bigint; v_el bigint; v_entl bigint;
  v_prov bigint; v_rc int; v_cc int; v_mcc int;
  v_link_pct numeric; v_prov_pct numeric; v_prov_complete numeric;
  v_dup_rate numeric; v_mismatches int; v_offsets jsonb;
BEGIN
  SELECT COUNT(*) INTO v_metrics FROM normalized_metrics;
  SELECT COUNT(*) INTO v_entities FROM canonical_entities;
  SELECT COUNT(*) INTO v_ml FROM entity_metric_links;
  SELECT COUNT(*) INTO v_el FROM entity_event_links;
  SELECT COUNT(*) INTO v_entl FROM entity_links;
  SELECT COUNT(DISTINCT provenance_source) INTO v_prov FROM normalized_metrics WHERE provenance_source IS NOT NULL;

  SELECT COUNT(*) INTO v_rc FROM canonical_entities
    WHERE entity_type::text IN ('country','territory') AND sovereignty_status IN ('sovereign_state','territory','disputed');
  SELECT COUNT(*) INTO v_cc FROM canonical_entities
    WHERE entity_type::text IN ('country','territory') AND sovereignty_status != 'deprecated';
  SELECT COUNT(DISTINCT iso3) INTO v_mcc FROM normalized_metrics WHERE iso3 IS NOT NULL;

  v_link_pct := CASE WHEN v_metrics > 0 THEN ROUND(v_ml::numeric / v_metrics * 100, 2) ELSE 0 END;
  v_prov_pct := CASE WHEN v_metrics > 0 THEN ROUND((SELECT COUNT(*) FROM normalized_metrics WHERE provenance_source IS NOT NULL)::numeric / v_metrics * 100, 2) ELSE 0 END;

  -- Provenance completeness: % of metrics with all 3 available fields populated
  SELECT CASE WHEN v_metrics > 0 THEN ROUND(
    COUNT(*) FILTER (WHERE
      provider_name IS NOT NULL
      AND provenance_source IS NOT NULL
      AND freshness_score IS NOT NULL
    )::numeric / v_metrics * 100, 2
  ) ELSE 0 END
  INTO v_prov_complete FROM normalized_metrics;

  SELECT CASE WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) - COUNT(DISTINCT dedup_key))::numeric / COUNT(*) * 100, 2)
    ELSE 0 END
  INTO v_dup_rate FROM normalized_metrics WHERE dedup_key IS NOT NULL;

  SELECT COUNT(DISTINCT nm.iso3) INTO v_mismatches
  FROM normalized_metrics nm
  WHERE nm.iso3 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM canonical_entities ce
      WHERE ce.iso3 = nm.iso3 AND ce.entity_type::text IN ('country','territory')
    );

  SELECT jsonb_object_agg(key, value_int) INTO v_offsets FROM backfill_state;

  INSERT INTO planetary_stats_snapshots (
    metrics_total, entities_total, metric_links, event_links, entity_links,
    provenance_sources, reporting_countries, coverage_countries, metrics_country_coverage,
    link_to_metric_pct, provenance_pct, provenance_completeness_pct,
    duplicate_rate_pct, canonical_mismatches, job_offsets
  ) VALUES (
    v_metrics, v_entities, v_ml, v_el, v_entl,
    v_prov, v_rc, v_cc, v_mcc,
    v_link_pct, v_prov_pct, v_prov_complete,
    v_dup_rate, v_mismatches, COALESCE(v_offsets, '{}')
  );
END;
$function$;

-- Fix 2: Daily miss-day check for snapshots & forecasts
-- Fires a critical_alert if today's count is 0 by mid-day UTC
CREATE OR REPLACE FUNCTION public.check_daily_accumulation_misses()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_snapshots bigint;
  v_forecasts bigint;
  v_alerts int := 0;
BEGIN
  SELECT COUNT(*) INTO v_snapshots
  FROM country_performance_snapshots
  WHERE created_at::date = v_today;

  SELECT COUNT(*) INTO v_forecasts
  FROM forecast_archive
  WHERE created_at::date = v_today;

  IF v_snapshots = 0 THEN
    INSERT INTO critical_alerts (headline, level, event_type, severity, meta)
    VALUES (
      'Accumulation MISS: Performance Snapshots = 0 today',
      'critical', 'accumulation_miss', 9,
      jsonb_build_object('layer','snapshots','expected',1629,'actual',0,'date',v_today)
    );
    v_alerts := v_alerts + 1;
  END IF;

  IF v_forecasts = 0 THEN
    INSERT INTO critical_alerts (headline, level, event_type, severity, meta)
    VALUES (
      'Accumulation MISS: Forecast Archive = 0 today',
      'critical', 'accumulation_miss', 9,
      jsonb_build_object('layer','forecasts','expected',1629,'actual',0,'date',v_today)
    );
    v_alerts := v_alerts + 1;
  END IF;

  RETURN jsonb_build_object(
    'date', v_today,
    'snapshots', v_snapshots,
    'forecasts', v_forecasts,
    'alerts_raised', v_alerts,
    'checked_at', now()
  );
END;
$function$;
