-- lovable-cron-fallback-reviewed: temporary backlog drain of ~116GB; keeps existing 5-min cadence and self-unschedules when empty
CREATE OR REPLACE FUNCTION public.purge_derived_community_metrics(_batch integer DEFAULT 20000, _keep_days integer DEFAULT 7)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '240s'
AS $function$
DECLARE _deleted integer;
BEGIN
  DELETE FROM public.community_metrics cm
  WHERE cm.id IN (
    SELECT id FROM public.community_metrics
    WHERE captured_at < now() - make_interval(days => _keep_days)
      AND source = 'derived_admin_regions'
    ORDER BY captured_at
    LIMIT _batch
  );
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  IF _deleted > 0 THEN
    INSERT INTO public.automation_logs (job_name, status, message)
    VALUES ('purge-derived-community-metrics', 'success',
            format('Deleted %s derived community_metrics rows older than %s days', _deleted, _keep_days));
  ELSE
    PERFORM cron.unschedule('purge-derived-community-metrics');
  END IF;
  RETURN _deleted;
END;
$function$;

DO $$ BEGIN
  PERFORM cron.unschedule('purge-derived-community-metrics');
  PERFORM cron.schedule('purge-derived-community-metrics', '*/5 * * * *', 'SELECT public.purge_derived_community_metrics(20000, 7);');
END $$;