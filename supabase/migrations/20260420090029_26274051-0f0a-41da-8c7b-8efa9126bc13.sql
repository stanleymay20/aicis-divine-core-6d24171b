
-- Autonomous accumulation: ensures uninterrupted data flow without human intervention.

-- 1) Master self-healing accumulator — every 30 minutes.
--    Inspects normalized_metrics freshness per provider and restarts overdue ingestors.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'autonomous-accumulator-30min';
SELECT cron.schedule(
  'autonomous-accumulator-30min',
  '*/30 * * * *',
  $$ SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/autonomous-accumulator',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  ) $$
);

-- 2) Direct cadence schedules for each free ingestor (defense in depth — accumulator
--    is the safety net, these are the primary heartbeats).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN (
  'pull-nasa-power-daily', 'pull-entsoe-6hourly', 'pull-vdem-weekly',
  'pull-freedom-house-weekly', 'pull-worldbank-daily'
);

SELECT cron.schedule('pull-nasa-power-daily', '15 2 * * *',
  $$ SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/pull-nasa-power',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb) $$);

SELECT cron.schedule('pull-entsoe-6hourly', '7 */6 * * *',
  $$ SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/pull-entsoe',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb) $$);

SELECT cron.schedule('pull-vdem-weekly', '0 3 * * 1',
  $$ SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/pull-vdem',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb) $$);

SELECT cron.schedule('pull-freedom-house-weekly', '20 3 * * 1',
  $$ SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/pull-freedom-house',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb) $$);

SELECT cron.schedule('pull-worldbank-daily', '40 2 * * *',
  $$ SELECT net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/pull-worldbank',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb) $$);
