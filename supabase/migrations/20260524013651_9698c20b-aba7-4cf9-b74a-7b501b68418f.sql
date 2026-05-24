
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_runs_rollup
  ON public.provider_runs (provider_name, started_at)
  WHERE run_mode = 'rollup';

CREATE OR REPLACE FUNCTION public.rollup_provider_runs(p_hours int DEFAULT 6)
RETURNS TABLE(out_provider text, out_bucket timestamptz, out_written int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := date_trunc('hour', now() - make_interval(hours => p_hours));
BEGIN
  RETURN QUERY
  WITH m AS (
    SELECT nm.provider_name AS pn, date_trunc('hour', nm.created_at) AS bk, COUNT(*)::int AS c
    FROM public.normalized_metrics nm
    WHERE nm.created_at >= v_start AND nm.provider_name IS NOT NULL
    GROUP BY 1, 2
  ),
  e AS (
    SELECT ne.provider_name AS pn, date_trunc('hour', ne.created_at) AS bk, COUNT(*)::int AS c
    FROM public.normalized_events ne
    WHERE ne.created_at >= v_start AND ne.provider_name IS NOT NULL
    GROUP BY 1, 2
  ),
  agg AS (
    SELECT COALESCE(m.pn, e.pn) AS pn,
           COALESCE(m.bk, e.bk) AS bk,
           (COALESCE(m.c, 0) + COALESCE(e.c, 0))::int AS total
    FROM m FULL OUTER JOIN e ON e.pn = m.pn AND e.bk = m.bk
  ),
  ins AS (
    INSERT INTO public.provider_runs (
      provider_name, endpoint, status, started_at, completed_at,
      records_fetched, records_normalized, records_written, records_inserted,
      duration_ms, run_mode, adapter_version
    )
    SELECT a.pn, 'hourly_rollup', 'success', a.bk, a.bk + interval '1 hour',
           a.total, a.total, a.total, a.total, 0, 'rollup', 'rollup-v1'
    FROM agg a WHERE a.total > 0
    ON CONFLICT (provider_name, started_at) WHERE run_mode = 'rollup'
    DO UPDATE SET
      records_fetched   = EXCLUDED.records_fetched,
      records_normalized = EXCLUDED.records_normalized,
      records_written   = EXCLUDED.records_written,
      records_inserted  = EXCLUDED.records_inserted,
      completed_at      = EXCLUDED.completed_at,
      status            = 'success'
    RETURNING public.provider_runs.provider_name, public.provider_runs.started_at, public.provider_runs.records_written
  )
  SELECT ins.provider_name, ins.started_at, ins.records_written FROM ins;
END;
$$;

SELECT public.rollup_provider_runs(24);

INSERT INTO public.export_profiles
  (name, description, preset_key, destination_type, domains, countries, regions,
   severity_tiers, min_relevance_score, min_confidence_score, min_urgency_score,
   frequency, max_records_per_run, include_recommendations, include_explanations,
   prefer_clusters, enabled, next_run_at)
VALUES
  ('Critical Risks Daily',
   'Top critical + high severity signals across all domains, refreshed every day.',
   'quantivis_decision_intelligence', 'api',
   ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
   ARRAY['critical','high']::text[], 60, 60, 0,
   'daily', 500, true, true, true, true, now()),
  ('Supply Chain Weekly',
   'Supply chain, logistics, and trade disruption signals aggregated weekly.',
   'quantivis_decision_intelligence', 'api',
   ARRAY['logistics','supply_chain','economy','energy']::text[],
   ARRAY[]::text[], ARRAY[]::text[],
   ARRAY['high','medium','critical']::text[], 50, 50, 0,
   'weekly', 1000, true, true, true, true, now()),
  ('Sovereign Intelligence Hourly',
   'High-confidence sovereign-relevant signals (security, governance, finance) every hour.',
   'quantivis_decision_intelligence', 'api',
   ARRAY['security','governance','finance']::text[],
   ARRAY[]::text[], ARRAY[]::text[],
   ARRAY['critical','high']::text[], 70, 70, 0,
   'hourly', 300, true, true, true, true, now())
ON CONFLICT DO NOTHING;

INSERT INTO public.export_runs (profile_id, status, trigger_source, format)
SELECT id, 'queued', 'manual_seed', 'json'
FROM public.export_profiles
WHERE name = 'Critical Risks Daily'
LIMIT 1;
