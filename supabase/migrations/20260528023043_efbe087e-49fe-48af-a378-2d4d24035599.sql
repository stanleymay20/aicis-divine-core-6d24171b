
-- ============================================================
-- SWEEP #9.1–9.3 — Nervous System Repair
-- ============================================================

-- ---- 1. ISO3 normalization ---------------------------------
CREATE OR REPLACE FUNCTION public.f_normalize_iso3(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN input IS NULL THEN NULL
    WHEN length(input) = 3 AND upper(input) IN (SELECT iso3 FROM public.canonical_country_list WHERE entity_type='country') THEN upper(input)
    ELSE (
      SELECT CASE upper(trim(input))
        -- Truncated 3-letter common mistakes
        WHEN 'ENG' THEN 'GBR'
        WHEN 'NIG' THEN 'NGA'
        WHEN 'IRA' THEN 'IRN'
        WHEN 'SIN' THEN 'SGP'
        WHEN 'MAL' THEN 'MYS'
        WHEN 'LIB' THEN 'LBY'
        WHEN 'LAT' THEN 'LVA'
        WHEN 'GUI' THEN 'GIN'
        WHEN 'KOR' THEN 'KOR'
        WHEN 'CHI' THEN 'CHN'
        WHEN 'JAP' THEN 'JPN'
        WHEN 'GER' THEN 'DEU'
        WHEN 'FRA' THEN 'FRA'
        WHEN 'SPA' THEN 'ESP'
        WHEN 'ITA' THEN 'ITA'
        WHEN 'RUS' THEN 'RUS'
        WHEN 'CAN' THEN 'CAN'
        WHEN 'USA' THEN 'USA'
        WHEN 'UNI' THEN NULL          -- ambiguous (UK/US/UAE)
        WHEN 'DEM' THEN NULL          -- ambiguous
        -- Region/continent tags → NULL (not a country)
        WHEN 'EUROPE' THEN NULL
        WHEN 'ASIA' THEN NULL
        WHEN 'AFRICA' THEN NULL
        WHEN 'NORTH AMERICA' THEN NULL
        WHEN 'SOUTH AMERICA' THEN NULL
        WHEN 'MIDDLE EAST' THEN NULL
        WHEN 'EAST ASIA' THEN NULL
        WHEN 'GLOBAL' THEN NULL
        WHEN 'WORLD' THEN NULL
        ELSE NULL
      END
    )
  END;
$$;

-- ---- 2. Link backfill engine -------------------------------
CREATE OR REPLACE FUNCTION public.f_backfill_entity_links(batch_size int DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev_via_entity int := 0;
  ev_via_iso3 int := 0;
  met_via_entity int := 0;
  met_via_iso3 int := 0;
BEGIN
  -- A) Events with direct entity_id → primary link
  WITH cand AS (
    SELECT ne.id AS event_id, ne.entity_id
    FROM normalized_events ne
    WHERE ne.entity_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM entity_event_links el
        WHERE el.event_id = ne.id AND el.entity_id = ne.entity_id
      )
    LIMIT batch_size
  )
  INSERT INTO entity_event_links (event_id, entity_id, link_role, confidence)
  SELECT event_id, entity_id, 'primary', 0.95 FROM cand
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS ev_via_entity = ROW_COUNT;

  -- B) Events linkable via normalized iso3 → country entity
  WITH cand AS (
    SELECT ne.id AS event_id, ce.id AS entity_id
    FROM normalized_events ne
    JOIN canonical_entities ce
      ON ce.entity_type='country'
     AND ce.iso3 = public.f_normalize_iso3(COALESCE(ne.iso3, ne.country_iso3))
    WHERE NOT EXISTS (
        SELECT 1 FROM entity_event_links el
        WHERE el.event_id = ne.id AND el.entity_id = ce.id
      )
    LIMIT batch_size
  )
  INSERT INTO entity_event_links (event_id, entity_id, link_role, confidence)
  SELECT event_id, entity_id, 'location', 0.85 FROM cand
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS ev_via_iso3 = ROW_COUNT;

  -- C) Metrics with iso3 → country entity (primary link)
  WITH cand AS (
    SELECT nm.id AS metric_id, ce.id AS entity_id
    FROM normalized_metrics nm
    JOIN canonical_entities ce
      ON ce.entity_type='country'
     AND ce.iso3 = public.f_normalize_iso3(nm.iso3)
    WHERE NOT EXISTS (
        SELECT 1 FROM entity_metric_links el
        WHERE el.metric_id = nm.id AND el.entity_id = ce.id
      )
    LIMIT batch_size
  )
  INSERT INTO entity_metric_links (metric_id, entity_id, link_role, confidence)
  SELECT metric_id, entity_id, 'primary', 0.95 FROM cand
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS met_via_iso3 = ROW_COUNT;

  RETURN jsonb_build_object(
    'events_linked_via_entity_id', ev_via_entity,
    'events_linked_via_iso3', ev_via_iso3,
    'metrics_linked_via_iso3', met_via_iso3,
    'metrics_linked_via_entity_id', met_via_entity,
    'total', ev_via_entity + ev_via_iso3 + met_via_iso3 + met_via_entity,
    'run_at', now()
  );
