
ALTER TABLE public.planetary_dependency_edges
  ADD COLUMN IF NOT EXISTS measured_correlation numeric,
  ADD COLUMN IF NOT EXISTS measured_sample_size integer,
  ADD COLUMN IF NOT EXISTS measured_country_count integer,
  ADD COLUMN IF NOT EXISTS measured_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'unvalidated',
  ADD COLUMN IF NOT EXISTS strength_basis text NOT NULL DEFAULT 'expert_prior_unvalidated';

ALTER TABLE public.planetary_propagation_events
  ADD COLUMN IF NOT EXISTS evidence_status text,
  ADD COLUMN IF NOT EXISTS measured_correlation numeric;

-- Map planetary node domains onto the domains used by measured cross-domain correlations.
CREATE OR REPLACE FUNCTION public.planetary_domain_to_metric_domain(p_domain text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_domain
    WHEN 'economy'   THEN 'finance'
    WHEN 'migration' THEN 'population'
    WHEN 'climate'   THEN 'climate'
    WHEN 'energy'    THEN 'energy'
    WHEN 'food'      THEN 'food'
    WHEN 'health'    THEN 'health'
    ELSE NULL
  END
$$;

-- Recompute each edge's empirical support from real measured correlations.
CREATE OR REPLACE FUNCTION public.refresh_planetary_edge_evidence()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_updated int := 0;
BEGIN
  WITH ev AS (
    SELECT e.id,
           c.avg_corr, c.n, c.countries, c.last
      FROM planetary_dependency_edges e
      JOIN planetary_system_nodes sn ON sn.node_key = e.source_node_key
      JOIN planetary_system_nodes tn ON tn.node_key = e.target_node_key
      LEFT JOIN LATERAL (
        SELECT avg(cc.correlation) AS avg_corr,
               sum(cc.sample_size) AS n,
               count(DISTINCT cc.iso3) AS countries,
               max(cc.computed_at) AS last
          FROM cross_domain_correlations cc
         WHERE LEAST(cc.domain_a, cc.domain_b) = LEAST(
                 planetary_domain_to_metric_domain(sn.node_domain),
                 planetary_domain_to_metric_domain(tn.node_domain))
           AND GREATEST(cc.domain_a, cc.domain_b) = GREATEST(
                 planetary_domain_to_metric_domain(sn.node_domain),
                 planetary_domain_to_metric_domain(tn.node_domain))
      ) c ON true
  )
  UPDATE planetary_dependency_edges e
     SET measured_correlation = ev.avg_corr,
         measured_sample_size = ev.n,
         measured_country_count = ev.countries,
         measured_at = ev.last,
         evidence_status = CASE
           WHEN ev.avg_corr IS NULL THEN 'unvalidated'
           WHEN abs(ev.avg_corr) >= 0.30 THEN 'measured_strong'
           WHEN abs(ev.avg_corr) >= 0.10 THEN 'measured_moderate'
           ELSE 'measured_weak'
         END,
         strength_basis = CASE WHEN ev.avg_corr IS NULL
           THEN 'expert_prior_unvalidated' ELSE 'expert_prior_with_measured_support' END,
         -- confidence is now derived from measurement, never hand-set
         evidence_confidence = CASE
           WHEN ev.avg_corr IS NULL THEN 0
           ELSE round(LEAST(0.95, abs(ev.avg_corr))::numeric, 4)
         END
    FROM ev
   WHERE ev.id = e.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('edges_updated', v_updated);
END;
$fn$;

SELECT public.refresh_planetary_edge_evidence();

-- Regenerate the propagation function on a consistent 0-100 severity scale and
-- with the edge's evidence status carried onto every emitted event.
CREATE OR REPLACE FUNCTION public.generate_planetary_propagation_event(
  p_source_event text, p_source_domain text,
  p_source_region text DEFAULT 'global', p_initial_severity numeric DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  rec record; v_probability numeric; v_severity numeric; v_key text; v_count int := 0;
BEGIN
  IF p_initial_severity IS NULL OR p_initial_severity < 0 OR p_initial_severity > 100 THEN
    RAISE EXCEPTION 'p_initial_severity must be on a 0-100 scale, got %', p_initial_severity;
  END IF;

  FOR rec IN
    SELECT e.* FROM planetary_dependency_edges e
     WHERE e.source_node_key IN (
       SELECT node_key FROM planetary_system_nodes WHERE node_domain = p_source_domain)
  LOOP
    v_probability := LEAST(100, ROUND((p_initial_severity * rec.propagation_strength)::numeric, 2));
    v_severity    := LEAST(100, ROUND((p_initial_severity * rec.propagation_strength * 0.85)::numeric, 2));
    v_key := md5(p_source_event || '|' || rec.target_node_key);

    INSERT INTO planetary_propagation_events(
      propagation_key, source_event, source_domain, source_region,
      impacted_node_key, impact_type, impact_probability, impact_severity,
      projected_time_window, causal_path, recommended_interventions,
      evidence_score, evidence_status, measured_correlation, generated_at)
    VALUES (
      v_key, p_source_event, p_source_domain, p_source_region,
      rec.target_node_key, rec.dependency_type, v_probability, v_severity,
      CASE WHEN rec.latency_hours <= 24 THEN 'immediate'
           WHEN rec.latency_hours <= 168 THEN 'short_term' ELSE 'medium_term' END,
      jsonb_build_array(jsonb_build_object(
        'from', rec.source_node_key, 'to', rec.target_node_key,
        'structural_strength', rec.propagation_strength,
        'strength_basis', rec.strength_basis,
        'measured_correlation', rec.measured_correlation,
        'measured_sample_size', rec.measured_sample_size,
        'measured_country_count', rec.measured_country_count)),
      jsonb_build_array('Increase monitoring','Prepare mitigation coordination',
                        'Escalate executive review if severity rises'),
      round((COALESCE(rec.evidence_confidence,0) * 100)::numeric, 2),
      rec.evidence_status, rec.measured_correlation, now())
    ON CONFLICT(propagation_key) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('planetary-causal-propagation','success','generated_events=' || v_count || ', source=' || p_source_domain);

  RETURN jsonb_build_object('status','success','source_event',p_source_event,
    'source_domain',p_source_domain,'generated_propagations',v_count);
END;
$fn$;

-- Drop the mis-scaled events emitted by the first driver run.
DELETE FROM public.planetary_propagation_events WHERE source_event LIKE 'signal:%';

-- Driver: pass impact_score straight through on its native 0-100 scale and use
-- only domains that actually have a node in the graph (no invented mappings).
CREATE OR REPLACE FUNCTION public.drive_planetary_causal_engine(p_limit int DEFAULT 40)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r record; v_domain text; v_key text; v_made int := 0; v_seen int := 0; v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.category::text AS category, s.geo_admin0_iso3,
           COALESCE(s.impact_score,0) AS impact_score
      FROM global_signals s
     WHERE s.ingested_at > now() - interval '6 hours'
       AND s.geo_admin0_iso3 IS NOT NULL
       AND COALESCE(s.impact_score,0) >= 60
     ORDER BY s.impact_score DESC NULLS LAST
     LIMIT p_limit
  LOOP
    v_seen := v_seen + 1;
    v_domain := CASE r.category
      WHEN 'climate_disaster' THEN 'climate'
      WHEN 'water_hydrology' THEN 'climate'
      WHEN 'food_agriculture' THEN 'food'
      WHEN 'energy' THEN 'energy'
      WHEN 'public_health' THEN 'health'
      WHEN 'supply_chain' THEN 'logistics'
      WHEN 'maritime_security' THEN 'logistics'
      WHEN 'economic' THEN 'economy'
      WHEN 'financial_markets' THEN 'economy'
      WHEN 'central_banking' THEN 'economy'
      WHEN 'migration_displacement' THEN 'migration'
      WHEN 'cybersecurity' THEN 'cyber'
      ELSE NULL
    END;

    IF v_domain IS NULL
       OR NOT EXISTS (SELECT 1 FROM planetary_system_nodes WHERE node_domain = v_domain) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_key := 'signal:' || r.id::text;
    IF EXISTS (SELECT 1 FROM planetary_propagation_events WHERE source_event = v_key) THEN
      CONTINUE;
    END IF;

    PERFORM public.generate_planetary_propagation_event(
      v_key, v_domain, r.geo_admin0_iso3, LEAST(100, GREATEST(0, r.impact_score))::numeric);
    v_made := v_made + 1;
  END LOOP;

  RETURN jsonb_build_object('signals_considered', v_seen,
    'sources_propagated', v_made, 'skipped_no_graph_node', v_skipped);
END;
$fn$;

REVOKE ALL ON FUNCTION public.refresh_planetary_edge_evidence() FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_planetary_edge_evidence() TO service_role;

SELECT public.drive_planetary_causal_engine(60);
