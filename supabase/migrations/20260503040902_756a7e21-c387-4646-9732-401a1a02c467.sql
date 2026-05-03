
SET lock_timeout = '5s';

DO $$ BEGIN
  PERFORM cron.unschedule('batch-entity-links-v1');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.refresh_quantivis_materialized()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.quantivis_country_dashboard;
    result := result || jsonb_build_object('country_dashboard','ok');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_errors(component, message, severity, details)
    VALUES ('refresh_quantivis_materialized','country_dashboard refresh skipped','low',
            jsonb_build_object('error', SQLERRM));
    result := result || jsonb_build_object('country_dashboard', SQLERRM);
  END;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.quantivis_entity_graph;
    result := result || jsonb_build_object('entity_graph','ok');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_errors(component, message, severity, details)
    VALUES ('refresh_quantivis_materialized','entity_graph refresh skipped','low',
            jsonb_build_object('error', SQLERRM));
    result := result || jsonb_build_object('entity_graph', SQLERRM);
  END;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_quantivis_materialized() FROM anon, authenticated, PUBLIC;

REVOKE ALL ON public.risk_rankings_current FROM anon, authenticated;
REVOKE ALL ON public.quantivis_entity_graph FROM anon, authenticated;
REVOKE ALL ON public.quantivis_country_dashboard FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.system_service_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('edge_function','cron_job','rpc')),
  schedule text,
  owner text,
  criticality text NOT NULL DEFAULT 'normal' CHECK (criticality IN ('critical','high','normal','low')),
  description text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_service_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read service catalog" ON public.system_service_catalog;
CREATE POLICY "auth read service catalog"
  ON public.system_service_catalog FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin manage service catalog" ON public.system_service_catalog;
CREATE POLICY "admin manage service catalog"
  ON public.system_service_catalog FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));

DROP TRIGGER IF EXISTS tg_system_service_catalog_updated_at ON public.system_service_catalog;
CREATE TRIGGER tg_system_service_catalog_updated_at
  BEFORE UPDATE ON public.system_service_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE VIEW public.system_slo_recent_v
WITH (security_invoker = true) AS
SELECT
  j.jobname AS pipeline_name,
  j.schedule,
  j.active AS enabled,
  COUNT(*) FILTER (WHERE r.status='succeeded') AS ok_24h,
  COUNT(*) FILTER (WHERE r.status='failed')    AS fail_24h,
  MAX(r.end_time) FILTER (WHERE r.status='succeeded') AS last_success_at,
  MAX(r.end_time) FILTER (WHERE r.status='failed')    AS last_failure_at
FROM cron.job j
LEFT JOIN cron.job_run_details r
  ON r.jobid = j.jobid
 AND r.start_time > now() - interval '24 hours'
GROUP BY j.jobname, j.schedule, j.active;

GRANT SELECT ON public.system_slo_recent_v TO authenticated;
