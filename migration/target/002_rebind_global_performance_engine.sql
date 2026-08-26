-- AICIS TARGET-ONLY MIGRATION
--
-- Apply only after migration/target/001_rebind_pipeline_cron.sql has completed
-- successfully on the independently owned aicis-production project.
-- DO NOT apply this file to the current Lovable-managed source project.
--
-- Purpose: restore the audited global performance driver schedule without
-- carrying forward a source URL, anon JWT, or service-role credential in cron.
-- Scheduler authority is the destination-only aicis_cron_secret read by
-- public.invoke_aicis_edge_function().

DO $$
BEGIN
  IF to_regprocedure('public.invoke_aicis_edge_function(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'AICIS target helper is missing; apply 001_rebind_pipeline_cron.sql first';
  END IF;
END;
$$;

SELECT cron.unschedule('pns-global-performance-engine')
WHERE EXISTS (
  SELECT 1
  FROM cron.job
  WHERE jobname = 'pns-global-performance-engine'
);

-- Preserve the latest production cadence from
-- 20260821224500_schedule_global_performance_engine.sql: every 6 hours at :25.
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
  bound_jobs bigint;
  unsafe_jobs bigint;
BEGIN
  SELECT count(*)
  INTO bound_jobs
  FROM cron.job
  WHERE active
    AND jobname = 'pns-global-performance-engine'
    AND command LIKE '%invoke_aicis_edge_function%'
    AND command LIKE '%drive-performance-engine-v2%';

  SELECT count(*)
  INTO unsafe_jobs
  FROM cron.job
  WHERE active
    AND jobname = 'pns-global-performance-engine'
    AND (
      command LIKE '%psonnnuhjjskrdazrakk%'
      OR command ILIKE '%anon_key%'
      OR command ILIKE '%service_role_key%'
      OR command ILIKE '%authorization%bearer%'
    );

  IF bound_jobs <> 1 THEN
    RAISE EXCEPTION 'AICIS target performance cron rebind failed: expected 1 safe active job, found %', bound_jobs;
  END IF;

  IF unsafe_jobs <> 0 THEN
    RAISE EXCEPTION 'AICIS target performance cron contains unsafe source/key material';
  END IF;
END;
$$;
