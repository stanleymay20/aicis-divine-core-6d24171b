
CREATE TABLE IF NOT EXISTS public.metric_scale_reference (
  metric_name text PRIMARY KEY,
  domain text,
  p05 numeric NOT NULL,
  p50 numeric NOT NULL,
  p95 numeric NOT NULL,
  min_value numeric NOT NULL,
  max_value numeric NOT NULL,
  observation_count integer NOT NULL,
  country_count integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.metric_scale_reference TO authenticated;
GRANT ALL ON public.metric_scale_reference TO service_role;
ALTER TABLE public.metric_scale_reference ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "metric scale readable by authenticated" ON public.metric_scale_reference;
CREATE POLICY "metric scale readable by authenticated" ON public.metric_scale_reference
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.refresh_metric_scale_reference()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows int;
BEGIN
  WITH exploded AS (
    SELECT cp.iso3,
           k.key AS domain,
           m->>'metric' AS metric_name,
           (m->>'value')::numeric AS value
    FROM public.country_profiles cp,
         LATERAL jsonb_each(cp.kpis) k,
         LATERAL jsonb_array_elements(COALESCE(k.value->'metrics','[]'::jsonb)) m
    WHERE jsonb_typeof(COALESCE(k.value->'metrics','[]'::jsonb)) = 'array'
      AND m ? 'metric'
      AND jsonb_typeof(m->'value') = 'number'
  ), agg AS (
    SELECT metric_name,
           (array_agg(domain ORDER BY domain))[1] AS domain,
           percentile_cont(0.05) WITHIN GROUP (ORDER BY value) AS p05,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY value) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95,
           min(value) AS min_value, max(value) AS max_value,
           count(*)::int AS observation_count,
           count(DISTINCT iso3)::int AS country_count
    FROM exploded
    GROUP BY metric_name
    HAVING count(*) >= 30 AND count(DISTINCT iso3) >= 10
  )
  INSERT INTO public.metric_scale_reference AS t (
    metric_name, domain, p05, p50, p95, min_value, max_value,
    observation_count, country_count, computed_at)
  SELECT metric_name, domain, p05, p50, p95, min_value, max_value,
         observation_count, country_count, now()
  FROM agg
  ON CONFLICT (metric_name) DO UPDATE
    SET domain = EXCLUDED.domain, p05 = EXCLUDED.p05, p50 = EXCLUDED.p50,
        p95 = EXCLUDED.p95, min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
        observation_count = EXCLUDED.observation_count,
        country_count = EXCLUDED.country_count, computed_at = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('metrics_indexed', v_rows, 'computed_at', now());
END; $$;

SELECT cron.schedule('aicis-refresh-metric-scale-reference', '41 2 * * *',
  $$SELECT public.refresh_metric_scale_reference();$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aicis-refresh-metric-scale-reference');
