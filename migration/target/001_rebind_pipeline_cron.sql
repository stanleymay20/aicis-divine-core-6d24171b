-- AICIS TARGET-ONLY MIGRATION
--
-- DO NOT apply this file to the current Lovable-managed source project.
-- Apply only to the independently owned aicis-production project after these
-- Vault secrets exist in the destination project:
--   aicis_project_url  -> https://<destination-ref>.supabase.co
--   aicis_anon_key     -> destination publishable/anon key
--
-- Purpose: prevent restored pg_cron jobs from posting back to the old Lovable
-- project after a database migration. Missing target secrets fail closed.

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
  anon_key text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret
    INTO project_url
  FROM vault.decrypted_secrets
  WHERE name = 'aicis_project_url'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret
    INTO anon_key
  FROM vault.decrypted_secrets
  WHERE name = 'aicis_anon_key'
  ORDER BY created_at DESC
  LIMIT 1;

  IF project_url IS NULL OR btrim(project_url) = '' THEN
    RAISE EXCEPTION 'AICIS destination Vault secret aicis_project_url is missing';
  END IF;

  IF anon_key IS NULL OR btrim(anon_key) = '' THEN
    RAISE EXCEPTION 'AICIS destination Vault secret aicis_anon_key is missing';
  END IF;

  request_id := net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key
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
-- A source snapshot can contain many generations of cron jobs. The live source
-- currently contains far more source-bound jobs than the three pipeline-replay
-- schedules below. Never allow any restored job that still contains the Lovable
-- source project ref to execute on the independent target.
--
-- We intentionally DISABLE rather than delete these rows so the historical
-- schedule/command inventory remains available for audit and controlled rebinding.
UPDATE cron.job
SET active = false
WHERE command LIKE '%psonnnuhjjskrdazrakk%';

DO $$
DECLARE
  leaked_jobs bigint;
BEGIN
  SELECT count(*)
  INTO leaked_jobs
  FROM cron.job
  WHERE active
    AND command LIKE '%psonnnuhjjskrdazrakk%';

  IF leaked_jobs <> 0 THEN
    RAISE EXCEPTION 'AICIS target cron isolation failed: % active source-bound jobs remain', leaked_jobs;
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
  leaked_jobs bigint;
BEGIN
  SELECT count(*)
  INTO leaked_jobs
  FROM cron.job
  WHERE active
    AND command LIKE '%psonnnuhjjskrdazrakk%';

  IF leaked_jobs <> 0 THEN
    RAISE EXCEPTION 'AICIS target cron isolation regressed after rebinding: % active source-bound jobs remain', leaked_jobs;
  END IF;
END;
$$;
