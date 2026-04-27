
-- 1. Compressed monthly archive for normalized_metrics
CREATE TABLE IF NOT EXISTS public.normalized_metrics_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  domain text NOT NULL,
  metric_name text NOT NULL,
  iso3 text,
  month date NOT NULL,
  sample_count integer NOT NULL,
  mean_value double precision,
  min_value double precision,
  max_value double precision,
  last_value double precision,
  last_period text,
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_name, domain, metric_name, iso3, month)
);

CREATE INDEX IF NOT EXISTS idx_nma_iso3_domain_month ON public.normalized_metrics_archive (iso3, domain, month DESC);
CREATE INDEX IF NOT EXISTS idx_nma_metric_month ON public.normalized_metrics_archive (metric_name, month DESC);

ALTER TABLE public.normalized_metrics_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "archive_read_authenticated" ON public.normalized_metrics_archive;
CREATE POLICY "archive_read_authenticated"
  ON public.normalized_metrics_archive FOR SELECT
  TO authenticated
  USING (true);

-- 2. Archive function: rollup then delete
CREATE OR REPLACE FUNCTION public.archive_normalized_metrics_older_than(_days integer DEFAULT 180)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cutoff timestamptz := now() - make_interval(days => _days);
  _rolled integer := 0;
  _deleted integer := 0;
BEGIN
  WITH agg AS (
    SELECT
      provider_name,
      domain,
      metric_name,
      iso3,
      date_trunc('month', created_at)::date AS month,
      COUNT(*)::int AS sample_count,
      AVG(value) AS mean_value,
      MIN(value) AS min_value,
      MAX(value) AS max_value,
      (ARRAY_AGG(value ORDER BY created_at DESC))[1] AS last_value,
      (ARRAY_AGG(period ORDER BY created_at DESC))[1] AS last_period
    FROM public.normalized_metrics
    WHERE created_at < _cutoff
    GROUP BY provider_name, domain, metric_name, iso3, date_trunc('month', created_at)
  ),
  ins AS (
    INSERT INTO public.normalized_metrics_archive
      (provider_name, domain, metric_name, iso3, month,
       sample_count, mean_value, min_value, max_value, last_value, last_period)
    SELECT provider_name, domain, metric_name, iso3, month,
           sample_count, mean_value, min_value, max_value, last_value, last_period
    FROM agg
    ON CONFLICT (provider_name, domain, metric_name, iso3, month) DO UPDATE
      SET sample_count = EXCLUDED.sample_count,
          mean_value = EXCLUDED.mean_value,
          min_value = EXCLUDED.min_value,
          max_value = EXCLUDED.max_value,
          last_value = EXCLUDED.last_value,
          last_period = EXCLUDED.last_period,
          archived_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO _rolled FROM ins;

  WITH del AS (
    DELETE FROM public.normalized_metrics
    WHERE created_at < _cutoff
    RETURNING 1
  )
  SELECT COUNT(*) INTO _deleted FROM del;

  INSERT INTO public.automation_logs (pipeline_name, success, metadata)
  VALUES ('archive_normalized_metrics',
          true,
          jsonb_build_object('cutoff', _cutoff, 'rollups', _rolled, 'deleted_rows', _deleted, 'days', _days));

  RETURN jsonb_build_object('ok', true, 'cutoff', _cutoff, 'rollups', _rolled, 'deleted_rows', _deleted);
END;
$$;

-- 3. Log retention pruner
CREATE OR REPLACE FUNCTION public.prune_retention_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cron_deleted bigint := 0;
  _auto_deleted bigint := 0;
  _net_deleted bigint := 0;
BEGIN
  BEGIN
    WITH d AS (
      DELETE FROM cron.job_run_details
      WHERE start_time < now() - interval '7 days'
      RETURNING 1
    )
    SELECT COUNT(*) INTO _cron_deleted FROM d;
  EXCEPTION WHEN OTHERS THEN _cron_deleted := -1; END;

  BEGIN
    WITH d AS (
      DELETE FROM public.automation_logs
      WHERE executed_at < now() - interval '30 days'
      RETURNING 1
    )
    SELECT COUNT(*) INTO _auto_deleted FROM d;
  EXCEPTION WHEN OTHERS THEN _auto_deleted := -1; END;

  BEGIN
    WITH d AS (
      DELETE FROM net._http_response
      WHERE created < now() - interval '3 days'
      RETURNING 1
    )
    SELECT COUNT(*) INTO _net_deleted FROM d;
  EXCEPTION WHEN OTHERS THEN _net_deleted := -1; END;

  INSERT INTO public.automation_logs (pipeline_name, success, metadata)
  VALUES ('prune_retention_logs',
          true,
          jsonb_build_object('cron_deleted', _cron_deleted,
                             'automation_deleted', _auto_deleted,
                             'net_deleted', _net_deleted));

  RETURN jsonb_build_object('ok', true,
                            'cron_deleted', _cron_deleted,
                            'automation_deleted', _auto_deleted,
                            'net_deleted', _net_deleted);
END;
$$;

-- 4. Schedule the jobs (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('retention-logs-daily');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('archive-normalized-metrics-weekly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'retention-logs-daily',
  '15 3 * * *',
  $$ SELECT public.prune_retention_logs(); $$
);

SELECT cron.schedule(
  'archive-normalized-metrics-weekly',
  '0 4 * * 0',
  $$ SELECT public.archive_normalized_metrics_older_than(180); $$
);
