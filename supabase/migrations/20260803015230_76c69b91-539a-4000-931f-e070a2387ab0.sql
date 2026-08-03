-- 1. Index that makes the geocoder's failed-retry scan cheap (was statement-timeout every run)
CREATE INDEX IF NOT EXISTS idx_gs_failed_geocode_with_country
  ON public.global_signals (first_detected_at DESC)
  WHERE geo_method = 'failed'
    AND affected_countries IS NOT NULL
    AND affected_countries <> '{}';

-- 2. Continuous backlog drain: replay country + translation + enrichment lanes automatically
SELECT cron.unschedule('pipeline-replay-drain-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pipeline-replay-drain-10min');

SELECT cron.schedule(
  'pipeline-replay-drain-10min',
  '3,13,23,33,43,53 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/pipeline-replay',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"lane":"country","limit":5000,"source":"pg_cron"}'::jsonb
  );
  $$
);

SELECT cron.unschedule('pipeline-replay-translation-20min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pipeline-replay-translation-20min');

SELECT cron.schedule(
  'pipeline-replay-translation-20min',
  '8,28,48 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/pipeline-replay',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"lane":"translation","limit":3000,"source":"pg_cron"}'::jsonb
  );
  $$
);

SELECT cron.unschedule('pipeline-replay-enrichment-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pipeline-replay-enrichment-hourly');

SELECT cron.schedule(
  'pipeline-replay-enrichment-hourly',
  '38 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/pipeline-replay',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"lane":"enrichment","limit":2000,"source":"pg_cron"}'::jsonb
  );
  $$
);