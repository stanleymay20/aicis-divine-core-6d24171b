-- Multi-Hop Civilization Inference Engine
-- Strategic propagation and recursive cascade reasoning

CREATE TABLE IF NOT EXISTS civilization_inference_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_memory_node_id uuid NOT NULL REFERENCES civilization_memory_nodes(id) ON DELETE CASCADE,
  destination_memory_node_id uuid NOT NULL REFERENCES civilization_memory_nodes(id) ON DELETE CASCADE,
  hop_count integer DEFAULT 1,
  traversal_path jsonb DEFAULT '[]'::jsonb,
  inferred_relationship text NOT NULL,
  cumulative_risk_score numeric DEFAULT 0,
  propagation_velocity_score numeric DEFAULT 0,
  strategic_disruption_score numeric DEFAULT 0,
  inference_confidence numeric DEFAULT 0,
  systemic_instability_probability numeric DEFAULT 0,
  path_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inference_paths_origin
ON civilization_inference_paths(origin_memory_node_id, cumulative_risk_score DESC);

CREATE INDEX IF NOT EXISTS idx_inference_paths_destination
ON civilization_inference_paths(destination_memory_node_id, systemic_instability_probability DESC);

CREATE INDEX IF NOT EXISTS idx_inference_paths_hops
ON civilization_inference_paths(hop_count, inference_confidence DESC);

CREATE TABLE IF NOT EXISTS strategic_propagation_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_name text NOT NULL,
  triggering_memory_node_id uuid REFERENCES civilization_memory_nodes(id) ON DELETE SET NULL,
  propagation_region text,
  propagation_domain text,
  forecast_window_hours integer DEFAULT 72,
  projected_instability_score numeric DEFAULT 0,
  projected_economic_disruption numeric DEFAULT 0,
  projected_humanitarian_pressure numeric DEFAULT 0,
  projected_security_escalation numeric DEFAULT 0,
  projected_information_warfare_score numeric DEFAULT 0,
  propagation_chain jsonb DEFAULT '[]'::jsonb,
  downstream_regions jsonb DEFAULT '[]'::jsonb,
  downstream_domains jsonb DEFAULT '[]'::jsonb,
  mitigation_recommendations jsonb DEFAULT '[]'::jsonb,
  forecast_confidence numeric DEFAULT 0,
  forecast_status text DEFAULT 'active',
  generated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_strategic_forecasts_status
ON strategic_propagation_forecasts(forecast_status, projected_instability_score DESC);

CREATE INDEX IF NOT EXISTS idx_strategic_forecasts_region
ON strategic_propagation_forecasts(propagation_region, forecast_confidence DESC);

CREATE TABLE IF NOT EXISTS civilization_instability_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_name text NOT NULL,
  cluster_region text,
  cluster_domain text,
  cluster_members jsonb DEFAULT '[]'::jsonb,
  cluster_size integer DEFAULT 0,
  aggregate_stress_score numeric DEFAULT 0,
  aggregate_predictive_score numeric DEFAULT 0,
  synchronized_instability_probability numeric DEFAULT 0,
  systemic_breakdown_risk numeric DEFAULT 0,
  cluster_metadata jsonb DEFAULT '{}'::jsonb,
  detected_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instability_clusters_region
ON civilization_instability_clusters(cluster_region, aggregate_stress_score DESC);

CREATE OR REPLACE FUNCTION generate_multihop_inference_paths()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paths integer := 0;
  v_forecasts integer := 0;
