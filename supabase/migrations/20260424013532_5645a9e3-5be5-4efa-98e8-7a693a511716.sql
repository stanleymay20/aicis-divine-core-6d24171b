DO $$
BEGIN
  PERFORM cron.unschedule(j) FROM (VALUES 
    ('quantivis-enqueue-metrics'),
    ('quantivis-enqueue-events'),
    ('quantivis-dispatch-webhooks')
  ) AS t(j) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);
END $$;

SELECT cron.schedule(
  'quantivis-enqueue-metrics',
  '*/15 * * * *',
  $$ SELECT public.enqueue_quantivis_metric_batch(200); $$
);

SELECT cron.schedule(
  'quantivis-enqueue-events',
  '*/30 * * * *',
  $$ SELECT public.enqueue_quantivis_event_batch(50); $$
);

SELECT cron.schedule(
  'quantivis-dispatch-webhooks',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url:='https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/dispatch-quantivis-webhooks',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);