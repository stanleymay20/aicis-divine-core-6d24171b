SELECT cron.unschedule('purge-derived-community-metrics');
SELECT cron.schedule(
  'purge-derived-community-metrics',
  '*/5 * * * *',
  $$SELECT public.purge_derived_community_metrics(250000, 7);$$
);