BEGIN

  INSERT INTO civilization_inference_paths (
    origin_memory_node_id,
    destination_memory_node_id,
    hop_count,
    traversal_path,
    inferred_relationship,
    cumulative_risk_score,
    propagation_velocity_score,
    strategic_disruption_score,
    inference_confidence,
    systemic_instability_probability,
    path_metadata
  )
  SELECT
    a.id,
    c.id,
    2,
    jsonb_build_array(a.id, b.id, c.id),
    CASE
      WHEN a.canonical_domain = c.canonical_domain
      THEN 'recursive-domain-escalation'
      ELSE 'cross-domain-instability-propagation'
    END,
    LEAST(100,
      ROUND(
        (
          e1.edge_strength * 0.4 +
          e2.edge_strength * 0.4 +
          LEAST(a.civilization_stress_score,c.civilization_stress_score) * 0.2
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          (100 - COALESCE(e1.temporal_distance_hours,72)) * 0.5 +
          (100 - COALESCE(e2.temporal_distance_hours,72)) * 0.5
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          a.predictive_relevance_score * 0.3 +
          b.predictive_relevance_score * 0.3 +
          c.predictive_relevance_score * 0.4
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          e1.causal_probability * 0.5 +
          e2.causal_probability * 0.5
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          a.civilization_stress_score * 0.25 +
          b.civilization_stress_score * 0.35 +
          c.civilization_stress_score * 0.4
        )::numeric
      ,2)
    ),
    jsonb_build_object(
      'bridge_node', b.memory_title,
      'origin_domain', a.canonical_domain,
      'destination_domain', c.canonical_domain
    )
  FROM civilization_memory_edges e1
  JOIN civilization_memory_nodes a
    ON a.id = e1.source_memory_node_id
  JOIN civilization_memory_nodes b
    ON b.id = e1.target_memory_node_id
  JOIN civilization_memory_edges e2
    ON e2.source_memory_node_id = b.id
  JOIN civilization_memory_nodes c
    ON c.id = e2.target_memory_node_id
  WHERE a.id <> c.id
    AND NOT EXISTS (
      SELECT 1
      FROM civilization_inference_paths cip
      WHERE cip.origin_memory_node_id = a.id
        AND cip.destination_memory_node_id = c.id
    )
  LIMIT 15000;

  GET DIAGNOSTICS v_paths = ROW_COUNT;

  INSERT INTO strategic_propagation_forecasts (
    forecast_name,
    triggering_memory_node_id,
    propagation_region,
    propagation_domain,
    forecast_window_hours,
    projected_instability_score,
    projected_economic_disruption,
    projected_humanitarian_pressure,
    projected_security_escalation,
    projected_information_warfare_score,
    propagation_chain,
    downstream_regions,
    downstream_domains,
    mitigation_recommendations,
    forecast_confidence,
    expires_at
  )
  SELECT
    CONCAT(
      'Strategic propagation forecast: ',
      cmn.memory_title
    ),
    cmn.id,
    cmn.canonical_region,
    cmn.canonical_domain,
    72,
    AVG(cip.systemic_instability_probability),
    AVG(cip.strategic_disruption_score),
    AVG(cmn.civilization_stress_score) * 0.8,
    AVG(cip.cumulative_risk_score),
    AVG(cip.propagation_velocity_score),
    jsonb_agg(cip.traversal_path),
    jsonb_agg(DISTINCT dest.canonical_region),
    jsonb_agg(DISTINCT dest.canonical_domain),
    jsonb_build_array(
      'increase regional monitoring',
      'strengthen strategic stabilization pathways',
      'monitor cross-domain contagion signals'
    ),
    AVG(cip.inference_confidence),
    now() + interval '72 hours'
  FROM civilization_inference_paths cip
  JOIN civilization_memory_nodes cmn
    ON cmn.id = cip.origin_memory_node_id
  JOIN civilization_memory_nodes dest
    ON dest.id = cip.destination_memory_node_id
  GROUP BY cmn.id, cmn.memory_title, cmn.canonical_region, cmn.canonical_domain
  HAVING COUNT(*) >= 3
  LIMIT 3000;

  GET DIAGNOSTICS v_forecasts = ROW_COUNT;

  INSERT INTO civilization_instability_clusters (
    cluster_name,
    cluster_region,
    cluster_domain,
    cluster_members,
    cluster_size,
    aggregate_stress_score,
    aggregate_predictive_score,
    synchronized_instability_probability,
    systemic_breakdown_risk,
    cluster_metadata
  )
  SELECT
    CONCAT(
      COALESCE(canonical_region,'GLOBAL'),
      '-cluster-',
      COALESCE(canonical_domain,'general')
    ),
    canonical_region,
    canonical_domain,
    jsonb_agg(id),
    COUNT(*),
    AVG(civilization_stress_score),
    AVG(predictive_relevance_score),
    LEAST(100,
      ROUND((AVG(civilization_stress_score) * 0.7)::numeric,2)
    ),
    LEAST(100,
      ROUND((AVG(predictive_relevance_score) * 0.75)::numeric,2)
    ),
    jsonb_build_object(
      'high_risk_nodes', COUNT(*) FILTER (WHERE civilization_stress_score >= 75),
      'average_reinforcement', AVG(reinforcement_count)
    )
  FROM civilization_memory_nodes
  GROUP BY canonical_region, canonical_domain
  HAVING COUNT(*) >= 4;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'multihop-civilization-inference-engine',
    'success',
    'paths=' || v_paths || ', forecasts=' || v_forecasts
  );

  RETURN jsonb_build_object(
    'status','success',
    'inference_paths_generated',v_paths,
    'strategic_forecasts_generated',v_forecasts,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE VIEW civilization_strategic_command_center AS
SELECT
  spf.forecast_name,
  spf.propagation_region,
  spf.propagation_domain,
  spf.projected_instability_score,
  spf.projected_security_escalation,
  spf.projected_humanitarian_pressure,
  spf.forecast_confidence,
  cic.cluster_size,
  cic.systemic_breakdown_risk,
  CASE
    WHEN spf.projected_instability_score >= 90 THEN 'planetary-emergency'
    WHEN spf.projected_instability_score >= 75 THEN 'strategic-instability'
    WHEN spf.projected_instability_score >= 60 THEN 'elevated-watch'
    ELSE 'baseline-monitoring'
  END AS strategic_priority,
  CASE
    WHEN cic.systemic_breakdown_risk >= 85 THEN 'critical-cluster-risk'
    WHEN cic.systemic_breakdown_risk >= 70 THEN 'high-cluster-risk'
    ELSE 'moderate-cluster-risk'
  END AS cluster_risk_level
FROM strategic_propagation_forecasts spf
LEFT JOIN civilization_instability_clusters cic
  ON cic.cluster_region = spf.propagation_region
 AND cic.cluster_domain = spf.propagation_domain
WHERE spf.forecast_status = 'active'
ORDER BY spf.projected_instability_score DESC,
         spf.forecast_confidence DESC,
         cic.systemic_breakdown_risk DESC NULLS LAST;

SELECT generate_multihop_inference_paths();

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'multihop-inference-bootstrap',
  'success',
  'civilization propagation intelligence initialized'
);
