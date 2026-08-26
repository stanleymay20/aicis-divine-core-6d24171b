-- AICIS TARGET-ONLY MIGRATION
--
-- DO NOT apply this file to the current Lovable-managed source project.
-- Apply only to the independently owned aicis-production project after these
-- Vault secrets exist in the destination project:
--   aicis_project_url      -> https://<destination-ref>.supabase.co
--   aicis_publishable_key  -> destination sb_publishable_... key
--   aicis_cron_secret      -> strong scheduler-only secret; must match the
--                             Edge Function CRON_SECRET value
--
-- Purpose: prevent restored pg_cron jobs from posting back to the old Lovable
-- project after a database migration. Missing target secrets fail closed.
-- Publishable API keys belong only in the apikey header; scheduler authority is
-- provided by the independent x-cron-secret credential, never by a browser key.

CREATE OR REPLACE FUNCTION public.invoke_aicis_edge_function(
  function_name text,
  payload jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, vault
AS $$
DECLARE
  project_url text;
  publishable_key text;
  cron_secret text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret
    INTO project_url
  FROM vault.decrypted_secrets
  WHERE name = 'aicis_project_url'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret
    INTO publishable_key
  FROM vault.decrypted_secrets
  WHERE name = 'aicis_publishable_key'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret
    INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'aicis_cron_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF project_url IS NULL OR btrim(project_url) = '' THEN
    RAISE EXCEPTION 'AICIS destination Vault secret aicis_project_url is missing';
  END IF;

  IF publishable_key IS NULL OR btrim(publishable_key) = '' THEN
    RAISE EXCEPTION 'AICIS destination Vault secret aicis_publishable_key is missing';
  END IF;

  IF cron_secret IS NULL OR btrim(cron_secret) = '' THEN
    RAISE EXCEPTION 'AICIS destination Vault secret aicis_cron_secret is missing';
  END IF;

  request_id := net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', publishable_key,
      'x-cron-secret', cron_secret
    ),
    body := COALESCE(payload, '{}'::jsonb)
  );

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_aicis_edge_function(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_aicis_edge_function(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.invoke_aicis_edge_function(text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_aicis_edge_function(text, jsonb) TO service_role;

-- CRITICAL FAIL-CLOSED BARRIER
-- A source snapshot can contain many generations of cron jobs. Never allow a
-- restored target job to call the Lovable source either directly in cron.job or
-- indirectly through a PostgreSQL wrapper whose stored function body contains
-- the source project ref.
--
-- We intentionally DISABLE rather than delete these rows so historical
-- schedule/command inventory remains available for audit and controlled rebinding.
UPDATE cron.job
SET active = false
WHERE command LIKE '%psonnnuhjjskrdazrakk%';

-- Indirect escape protection. Historical migrations include wrappers such as
-- trigger_wb_ingest()/trigger_village_unify() whose cron command is innocent
-- looking while pg_proc.prosrc still posts to the old project. Disable any cron
-- command that names such a source-bound stored function.
WITH source_bound_functions AS (
  SELECT DISTINCT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.prosrc LIKE '%psonnnuhjjskrdazrakk%'
)
UPDATE cron.job j
SET active = false
FROM source_bound_functions f
WHERE j.active
  AND j.command ILIKE '%' || f.proname || '%';

DO $$
DECLARE
  direct_leaks bigint;
  indirect_leaks bigint;
BEGIN
  SELECT count(*)
  INTO direct_leaks
  FROM cron.job
  WHERE active
    AND command LIKE '%psonnnuhjjskrdazrakk%';

  WITH source_bound_functions AS (
    SELECT DISTINCT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosrc LIKE '%psonnnuhjjskrdazrakk%'
  )
  SELECT count(DISTINCT j.jobid)
  INTO indirect_leaks
  FROM cron.job j
  JOIN source_bound_functions f
    ON j.command ILIKE '%' || f.proname || '%'
  WHERE j.active;

  IF direct_leaks <> 0 OR indirect_leaks <> 0 THEN
    RAISE EXCEPTION
      'AICIS target cron isolation failed: direct=% indirect=% source-bound active jobs remain',
      direct_leaks,
      indirect_leaks;
  END IF;
END;
$$;

-- Recreate only the small set of schedules that have already been explicitly
-- audited for target-safe execution. Every other restored source-bound schedule
-- remains disabled until it receives the same review and an explicit target-safe
-- replacement. This avoids split-brain during staged restoration.
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

DO $$
DECLARE
  direct_leaks bigint;
  indirect_leaks bigint;
BEGIN
  SELECT count(*)
  INTO direct_leaks
  FROM cron.job
  WHERE active
    AND command LIKE '%psonnnuhjjskrdazrakk%';

  WITH source_bound_functions AS (
    SELECT DISTINCT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosrc LIKE '%psonnnuhjjskrdazrakk%'
  )
  SELECT count(DISTINCT j.jobid)
  INTO indirect_leaks
  FROM cron.job j
  JOIN source_bound_functions f
    ON j.command ILIKE '%' || f.proname || '%'
  WHERE j.active;

  IF direct_leaks <> 0 OR indirect_leaks <> 0 THEN
    RAISE EXCEPTION
      'AICIS target cron isolation regressed after rebinding: direct=% indirect=%',
      direct_leaks,
      indirect_leaks;
  END IF;
END;
$$;
