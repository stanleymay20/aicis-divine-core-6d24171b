-- Schedule the global performance engine through its hardened driver.
-- The driver fans out bounded batches and requires the service-role token.

DO $$
DECLARE
  project_url text;
  service_key text;
BEGIN
  project_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pns-global-performance-engine') THEN
    PERFORM cron.unschedule('pns-global-performance-engine');
  END IF;

  IF project_url IS NOT NULL AND length(project_url) > 0
     AND service_key IS NOT NULL AND length(service_key) > 0 THEN
    PERFORM cron.schedule(
      'pns-global-performance-engine',
      '25 */6 * * *',
      format(
        $job$SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || %L,
            'Content-Type', 'application/json'
          ),
          body := jsonb_build_object('batch_size', 60),
          timeout_milliseconds := 120000
        );$job$,
        project_url || '/functions/v1/drive-performance-engine-v2',
        service_key
      )
    );

    INSERT INTO public.automation_logs(job_name, status, message)
    VALUES (
      'pns-global-performance-engine-cron',
      'success',
      'Scheduled hardened global performance driver every 6 hours at minute 25'
    );
  ELSE
    INSERT INTO public.automation_logs(job_name, status, message)
    VALUES (
      'pns-global-performance-engine-cron',
      'warning',
      'Cron not installed because app.settings.supabase_url/service_role_key are unavailable; driver remains deployable and can be scheduled after secrets are configured'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.automation_logs(job_name, status, message)
  VALUES ('pns-global-performance-engine-cron', 'warning', left(SQLERRM, 500));
END $$;