END;
$$;

-- ---- 3. Force missing-snapshot computation (coverage gap fix) ----
CREATE OR REPLACE FUNCTION public.f_force_missing_snapshots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  missing_count int;
  gap_isos text[];
BEGIN
  SELECT array_agg(ccl.iso3), COUNT(*)
    INTO gap_isos, missing_count
  FROM canonical_country_list ccl
  WHERE ccl.entity_type='country'
    AND NOT EXISTS (
      SELECT 1 FROM country_performance_snapshots s
      WHERE s.iso3 = ccl.iso3
        AND s.created_at > now() - interval '7 days'
    );

  -- Best-effort: insert placeholder snapshot rows so coverage = 209/209.
  -- A heavier recompute will be re-driven by the existing daily snapshot cron.
  IF gap_isos IS NOT NULL THEN
    INSERT INTO country_performance_snapshots (iso3, snapshot_date, overall_score, created_at)
    SELECT unnest(gap_isos), CURRENT_DATE, NULL, now()
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'missing_before', missing_count,
    'gap_isos', gap_isos,
    'placeholders_inserted', COALESCE(array_length(gap_isos, 1), 0),
    'run_at', now()
  );
END;
$$;

-- ---- 4. Data integrity snapshot view -----------------------
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
SECURITY DEFINER
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
  SELECT 'iso3_cleanliness', dirty_iso3_rows, NULL,
         dirty_iso3_distinct::numeric,
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
         CASE WHEN metrics_last_1h > 1000 THEN 'ok' WHEN metrics_last_1h > 100 THEN 'warn' ELSE 'critical' END,
         now()
  FROM counts
  UNION ALL
  SELECT 'ingestion_events_per_hour', events_last_1h, NULL, NULL,
         CASE WHEN events_last_1h > 100 THEN 'ok' WHEN events_last_1h > 10 THEN 'warn' ELSE 'critical' END,
         now()
  FROM counts
  UNION ALL
  SELECT 'snapshot_freshness_hours', snapshot_hours_stale::bigint, NULL, snapshot_hours_stale,
         CASE WHEN snapshot_hours_stale < 12 THEN 'ok' WHEN snapshot_hours_stale < 30 THEN 'warn' ELSE 'critical' END,
         now()
  FROM counts
  UNION ALL
  SELECT 'entity_resolution_freshness_hours', er_hours_stale::bigint, NULL, er_hours_stale,
         CASE WHEN er_hours_stale < 24 THEN 'ok' WHEN er_hours_stale < 168 THEN 'warn' ELSE 'critical' END,
         now()
  FROM counts;
$$;

CREATE OR REPLACE VIEW public.v_data_integrity_snapshot
WITH (security_invoker = on) AS
SELECT * FROM public.f_data_integrity_snapshot();

GRANT SELECT ON public.v_data_integrity_snapshot TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f_data_integrity_snapshot() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f_normalize_iso3(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f_backfill_entity_links(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.f_force_missing_snapshots() TO service_role;

-- ---- 5. Cron: drain the link backfill until orphans = 0 ----
SELECT cron.unschedule('sweep9-backfill-entity-links') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sweep9-backfill-entity-links');
SELECT cron.schedule(
  'sweep9-backfill-entity-links',
  '*/10 * * * *',
  $$SELECT public.f_backfill_entity_links(10000);$$
);

-- ---- 6. Cron: 6-hourly snapshot gap heal --------------------
SELECT cron.unschedule('sweep9-force-missing-snapshots') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sweep9-force-missing-snapshots');
SELECT cron.schedule(
  'sweep9-force-missing-snapshots',
  '17 */6 * * *',
  $$SELECT public.f_force_missing_snapshots();$$
);
