-- AICIS TARGET-ONLY CRON QUARANTINE
--
-- DO NOT apply this file to the current Lovable-managed source project.
-- Apply to the independently owned aicis-production project after the database
-- restore has recreated pg_cron state and before any target writers are allowed.
--
-- This file intentionally activates ZERO schedules. The target must remain
-- isolated from production writers throughout T0 restore, verification, shadow
-- reads and final parity checks. Audited schedules are enabled only by an
-- explicit file under migration/target/cutover/ after the cutover gate passes.
--
-- Guarded destination refs:
--   psonnnuhjjskrdazrakk  - verified current AICIS source runtime binding
--   itpwpnwzzitkelffttyx  - external/legacy Quantivis bridge binding observed
--                           inside the AICIS database; never an AICIS target
--
-- Before cutover, create these target Vault secrets:
--   aicis_project_url      -> https://<destination-ref>.supabase.co
--   aicis_publishable_key  -> destination sb_publishable_... key
--   aicis_cron_secret      -> strong scheduler-only secret; must match the
--                             target Edge Function CRON_SECRET value
--
-- Publishable API keys belong only in the apikey header. Scheduler authority is
-- provided by x-cron-secret; a browser/anon key is never authorization.

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
    RAISE EXCEPTION 'AICIS destination Vault secret aicis_project_url is missing';
  END IF;

  IF project_url LIKE '%psonnnuhjjskrdazrakk%'
     OR project_url LIKE '%itpwpnwzzitkelffttyx%' THEN
    RAISE EXCEPTION 'AICIS destination URL resolves to a guarded source/external project';
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
-- Disable EVERY restored schedule, not just commands that visibly contain a
-- guarded project ref. Historical AICIS jobs can call stored PostgreSQL wrappers
-- whose pg_proc body contains a source/external URL even when cron.job.command
-- does not.
UPDATE cron.job
SET active = false
WHERE active;

DO $$
DECLARE
  active_jobs bigint;
  direct_guarded_jobs bigint;
  indirect_guarded_jobs bigint;
BEGIN
  SELECT count(*) INTO active_jobs
  FROM cron.job
  WHERE active;

  SELECT count(*) INTO direct_guarded_jobs
  FROM cron.job
  WHERE active
    AND (
      command LIKE '%psonnnuhjjskrdazrakk%'
      OR command LIKE '%itpwpnwzzitkelffttyx%'
    );

  WITH guarded_functions AS (
    SELECT DISTINCT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND (
        p.prosrc LIKE '%psonnnuhjjskrdazrakk%'
        OR p.prosrc LIKE '%itpwpnwzzitkelffttyx%'
      )
  )
  SELECT count(DISTINCT j.jobid) INTO indirect_guarded_jobs
  FROM cron.job j
  JOIN guarded_functions f
    ON j.command ILIKE '%' || f.proname || '%'
  WHERE j.active;

  IF active_jobs <> 0 THEN
    RAISE EXCEPTION 'AICIS target cron quarantine failed: % active restored job(s) remain', active_jobs;
  END IF;

  IF direct_guarded_jobs <> 0 OR indirect_guarded_jobs <> 0 THEN
    RAISE EXCEPTION
      'AICIS target isolation failed: direct=% indirect=% active guarded-bound jobs remain',
      direct_guarded_jobs,
      indirect_guarded_jobs;
  END IF;
END;
$$;

-- Intentionally no cron.schedule() calls below this point.
-- Target writers stay OFF until an explicit migration/target/cutover activation
-- is executed after the final parity/write-freeze gate.
