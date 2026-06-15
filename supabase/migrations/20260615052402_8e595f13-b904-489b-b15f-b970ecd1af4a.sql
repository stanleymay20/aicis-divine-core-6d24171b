
-- 1. Heartbeat helper any pipeline can call after a run
CREATE OR REPLACE FUNCTION public.pipeline_pulse(
  p_name text,
  p_ok boolean DEFAULT true,
  p_duration_ms integer DEFAULT 0,
  p_message text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pipeline_health (
    pipeline_name, last_success_at, last_failure_at,
    consecutive_failures, total_runs, total_successes,
    avg_duration_ms, status, updated_at
  ) VALUES (
    p_name,
    CASE WHEN p_ok THEN now() ELSE NULL END,
    CASE WHEN p_ok THEN NULL ELSE now() END,
    CASE WHEN p_ok THEN 0 ELSE 1 END,
    1,
    CASE WHEN p_ok THEN 1 ELSE 0 END,
    GREATEST(p_duration_ms, 0),
    CASE WHEN p_ok THEN 'healthy' ELSE 'failing' END,
    now()
  )
  ON CONFLICT (pipeline_name) DO UPDATE SET
    last_success_at = CASE WHEN p_ok THEN now() ELSE pipeline_health.last_success_at END,
    last_failure_at = CASE WHEN p_ok THEN pipeline_health.last_failure_at ELSE now() END,
    consecutive_failures = CASE WHEN p_ok THEN 0 ELSE pipeline_health.consecutive_failures + 1 END,
    total_runs = pipeline_health.total_runs + 1,
    total_successes = pipeline_health.total_successes + CASE WHEN p_ok THEN 1 ELSE 0 END,
    avg_duration_ms = ((pipeline_health.avg_duration_ms * pipeline_health.total_runs) + GREATEST(p_duration_ms,0))
                      / GREATEST(pipeline_health.total_runs + 1, 1),
    status = CASE
      WHEN p_ok THEN 'healthy'
      WHEN pipeline_health.consecutive_failures + 1 >= 3 THEN 'failing'
      ELSE 'degraded'
    END,
    updated_at = now();
END $$;

-- Ensure unique key on pipeline_name (needed for ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_health_pipeline_name_uk
  ON public.pipeline_health (pipeline_name);

-- 2. Auto-mark stale pipelines (no success within staleness_threshold_hours)
CREATE OR REPLACE FUNCTION public.recompute_pipeline_health_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.pipeline_health
     SET status = 'stale',
         updated_at = now()
   WHERE status <> 'stale'
     AND (last_success_at IS NULL
          OR last_success_at < now() - (coalesce(staleness_threshold_hours, 48) || ' hours')::interval);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END $$;

-- 3. Map pipeline health view (the four feeds the map UI depends on)
CREATE OR REPLACE VIEW public.map_pipeline_health
WITH (security_invoker = true)
AS
WITH snap AS (
  SELECT max(snapshot_date)::timestamptz AS last_at,
         count(DISTINCT iso3) FILTER (WHERE snapshot_date = (SELECT max(snapshot_date) FROM country_performance_snapshots)) AS today_countries
  FROM country_performance_snapshots
),
sig AS (
  SELECT max(ingested_at) AS last_at,
         count(*) FILTER (WHERE ingested_at > now() - interval '24 hours' AND coalesce(array_length(affected_countries,1),0) > 0) AS resolved_24h,
         count(*) FILTER (WHERE ingested_at > now() - interval '24 hours') AS total_24h
  FROM global_signals
),
adj AS (SELECT max(computed_at) AS last_at, count(*) AS edges FROM adjacency_v3),
reg AS (SELECT count(*) AS regions, count(*) FILTER (WHERE lat IS NOT NULL AND lon IS NOT NULL) AS with_geo FROM admin_regions)
SELECT 'country_snapshots'::text AS feed,
       snap.last_at, snap.today_countries AS rows_fresh,
       EXTRACT(EPOCH FROM (now() - snap.last_at))/3600 AS hours_since,
       CASE WHEN snap.last_at > now() - interval '36 hours' THEN 'healthy' ELSE 'stale' END AS status
FROM snap
UNION ALL
SELECT 'signal_geo_resolution', sig.last_at, sig.resolved_24h,
       EXTRACT(EPOCH FROM (now() - sig.last_at))/3600,
       CASE WHEN sig.total_24h = 0 THEN 'stale'
            WHEN sig.resolved_24h::float / NULLIF(sig.total_24h,0) >= 0.30 THEN 'healthy'
            ELSE 'degraded' END
FROM sig
UNION ALL
SELECT 'adjacency_edges', adj.last_at, adj.edges,
       EXTRACT(EPOCH FROM (now() - adj.last_at))/3600,
       CASE WHEN adj.edges >= 1000 THEN 'healthy' ELSE 'degraded' END
FROM adj
UNION ALL
SELECT 'admin_regions', now(), reg.regions, 0,
       CASE WHEN reg.with_geo::float / NULLIF(reg.regions,0) >= 0.95 THEN 'healthy' ELSE 'degraded' END
FROM reg;

GRANT SELECT ON public.map_pipeline_health TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.pipeline_pulse(text, boolean, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_pipeline_health_statuses() TO service_role;

-- 4. Schedule auto-staleness recompute every 10 min
SELECT cron.unschedule('recompute-pipeline-health') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'recompute-pipeline-health'
);
SELECT cron.schedule(
  'recompute-pipeline-health',
  '*/10 * * * *',
  $cron$ SELECT public.recompute_pipeline_health_statuses(); $cron$
);
