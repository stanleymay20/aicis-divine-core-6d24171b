
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT relname, relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public'
      AND relname IN ('quantivis_country_dashboard','quantivis_entity_graph')
  LOOP
    IF r.relkind = 'v' THEN
      EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.relname);
    ELSIF r.relkind = 'm' THEN
      EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', r.relname);
    END IF;
  END LOOP;
END $$;

CREATE MATERIALIZED VIEW public.quantivis_country_dashboard AS
SELECT
  ce.iso3,
  ce.canonical_name AS country_name,
  ce.sovereignty_status::text AS sovereignty_status,
  (ce.sovereignty_status = ANY (ARRAY['sovereign_state'::sovereignty_status, 'territory'::sovereignty_status, 'disputed'::sovereignty_status])) AS is_reporting_entity,
  COUNT(DISTINCT nm.id)::bigint AS total_metrics,
  COUNT(DISTINCT nm.domain)::bigint AS domain_count,
  COUNT(DISTINCT nm.provider_name)::bigint AS provider_count,
  COUNT(DISTINCT eml.id)::bigint AS link_count,
  MAX(nm.provenance_observed_at) AS latest_data_at,
  AVG(nm.freshness_score) AS avg_freshness
FROM canonical_entities ce
LEFT JOIN entity_metric_links eml ON eml.entity_id = ce.id
LEFT JOIN normalized_metrics nm ON nm.id = eml.metric_id
WHERE ce.entity_type = 'country'::entity_type
GROUP BY ce.iso3, ce.canonical_name, ce.sovereignty_status
WITH NO DATA;

CREATE UNIQUE INDEX idx_qcd_iso3 ON public.quantivis_country_dashboard (iso3);
CREATE INDEX idx_qcd_sov ON public.quantivis_country_dashboard (sovereignty_status);
CREATE INDEX idx_qcd_reporting ON public.quantivis_country_dashboard (is_reporting_entity);

CREATE MATERIALIZED VIEW public.quantivis_entity_graph AS
SELECT
  ce.id AS entity_id,
  ce.canonical_name,
  ce.entity_type::text AS entity_type,
  ce.iso3,
  ce.sovereignty_status::text AS sovereignty_status,
  (ce.sovereignty_status = ANY (ARRAY['sovereign_state'::sovereignty_status, 'territory'::sovereignty_status, 'disputed'::sovereignty_status])) AS is_reporting_entity,
  COUNT(DISTINCT eml.metric_id)::bigint AS metric_count,
  COUNT(DISTINCT eel.event_id)::bigint AS event_count
FROM canonical_entities ce
LEFT JOIN entity_metric_links eml ON eml.entity_id = ce.id
LEFT JOIN entity_event_links eel ON eel.entity_id = ce.id
GROUP BY ce.id, ce.canonical_name, ce.entity_type, ce.iso3, ce.sovereignty_status
WITH NO DATA;

CREATE UNIQUE INDEX idx_qeg_entity_id ON public.quantivis_entity_graph (entity_id);
CREATE INDEX idx_qeg_iso3 ON public.quantivis_entity_graph (iso3);
CREATE INDEX idx_qeg_type ON public.quantivis_entity_graph (entity_type);
CREATE INDEX idx_qeg_metric_count ON public.quantivis_entity_graph (metric_count DESC);

GRANT SELECT ON public.quantivis_country_dashboard TO anon, authenticated, service_role;
GRANT SELECT ON public.quantivis_entity_graph TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_quantivis_materialized()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _start timestamptz := clock_timestamp();
BEGIN
  BEGIN REFRESH MATERIALIZED VIEW CONCURRENTLY public.quantivis_country_dashboard;
  EXCEPTION WHEN OTHERS THEN REFRESH MATERIALIZED VIEW public.quantivis_country_dashboard; END;
  BEGIN REFRESH MATERIALIZED VIEW CONCURRENTLY public.quantivis_entity_graph;
  EXCEPTION WHEN OTHERS THEN REFRESH MATERIALIZED VIEW public.quantivis_entity_graph; END;
  INSERT INTO public.automation_logs (job_name, status, message)
  VALUES ('refresh_quantivis_materialized', 'success',
          jsonb_build_object('duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - _start)) * 1000)::text);
  RETURN jsonb_build_object('ok', true,
          'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - _start)) * 1000);
END;
$$;

DO $$ BEGIN PERFORM cron.unschedule('refresh-quantivis-mvs-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('refresh-quantivis-mvs-bootstrap'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'refresh-quantivis-mvs-hourly',
  '7 * * * *',
  $$ SELECT public.refresh_quantivis_materialized(); $$
);

SELECT cron.schedule(
  'refresh-quantivis-mvs-bootstrap',
  '* * * * *',
  $$
    SELECT public.refresh_quantivis_materialized();
    SELECT cron.unschedule('refresh-quantivis-mvs-bootstrap');
  $$
);
