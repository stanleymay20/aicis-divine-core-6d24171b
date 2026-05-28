
-- Switch the read-only integrity function from DEFINER to INVOKER and restrict to authenticated
CREATE OR REPLACE FUNCTION public.f_data_integrity_snapshot()
RETURNS TABLE(
  check_name text,
  value bigint,
  total bigint,
  pct numeric,
  severity text,
  measured_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT
      (SELECT COUNT(*) FROM normalized_events) AS events_total,
      (SELECT COUNT(*) FROM normalized_events ne WHERE NOT EXISTS (SELECT 1 FROM entity_event_links el WHERE el.event_id=ne.id)) AS events_orphan,
      (SELECT COUNT(*) FROM normalized_metrics) AS metrics_total,
      (SELECT COUNT(*) FROM normalized_metrics nm WHERE NOT EXISTS (SELECT 1 FROM entity_metric_links el WHERE el.metric_id=nm.id)) AS metrics_orphan,
      (SELECT COUNT(DISTINCT iso3) FROM normalized_events WHERE iso3 IS NOT NULL AND iso3 NOT IN (SELECT iso3 FROM canonical_country_list)) AS dirty_iso3_distinct,
      (SELECT COUNT(*) FROM normalized_events WHERE iso3 IS NOT NULL AND iso3 NOT IN (SELECT iso3 FROM canonical_country_list)) AS dirty_iso3_rows,
      (SELECT COUNT(*) FROM canonical_country_list WHERE entity_type='country') AS canonical_countries,
      (SELECT COUNT(*) FROM canonical_country_list ccl WHERE ccl.entity_type='country' AND NOT EXISTS (SELECT 1 FROM country_performance_snapshots s WHERE s.iso3=ccl.iso3 AND s.created_at > now() - interval '7 days')) AS coverage_gap,
      (SELECT COUNT(*) FROM normalized_metrics WHERE created_at > now() - interval '1 hour') AS metrics_last_1h,
      (SELECT COUNT(*) FROM normalized_events WHERE created_at > now() - interval '1 hour') AS events_last_1h,
      (SELECT EXTRACT(EPOCH FROM (now() - MAX(created_at)))/3600 FROM canonical_entities)::numeric AS er_hours_stale,
      (SELECT EXTRACT(EPOCH FROM (now() - MAX(created_at)))/3600 FROM country_performance_snapshots)::numeric AS snapshot_hours_stale
  )
  SELECT 'event_link_completeness', events_total - events_orphan, events_total,
         ROUND((1 - events_orphan::numeric / NULLIF(events_total,0)) * 100, 2),
         CASE WHEN events_orphan::numeric / NULLIF(events_total,0) < 0.05 THEN 'ok'
              WHEN events_orphan::numeric / NULLIF(events_total,0) < 0.20 THEN 'warn'
              ELSE 'critical' END,
         now()
  FROM counts
  UNION ALL
  SELECT 'metric_link_completeness', metrics_total - metrics_orphan, metrics_total,
         ROUND((1 - metrics_orphan::numeric / NULLIF(metrics_total,0)) * 100, 2),
         CASE WHEN metrics_orphan::numeric / NULLIF(metrics_total,0) < 0.05 THEN 'ok'
              WHEN metrics_orphan::numeric / NULLIF(metrics_total,0) < 0.20 THEN 'warn'
              ELSE 'critical' END,
         now()
  FROM counts
  UNION ALL
  SELECT 'iso3_cleanliness', dirty_iso3_rows, NULL, dirty_iso3_distinct::numeric,
         CASE WHEN dirty_iso3_rows = 0 THEN 'ok' WHEN dirty_iso3_rows < 500 THEN 'warn' ELSE 'critical' END,
         now()
  FROM counts
  UNION ALL
  SELECT 'country_coverage', canonical_countries - coverage_gap, canonical_countries,
         ROUND(((canonical_countries - coverage_gap)::numeric / NULLIF(canonical_countries,0)) * 100, 2),
         CASE WHEN coverage_gap = 0 THEN 'ok' WHEN coverage_gap < 10 THEN 'warn' ELSE 'critical' END,
         now()
  FROM counts
  UNION ALL
  SELECT 'ingestion_metrics_per_hour', metrics_last_1h, NULL, NULL,
         CASE WHEN metrics_last_1h > 1000 THEN 'ok' WHEN metrics_last_1h > 100 THEN 'warn' ELSE 'critical' END, now()
  FROM counts
  UNION ALL
  SELECT 'ingestion_events_per_hour', events_last_1h, NULL, NULL,
         CASE WHEN events_last_1h > 100 THEN 'ok' WHEN events_last_1h > 10 THEN 'warn' ELSE 'critical' END, now()
  FROM counts
  UNION ALL
  SELECT 'snapshot_freshness_hours', snapshot_hours_stale::bigint, NULL, snapshot_hours_stale,
         CASE WHEN snapshot_hours_stale < 12 THEN 'ok' WHEN snapshot_hours_stale < 30 THEN 'warn' ELSE 'critical' END, now()
  FROM counts
  UNION ALL
  SELECT 'entity_resolution_freshness_hours', er_hours_stale::bigint, NULL, er_hours_stale,
         CASE WHEN er_hours_stale < 24 THEN 'ok' WHEN er_hours_stale < 168 THEN 'warn' ELSE 'critical' END, now()
  FROM counts;
