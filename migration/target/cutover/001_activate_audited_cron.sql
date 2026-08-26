-- AICIS CUTOVER-ONLY TARGET ACTIVATION
--
-- NEVER run during T0 restore, shadow validation, parity comparison, or while
-- the Lovable project is still the authoritative production writer.
--
-- Preconditions:
--   1. migration/target/001_rebind_pipeline_cron.sql has quarantined all jobs.
--   2. Database/Auth/Storage/function parity gates pass.
--   3. Source application writes are frozen/minimized for the final checkpoint.
--   4. Target Vault secrets exist:
--        aicis_project_url
--        aicis_publishable_key
--        aicis_cron_secret
--   5. aicis_cron_secret matches target Edge Function CRON_SECRET.
--
-- This first activation wave deliberately enables only caller paths whose
-- target authentication and schedules have been audited. All other restored
-- jobs remain inactive until separate review.

DO $$
DECLARE
  project_url text;
  publishable_key text;
  cron_secret text;
BEGIN
  IF to_regprocedure('public.invoke_aicis_edge_function(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'AICIS target helper is missing; apply 001_rebind_pipeline_cron.sql first';
  END IF;

  SELECT decrypted_secret INTO project_url
  FROM vault.decrypted_secrets
  WHERE name = 'aicis_project_url'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret INTO publishable_key
  FROM vault.decrypted_secrets
  WHERE name = 'aicis_publishable_key'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'aicis_cron_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF project_url IS NULL OR btrim(project_url) = '' THEN
    RAISE EXCEPTION 'aicis_project_url is missing';
  END IF;

  IF project_url LIKE '%psonnnuhjjskrdazrakk%' THEN
    RAISE EXCEPTION 'Refusing cutover: aicis_project_url still points to Lovable source';
  END IF;

  IF project_url NOT LIKE '%qpphncfgbhizvnovzivw%' THEN
    RAISE EXCEPTION 'Refusing cutover: aicis_project_url does not identify the approved aicis-production target';
  END IF;

  IF publishable_key IS NULL OR btrim(publishable_key) = '' THEN
    RAISE EXCEPTION 'aicis_publishable_key is missing';
  END IF;

  IF cron_secret IS NULL OR length(btrim(cron_secret)) < 32 THEN
    RAISE EXCEPTION 'aicis_cron_secret is missing or too short';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE active) THEN
    RAISE EXCEPTION 'Refusing cutover activation: target cron quarantine is not clean';
  END IF;
END;
$$;

-- Pipeline replay: audited target-safe scheduler paths.
SELECT cron.unschedule('pipeline-replay-drain-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pipeline-replay-drain-10min');
SELECT cron.schedule(
  'pipeline-replay-drain-10min',
  '3,13,23,33,43,53 * * * *',
  $$SELECT public.invoke_aicis_edge_function(
      'pipeline-replay',
      '{"lane":"country","limit":5000,"source":"pg_cron"}'::jsonb
    );$$
);

SELECT cron.unschedule('pipeline-replay-translation-20min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pipeline-replay-translation-20min');
SELECT cron.schedule(
  'pipeline-replay-translation-20min',
  '8,28,48 * * * *',
  $$SELECT public.invoke_aicis_edge_function(
      'pipeline-replay',
      '{"lane":"translation","limit":3000,"source":"pg_cron"}'::jsonb
    );$$
);

SELECT cron.unschedule('pipeline-replay-enrichment-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pipeline-replay-enrichment-hourly');
SELECT cron.schedule(
  'pipeline-replay-enrichment-hourly',
  '38 * * * *',
  $$SELECT public.invoke_aicis_edge_function(
      'pipeline-replay',
      '{"lane":"enrichment","limit":2000,"source":"pg_cron"}'::jsonb
    );$$
);

-- Global performance driver: preserve the latest production cadence from
-- 20260821224500_schedule_global_performance_engine.sql (every 6h at :25).
SELECT cron.unschedule('pns-global-performance-engine')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pns-global-performance-engine');
SELECT cron.schedule(
  'pns-global-performance-engine',
  '25 */6 * * *',
  $$SELECT public.invoke_aicis_edge_function(
      'drive-performance-engine-v2',
      '{"batch_size":60,"trigger":"pg_cron"}'::jsonb
    );$$
);

DO $$
DECLARE
  active_jobs bigint;
  expected_jobs bigint;
  unsafe_jobs bigint;
  unexpected_jobs bigint;
BEGIN
  SELECT count(*) INTO active_jobs
  FROM cron.job
  WHERE active;

  SELECT count(*) INTO expected_jobs
  FROM cron.job
  WHERE active
    AND jobname IN (
      'pipeline-replay-drain-10min',
      'pipeline-replay-translation-20min',
      'pipeline-replay-enrichment-hourly',
      'pns-global-performance-engine'
    )
    AND command LIKE '%invoke_aicis_edge_function%';

  SELECT count(*) INTO unsafe_jobs
  FROM cron.job
  WHERE active
    AND (
      command LIKE '%psonnnuhjjskrdazrakk%'
      OR command ILIKE '%anon_key%'
      OR command ILIKE '%service_role_key%'
      OR command ILIKE '%authorization%bearer%'
    );

  SELECT count(*) INTO unexpected_jobs
  FROM cron.job
  WHERE active
    AND jobname NOT IN (
      'pipeline-replay-drain-10min',
      'pipeline-replay-translation-20min',
      'pipeline-replay-enrichment-hourly',
      'pns-global-performance-engine'
    );

  IF active_jobs <> 4 OR expected_jobs <> 4 THEN
    RAISE EXCEPTION 'AICIS cutover activation mismatch: active=% expected-safe=%', active_jobs, expected_jobs;
  END IF;

  IF unsafe_jobs <> 0 THEN
    RAISE EXCEPTION 'AICIS cutover activation contains % unsafe cron job(s)', unsafe_jobs;
  END IF;

  IF unexpected_jobs <> 0 THEN
    RAISE EXCEPTION 'AICIS cutover activation enabled % unaudited cron job(s)', unexpected_jobs;
  END IF;
END;
$$;
