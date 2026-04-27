
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
    WITH d AS (DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days' RETURNING 1)
    SELECT COUNT(*) INTO _cron_deleted FROM d;
  EXCEPTION WHEN OTHERS THEN _cron_deleted := -1; END;

  BEGIN
    WITH d AS (DELETE FROM public.automation_logs WHERE executed_at < now() - interval '30 days' RETURNING 1)
    SELECT COUNT(*) INTO _auto_deleted FROM d;
  EXCEPTION WHEN OTHERS THEN _auto_deleted := -1; END;

  BEGIN
    WITH d AS (DELETE FROM net._http_response WHERE created < now() - interval '3 days' RETURNING 1)
    SELECT COUNT(*) INTO _net_deleted FROM d;
  EXCEPTION WHEN OTHERS THEN _net_deleted := -1; END;

  INSERT INTO public.automation_logs (job_name, status, message)
  VALUES ('prune_retention_logs', 'success',
          jsonb_build_object('cron_deleted', _cron_deleted,
                             'automation_deleted', _auto_deleted,
                             'net_deleted', _net_deleted)::text);

  RETURN jsonb_build_object('ok', true,
                            'cron_deleted', _cron_deleted,
                            'automation_deleted', _auto_deleted,
                            'net_deleted', _net_deleted);
END;
$$;

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
    SELECT provider_name, domain, metric_name, iso3,
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

  WITH del AS (DELETE FROM public.normalized_metrics WHERE created_at < _cutoff RETURNING 1)
  SELECT COUNT(*) INTO _deleted FROM del;

  INSERT INTO public.automation_logs (job_name, status, message)
  VALUES ('archive_normalized_metrics', 'success',
          jsonb_build_object('cutoff', _cutoff, 'rollups', _rolled,
                             'deleted_rows', _deleted, 'days', _days)::text);

  RETURN jsonb_build_object('ok', true, 'cutoff', _cutoff,
                            'rollups', _rolled, 'deleted_rows', _deleted);
END;
$$;