$$;

-- Restrict to authenticated only
REVOKE EXECUTE ON FUNCTION public.f_data_integrity_snapshot() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.f_data_integrity_snapshot() TO authenticated, service_role;

REVOKE SELECT ON public.v_data_integrity_snapshot FROM anon;
GRANT SELECT ON public.v_data_integrity_snapshot TO authenticated;

-- Same for normalize: keep it open (immutable, no data access) — make INVOKER explicit
ALTER FUNCTION public.f_normalize_iso3(text) SECURITY INVOKER;

-- Optimize backfill: split into 3 narrow functions so each runs well under cron timeout
CREATE OR REPLACE FUNCTION public.f_backfill_event_links_by_entity(batch_size int DEFAULT 5000)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH cand AS (
    SELECT ne.id AS event_id, ne.entity_id FROM normalized_events ne
    WHERE ne.entity_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM entity_event_links el WHERE el.event_id=ne.id AND el.entity_id=ne.entity_id)
    LIMIT batch_size
  )
  INSERT INTO entity_event_links (event_id, entity_id, link_role, confidence)
  SELECT event_id, entity_id, 'primary', 0.95 FROM cand
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;$$;

CREATE OR REPLACE FUNCTION public.f_backfill_event_links_by_iso3(batch_size int DEFAULT 5000)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH cand AS (
    SELECT ne.id AS event_id, ce.id AS entity_id
    FROM normalized_events ne
    JOIN canonical_entities ce ON ce.entity_type='country' AND ce.iso3 = public.f_normalize_iso3(COALESCE(ne.iso3, ne.country_iso3))
    WHERE NOT EXISTS (SELECT 1 FROM entity_event_links el WHERE el.event_id=ne.id AND el.entity_id=ce.id)
    LIMIT batch_size
  )
  INSERT INTO entity_event_links (event_id, entity_id, link_role, confidence)
  SELECT event_id, entity_id, 'location', 0.85 FROM cand
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;$$;

CREATE OR REPLACE FUNCTION public.f_backfill_metric_links_by_iso3(batch_size int DEFAULT 5000)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH cand AS (
    SELECT nm.id AS metric_id, ce.id AS entity_id
    FROM normalized_metrics nm
    JOIN canonical_entities ce ON ce.entity_type='country' AND ce.iso3 = public.f_normalize_iso3(nm.iso3)
    WHERE NOT EXISTS (SELECT 1 FROM entity_metric_links el WHERE el.metric_id=nm.id AND el.entity_id=ce.id)
    LIMIT batch_size
  )
  INSERT INTO entity_metric_links (metric_id, entity_id, link_role, confidence)
  SELECT metric_id, entity_id, 'primary', 0.95 FROM cand
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;$$;

REVOKE EXECUTE ON FUNCTION public.f_backfill_event_links_by_entity(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.f_backfill_event_links_by_iso3(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.f_backfill_metric_links_by_iso3(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f_backfill_event_links_by_entity(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.f_backfill_event_links_by_iso3(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.f_backfill_metric_links_by_iso3(int) TO service_role;

-- Stagger crons across three slots
SELECT cron.unschedule('sweep9-backfill-entity-links') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sweep9-backfill-entity-links');
SELECT cron.schedule('sweep9-bf-ev-entity', '*/5 * * * *', $$SELECT public.f_backfill_event_links_by_entity(3000);$$);
SELECT cron.schedule('sweep9-bf-ev-iso3',   '1-59/5 * * * *', $$SELECT public.f_backfill_event_links_by_iso3(3000);$$);
SELECT cron.schedule('sweep9-bf-met-iso3',  '2-59/5 * * * *', $$SELECT public.f_backfill_metric_links_by_iso3(3000);$$);
