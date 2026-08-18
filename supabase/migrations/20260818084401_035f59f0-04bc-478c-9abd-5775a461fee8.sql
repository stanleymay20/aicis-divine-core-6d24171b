
CREATE OR REPLACE FUNCTION public.drive_planetary_causal_engine(p_limit int DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  v_domain text;
  v_key text;
  v_made int := 0;
  v_seen int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.title, s.category::text AS category, s.geo_admin0_iso3,
           COALESCE(s.impact_score, 0) AS impact_score
      FROM global_signals s
     WHERE s.ingested_at > now() - interval '6 hours'
       AND s.geo_admin0_iso3 IS NOT NULL
       AND COALESCE(s.impact_score, 0) >= 60
     ORDER BY s.impact_score DESC NULLS LAST
     LIMIT p_limit
  LOOP
    v_seen := v_seen + 1;
    v_key := 'signal:' || r.id::text;

    IF EXISTS (SELECT 1 FROM planetary_propagation_events WHERE source_event = v_key) THEN
      CONTINUE;
    END IF;

    v_domain := CASE r.category
      WHEN 'climate_disaster' THEN 'climate'
      WHEN 'water_hydrology' THEN 'climate'
      WHEN 'food_agriculture' THEN 'food'
      WHEN 'energy' THEN 'energy'
      WHEN 'public_health' THEN 'health'
      WHEN 'supply_chain' THEN 'trade'
      WHEN 'maritime_security' THEN 'trade'
      WHEN 'economic' THEN 'economy'
      WHEN 'financial_markets' THEN 'economy'
      WHEN 'central_banking' THEN 'economy'
      WHEN 'defense_conflict' THEN 'security'
      WHEN 'social_unrest' THEN 'security'
      WHEN 'geopolitical' THEN 'security'
      WHEN 'migration_displacement' THEN 'migration'
      WHEN 'infrastructure' THEN 'infrastructure'
      WHEN 'cybersecurity' THEN 'infrastructure'
      WHEN 'technology' THEN 'infrastructure'
      ELSE 'governance'
    END;

    BEGIN
      PERFORM public.generate_planetary_propagation_event(
        v_key,
        v_domain,
        r.geo_admin0_iso3,
        LEAST(10, GREATEST(1, round((r.impact_score / 10.0)::numeric, 2)))
      );
      v_made := v_made + 1;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN jsonb_build_object('signals_considered', v_seen, 'sources_propagated', v_made);
END;
$fn$;

REVOKE ALL ON FUNCTION public.drive_planetary_causal_engine(int) FROM public;
GRANT EXECUTE ON FUNCTION public.drive_planetary_causal_engine(int) TO service_role;

SELECT cron.unschedule('planetary-causal-engine-every-30min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'planetary-causal-engine-every-30min');

SELECT cron.schedule(
  'planetary-causal-engine-every-30min',
  '7,37 * * * *',
  $$SELECT public.drive_planetary_causal_engine(40);$$
);

SELECT public.drive_planetary_causal_engine(40);
