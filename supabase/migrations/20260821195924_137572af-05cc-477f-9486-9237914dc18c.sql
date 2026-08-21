CREATE OR REPLACE FUNCTION public.purge_derived_community_metrics(_batch int DEFAULT 100000, _keep_days int DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted integer;
BEGIN
  DELETE FROM public.community_metrics cm
  WHERE cm.ctid IN (
    SELECT ctid FROM public.community_metrics
    WHERE source = 'derived_admin_regions'
      AND captured_at < now() - make_interval(days => _keep_days)
    LIMIT _batch
  );
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  IF _deleted > 0 THEN
    INSERT INTO public.automation_logs (job_name, status, message)
    VALUES ('purge-derived-community-metrics', 'success',
            format('Deleted %s derived community_metrics rows older than %s days', _deleted, _keep_days));
  END IF;

  RETURN _deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_derived_community_metrics(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_derived_community_metrics(int, int) FROM anon;
REVOKE ALL ON FUNCTION public.purge_derived_community_metrics(int, int) FROM authenticated;

SELECT cron.schedule(
  'purge-derived-community-metrics',
  '*/5 * * * *',
  $$SELECT public.purge_derived_community_metrics(100000, 7);$$
);