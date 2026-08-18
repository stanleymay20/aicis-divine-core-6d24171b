CREATE TABLE IF NOT EXISTS public.planetary_system_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key text UNIQUE NOT NULL,
  node_name text NOT NULL,
  node_domain text NOT NULL,
  node_type text DEFAULT 'system',
  geographic_scope text DEFAULT 'global',
  operational_status text DEFAULT 'active',
  baseline_risk numeric DEFAULT 0,
  resilience_score numeric DEFAULT 50,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.planetary_dependency_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_key text UNIQUE NOT NULL,
  source_node_key text NOT NULL,
  target_node_key text NOT NULL,
  dependency_type text DEFAULT 'operational',
  propagation_strength numeric DEFAULT 0.5,
  latency_hours numeric DEFAULT 24,
  bidirectional boolean DEFAULT false,
  evidence_confidence numeric DEFAULT 0.7,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.planetary_propagation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propagation_key text UNIQUE NOT NULL,
  source_event text NOT NULL,
  source_domain text,
  source_region text,
  impacted_node_key text,
  impact_type text,
  impact_probability numeric DEFAULT 0,
  impact_severity numeric DEFAULT 0,
  projected_time_window text,
  causal_path jsonb DEFAULT '[]'::jsonb,
  recommended_interventions jsonb DEFAULT '[]'::jsonb,
  evidence_score numeric DEFAULT 0,
  generated_at timestamptz DEFAULT now()
);

GRANT SELECT ON public.planetary_system_nodes TO authenticated;
GRANT SELECT ON public.planetary_dependency_edges TO authenticated;
GRANT SELECT ON public.planetary_propagation_events TO authenticated;
GRANT ALL ON public.planetary_system_nodes TO service_role;
GRANT ALL ON public.planetary_dependency_edges TO service_role;
GRANT ALL ON public.planetary_propagation_events TO service_role;

ALTER TABLE public.planetary_system_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planetary_dependency_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planetary_propagation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planetary_system_nodes_read" ON public.planetary_system_nodes;
CREATE POLICY "planetary_system_nodes_read" ON public.planetary_system_nodes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "planetary_dependency_edges_read" ON public.planetary_dependency_edges;
CREATE POLICY "planetary_dependency_edges_read" ON public.planetary_dependency_edges FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "planetary_propagation_events_read" ON public.planetary_propagation_events;
CREATE POLICY "planetary_propagation_events_read" ON public.planetary_propagation_events FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_planetary_nodes_domain
ON public.planetary_system_nodes(node_domain, operational_status);

CREATE INDEX IF NOT EXISTS idx_planetary_edges_source_target
ON public.planetary_dependency_edges(source_node_key, target_node_key);

CREATE INDEX IF NOT EXISTS idx_planetary_propagation_events
ON public.planetary_propagation_events(source_domain, impact_probability DESC, generated_at DESC);

INSERT INTO public.planetary_system_nodes(node_key,node_name,node_domain,node_type,baseline_risk,resilience_score)
VALUES
('global-food-system','Global Food System','food','critical_infrastructure',45,62),
('global-shipping-network','Global Shipping Network','logistics','critical_infrastructure',50,58),
('global-energy-grid','Global Energy Grid','energy','critical_infrastructure',48,55),
('global-climate-system','Global Climate System','climate','planetary_system',70,40),
('global-financial-system','Global Financial System','economy','critical_infrastructure',52,60),
('global-migration-system','Global Migration System','migration','humanitarian_system',42,47),
('global-health-system','Global Health System','health','humanitarian_system',46,59),
('global-internet-backbone','Global Internet Backbone','cyber','critical_infrastructure',44,64)
ON CONFLICT(node_key) DO NOTHING;

INSERT INTO public.planetary_dependency_edges(edge_key,source_node_key,target_node_key,dependency_type,propagation_strength,latency_hours,evidence_confidence)
VALUES
('climate-food','global-climate-system','global-food-system','resource_dependency',0.91,168,0.93),
('food-migration','global-food-system','global-migration-system','humanitarian_pressure',0.84,336,0.88),
('shipping-economy','global-shipping-network','global-financial-system','trade_dependency',0.89,72,0.92),
('energy-economy','global-energy-grid','global-financial-system','infrastructure_dependency',0.86,48,0.9),
('cyber-shipping','global-internet-backbone','global-shipping-network','digital_dependency',0.72,12,0.84),
('health-economy','global-health-system','global-financial-system','systemic_dependency',0.78,120,0.85)
ON CONFLICT(edge_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.generate_planetary_propagation_event(
  p_source_event text,
  p_source_domain text,
  p_source_region text DEFAULT 'global',
  p_initial_severity numeric DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_probability numeric;
  v_severity numeric;
  v_key text;
  v_count integer := 0;
BEGIN
  FOR rec IN
    SELECT *
    FROM public.planetary_dependency_edges
    WHERE source_node_key IN (
      SELECT node_key
      FROM public.planetary_system_nodes
      WHERE node_domain = p_source_domain
    )
  LOOP
    v_probability := LEAST(100, ROUND((p_initial_severity * rec.propagation_strength)::numeric,2));
    v_severity := LEAST(100, ROUND((p_initial_severity * rec.propagation_strength * 0.85)::numeric,2));

    v_key := md5(p_source_event || '|' || rec.target_node_key || '|' || now()::text);

    INSERT INTO public.planetary_propagation_events(
      propagation_key, source_event, source_domain, source_region,
      impacted_node_key, impact_type, impact_probability, impact_severity,
      projected_time_window, causal_path, recommended_interventions,
      evidence_score, generated_at
    ) VALUES (
      v_key, p_source_event, p_source_domain, p_source_region,
      rec.target_node_key, rec.dependency_type, v_probability, v_severity,
      CASE
        WHEN rec.latency_hours <= 24 THEN 'immediate'
        WHEN rec.latency_hours <= 168 THEN 'short_term'
        ELSE 'medium_term'
      END,
      jsonb_build_array(
        jsonb_build_object('from',rec.source_node_key,'to',rec.target_node_key,'strength',rec.propagation_strength)
      ),
      jsonb_build_array(
        'Increase monitoring',
        'Prepare mitigation coordination',
        'Escalate executive review if severity rises'
      ),
      rec.evidence_confidence * 100,
      now()
    )
    ON CONFLICT(propagation_key) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('planetary-causal-propagation','success','generated_events=' || v_count || ', source=' || p_source_domain);

  RETURN jsonb_build_object(
    'status','success',
    'source_event',p_source_event,
    'source_domain',p_source_domain,
    'generated_propagations',v_count
  );
END;
$$;

CREATE OR REPLACE VIEW public.planetary_causal_command_view
WITH (security_invoker = true) AS
SELECT
  p.source_event,
  p.source_domain,
  n.node_name AS impacted_system,
  p.impact_type,
  p.impact_probability,
  p.impact_severity,
  p.projected_time_window,
  p.recommended_interventions,
  p.generated_at
FROM public.planetary_propagation_events p
LEFT JOIN public.planetary_system_nodes n
  ON n.node_key = p.impacted_node_key
ORDER BY p.impact_probability DESC, p.generated_at DESC;

GRANT SELECT ON public.planetary_causal_command_view TO authenticated;