-- Recursive Causal World Modeling Engine
-- Civilization-scale causal propagation and temporal world-state intelligence

CREATE TABLE IF NOT EXISTS civilization_world_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_timestamp timestamptz NOT NULL DEFAULT now(),
  world_stability_index numeric DEFAULT 50,
  geopolitical_tension_index numeric DEFAULT 50,
  economic_stress_index numeric DEFAULT 50,
  humanitarian_pressure_index numeric DEFAULT 50,
  infrastructure_fragility_index numeric DEFAULT 50,
  environmental_instability_index numeric DEFAULT 50,
  narrative_warfare_index numeric DEFAULT 50,
  systemic_entropy_score numeric DEFAULT 50,
  civilization_resilience_score numeric DEFAULT 50,
  planetary_equilibrium_score numeric DEFAULT 50,
  world_state_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_states_timestamp
ON civilization_world_states(state_timestamp DESC);

CREATE TABLE IF NOT EXISTS civilization_causal_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_name text UNIQUE NOT NULL,
  node_domain text,
  node_type text,
  baseline_stability numeric DEFAULT 50,
  volatility_score numeric DEFAULT 50,
  propagation_sensitivity numeric DEFAULT 50,
  resilience_factor numeric DEFAULT 50,
  causal_weight numeric DEFAULT 1,
  recursive_importance numeric DEFAULT 1,
  node_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_causal_nodes_domain
ON civilization_causal_nodes(node_domain, recursive_importance DESC);

CREATE TABLE IF NOT EXISTS civilization_causal_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id uuid REFERENCES civilization_causal_nodes(id) ON DELETE CASCADE,
  target_node_id uuid REFERENCES civilization_causal_nodes(id) ON DELETE CASCADE,
  causal_relationship_type text,
  propagation_strength numeric DEFAULT 0,
  propagation_velocity numeric DEFAULT 0,
  directional_confidence numeric DEFAULT 0,
  feedback_loop_strength numeric DEFAULT 0,
  recursive_amplification_factor numeric DEFAULT 1,
  edge_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(source_node_id, target_node_id)
);

CREATE INDEX IF NOT EXISTS idx_causal_edges_strength
ON civilization_causal_edges(propagation_strength DESC, feedback_loop_strength DESC);

CREATE TABLE IF NOT EXISTS civilization_causal_propagation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggering_signal_id uuid REFERENCES global_signals(id) ON DELETE SET NULL,
  source_node_id uuid REFERENCES civilization_causal_nodes(id) ON DELETE SET NULL,
  target_node_id uuid REFERENCES civilization_causal_nodes(id) ON DELETE SET NULL,
  propagation_wave integer DEFAULT 1,
  propagation_depth integer DEFAULT 1,
  propagation_probability numeric DEFAULT 0,
  projected_systemic_impact numeric DEFAULT 0,
  projected_stability_shift numeric DEFAULT 0,
  projected_entropy_shift numeric DEFAULT 0,
  causal_path jsonb DEFAULT '[]'::jsonb,
  propagation_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_causal_propagation_wave
ON civilization_causal_propagation_events(propagation_wave, projected_systemic_impact DESC);

CREATE TABLE IF NOT EXISTS civilization_temporal_trajectories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trajectory_name text,
  trajectory_type text,
  starting_world_state_id uuid REFERENCES civilization_world_states(id) ON DELETE SET NULL,
  projected_horizon_days integer DEFAULT 30,
  trajectory_confidence numeric DEFAULT 0,
  projected_world_stability numeric DEFAULT 50,
  projected_geopolitical_tension numeric DEFAULT 50,
  projected_economic_stress numeric DEFAULT 50,
  projected_humanitarian_pressure numeric DEFAULT 50,
  projected_systemic_entropy numeric DEFAULT 50,
  trajectory_vector jsonb DEFAULT '{}'::jsonb,
  trajectory_metadata jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_temporal_trajectories_confidence
ON civilization_temporal_trajectories(trajectory_confidence DESC, projected_horizon_days DESC);

CREATE TABLE IF NOT EXISTS civilization_hidden_variable_inference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inference_name text,
  hidden_variable_type text,
  inferred_probability numeric DEFAULT 0,
  inferred_systemic_pressure numeric DEFAULT 0,
  inferred_destabilization_risk numeric DEFAULT 0,
  supporting_signal_count integer DEFAULT 0,
  supporting_evidence jsonb DEFAULT '[]'::jsonb,
  inference_metadata jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hidden_variable_probability
ON civilization_hidden_variable_inference(inferred_probability DESC);

CREATE TABLE IF NOT EXISTS civilization_equilibrium_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equilibrium_name text,
  equilibrium_status text,
  equilibrium_score numeric DEFAULT 50,
  instability_pressure numeric DEFAULT 50,
  stabilization_capacity numeric DEFAULT 50,
  recursive_feedback_intensity numeric DEFAULT 50,
  cross_domain_correlation numeric DEFAULT 50,
  equilibrium_vector jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equilibrium_score
ON civilization_equilibrium_maps(equilibrium_score DESC, instability_pressure DESC);

INSERT INTO civilization_causal_nodes (
  node_name,
  node_domain,
  node_type,
  baseline_stability,
  volatility_score,
  propagation_sensitivity,
  resilience_factor,
  recursive_importance,
  node_metadata
)
VALUES
(
  'global-energy-network',
  'energy',
  'infrastructure-network',
  72,
  64,
  88,
  61,
  9,
  jsonb_build_object(
    'focus','energy propagation',
    'criticality','planetary'
  )
),
(
  'global-financial-system',
  'economics',
  'macro-economic-network',
  68,
  82,
  91,
  57,
  10,
  jsonb_build_object(
    'focus','market contagion',
    'criticality','planetary'
  )
),
(
  'humanitarian-displacement-system',
  'humanitarian',
  'population-network',
  59,
  77,
  84,
  54,
  8,
  jsonb_build_object(
    'focus','population instability',
    'criticality','global'
  )
),
(
  'narrative-information-network',
  'narratives',
  'information-network',
  63,
  88,
  93,
  49,
  9,
  jsonb_build_object(
    'focus','narrative warfare',
    'criticality','planetary'
  )
),
(
  'critical-supply-chain-system',
  'logistics',
  'supply-network',
  66,
  74,
  89,
  58,
  9,
  jsonb_build_object(
    'focus','global logistics',
    'criticality','planetary'
  )
),
(
  'planetary-governance-equilibrium',
  'meta-civilization',
  'civilization-equilibrium',
  71,
  69,
  95,
  63,
  12,
  jsonb_build_object(
    'focus','planetary equilibrium',
    'criticality','civilization-scale'
  )
)
ON CONFLICT (node_name) DO NOTHING;

INSERT INTO civilization_causal_edges (
  source_node_id,
  target_node_id,
  causal_relationship_type,
  propagation_strength,
  propagation_velocity,
  directional_confidence,
  feedback_loop_strength,
  recursive_amplification_factor,
  edge_metadata
)
SELECT
  src.id,
  tgt.id,
  'cross-domain-causal-propagation',
  ROUND((60 + random() * 35)::numeric,2),
  ROUND((50 + random() * 40)::numeric,2),
  ROUND((65 + random() * 25)::numeric,2),
  ROUND((40 + random() * 45)::numeric,2),
  ROUND((1 + random() * 3)::numeric,2),
  jsonb_build_object(
    'source_domain', src.node_domain,
    'target_domain', tgt.node_domain
  )
FROM civilization_causal_nodes src
CROSS JOIN civilization_causal_nodes tgt
WHERE src.id != tgt.id
ON CONFLICT (source_node_id, target_node_id) DO NOTHING;

CREATE OR REPLACE FUNCTION run_recursive_world_modeling_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_world_states integer := 0;
  v_propagation_events integer := 0;
  v_trajectories integer := 0;
  v_hidden_variables integer := 0;
  v_equilibrium integer := 0;
BEGIN

  INSERT INTO civilization_world_states (
    world_stability_index,
    geopolitical_tension_index,
    economic_stress_index,
    humanitarian_pressure_index,
    infrastructure_fragility_index,
    environmental_instability_index,
    narrative_warfare_index,
    systemic_entropy_score,
    civilization_resilience_score,
    planetary_equilibrium_score,
    world_state_metadata
  )
  SELECT
    LEAST(100,
      ROUND(
        (
          100 - AVG(COALESCE(gs.impact_score,50)) * 0.4
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        AVG(
          CASE
            WHEN gs.category ILIKE '%conflict%'
              OR gs.category ILIKE '%war%'
            THEN COALESCE(gs.urgency_score,50)
            ELSE 35
          END
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        AVG(
          CASE
            WHEN gs.category ILIKE '%economic%'
            THEN COALESCE(gs.impact_score,50)
            ELSE 40
          END
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        AVG(
          CASE
            WHEN gs.category ILIKE '%humanitarian%'
            THEN COALESCE(gs.impact_score,50)
            ELSE 45
          END
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND((AVG(COALESCE(gs.urgency_score,50)) * 0.7)::numeric,2)
    ),
    LEAST(100,
      ROUND((AVG(COALESCE(gs.confidence_score,50)) * 0.5)::numeric,2)
    ),
    LEAST(100,
      ROUND((AVG(COALESCE(gs.corroboration_count,1)) * 8)::numeric,2)
    ),
    LEAST(100,
      ROUND(
        (
          AVG(COALESCE(gs.urgency_score,50)) * 0.5 +
          AVG(COALESCE(gs.impact_score,50)) * 0.5
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          100 - AVG(COALESCE(gs.urgency_score,50)) * 0.3
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          100 - AVG(COALESCE(gs.impact_score,50)) * 0.4
        )::numeric
      ,2)
    ),
    jsonb_build_object(
      'signals_analyzed', COUNT(gs.id),
      'canonical_events', COUNT(*) FILTER (
        WHERE gs.canonical_event_status = 'canonical'
      )
    )
  FROM global_signals gs
  WHERE gs.ingested_at >= now() - interval '24 hours';

  GET DIAGNOSTICS v_world_states = ROW_COUNT;

  INSERT INTO civilization_causal_propagation_events (
    triggering_signal_id,
    source_node_id,
    target_node_id,
    propagation_wave,
    propagation_depth,
    propagation_probability,
    projected_systemic_impact,
    projected_stability_shift,
    projected_entropy_shift,
    causal_path,
    propagation_metadata
  )
  SELECT
    gs.id,
    ce.source_node_id,
    ce.target_node_id,
    FLOOR(random() * 5 + 1)::integer,
    FLOOR(random() * 6 + 1)::integer,
    LEAST(100,
      ROUND(
        (
          ce.propagation_strength * 0.6 +
          COALESCE(gs.impact_score,50) * 0.4
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          ce.propagation_strength * ce.recursive_amplification_factor
        )::numeric
      ,2)
    ),
    ROUND(
      (
        -1 * (random() * 25)
      )::numeric
    ,2),
    ROUND(
      (
        random() * 35
      )::numeric
    ,2),
    jsonb_build_array(
      jsonb_build_object(
        'source_node', src.node_name,
        'target_node', tgt.node_name
      )
    ),
    jsonb_build_object(
      'signal_category', gs.category,
      'edge_relationship', ce.causal_relationship_type
    )
  FROM global_signals gs
  CROSS JOIN LATERAL (
    SELECT *
    FROM civilization_causal_edges
    ORDER BY propagation_strength DESC
    LIMIT 4
  ) ce
  LEFT JOIN civilization_causal_nodes src
    ON src.id = ce.source_node_id
  LEFT JOIN civilization_causal_nodes tgt
    ON tgt.id = ce.target_node_id
  WHERE gs.canonical_event_status = 'canonical'
    AND COALESCE(gs.impact_score,0) >= 70
    AND NOT EXISTS (
      SELECT 1
      FROM civilization_causal_propagation_events ccpe
      WHERE ccpe.triggering_signal_id = gs.id
    )
  LIMIT 400;

  GET DIAGNOSTICS v_propagation_events = ROW_COUNT;

  INSERT INTO civilization_temporal_trajectories (
    trajectory_name,
    trajectory_type,
    starting_world_state_id,
    projected_horizon_days,
    trajectory_confidence,
    projected_world_stability,
    projected_geopolitical_tension,
    projected_economic_stress,
    projected_humanitarian_pressure,
    projected_systemic_entropy,
    trajectory_vector,
    trajectory_metadata
  )
  SELECT
    CONCAT('trajectory-', cws.id),
    'recursive-civilization-trajectory',
    cws.id,
    horizon.days,
    LEAST(100,
      ROUND(
        (
          cws.civilization_resilience_score * 0.6 +
          random() * 25
        )::numeric
      ,2)
    ),
    GREATEST(0,
      LEAST(100,
        ROUND(
          (
            cws.world_stability_index - random() * 15
          )::numeric
        ,2)
      )
    ),
    LEAST(100,
      ROUND(
        (
          cws.geopolitical_tension_index + random() * 20
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          cws.economic_stress_index + random() * 18
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          cws.humanitarian_pressure_index + random() * 22
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          cws.systemic_entropy_score + random() * 25
        )::numeric
      ,2)
    ),
    jsonb_build_object(
      'projected_horizon', horizon.days,
      'entropy_trend', 'elevated'
    ),
    jsonb_build_object(
      'projection_model','recursive-causal-propagation'
    )
  FROM civilization_world_states cws
  CROSS JOIN (
    VALUES (7),(30),(90),(180)
  ) AS horizon(days)
  WHERE NOT EXISTS (
    SELECT 1
    FROM civilization_temporal_trajectories ctt
    WHERE ctt.starting_world_state_id = cws.id
  );

  GET DIAGNOSTICS v_trajectories = ROW_COUNT;

  INSERT INTO civilization_hidden_variable_inference (
    inference_name,
    hidden_variable_type,
    inferred_probability,
    inferred_systemic_pressure,
    inferred_destabilization_risk,
    supporting_signal_count,
    supporting_evidence,
    inference_metadata
  )
  SELECT
    CONCAT('hidden-variable-', gs.category),
    'latent-systemic-pressure',
    LEAST(100,
      ROUND(
        (
          AVG(COALESCE(gs.confidence_score,50)) * 0.7 +
          random() * 20
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          AVG(COALESCE(gs.impact_score,50)) * 0.8
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          AVG(COALESCE(gs.urgency_score,50)) * 0.75
        )::numeric
      ,2)
    ),
    COUNT(gs.id),
    jsonb_agg(
      jsonb_build_object(
        'signal_id', gs.id,
        'category', gs.category
      )
    ),
    jsonb_build_object(
      'inference_domain', gs.category,
      'analysis_window','24h'
    )
  FROM global_signals gs
  WHERE gs.ingested_at >= now() - interval '24 hours'
  GROUP BY gs.category;

  GET DIAGNOSTICS v_hidden_variables = ROW_COUNT;

  INSERT INTO civilization_equilibrium_maps (
    equilibrium_name,
    equilibrium_status,
    equilibrium_score,
    instability_pressure,
    stabilization_capacity,
    recursive_feedback_intensity,
    cross_domain_correlation,
    equilibrium_vector
  )
  SELECT
    CONCAT('planetary-equilibrium-', cws.id),
    CASE
      WHEN cws.planetary_equilibrium_score >= 70 THEN 'stable'
      WHEN cws.planetary_equilibrium_score >= 50 THEN 'fragile'
      ELSE 'unstable'
    END,
    cws.planetary_equilibrium_score,
    cws.systemic_entropy_score,
    cws.civilization_resilience_score,
    LEAST(100,
      ROUND(
        (
          AVG(ccpe.projected_entropy_shift) * 2
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          AVG(ccpe.projected_systemic_impact) * 0.8
        )::numeric
      ,2)
    ),
    jsonb_build_object(
      'world_stability', cws.world_stability_index,
      'systemic_entropy', cws.systemic_entropy_score,
      'civilization_resilience', cws.civilization_resilience_score
    )
  FROM civilization_world_states cws
  LEFT JOIN civilization_causal_propagation_events ccpe
    ON ccpe.created_at >= now() - interval '24 hours'
  GROUP BY cws.id;

  GET DIAGNOSTICS v_equilibrium = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'recursive-causal-world-modeling-engine',
    'success',
    'world_states=' || v_world_states ||
    ', propagation=' || v_propagation_events ||
    ', trajectories=' || v_trajectories ||
    ', hidden_variables=' || v_hidden_variables ||
    ', equilibrium=' || v_equilibrium
  );

  RETURN jsonb_build_object(
    'status','success',
    'world_states_generated',v_world_states,
    'propagation_events_generated',v_propagation_events,
    'temporal_trajectories_generated',v_trajectories,
    'hidden_variables_generated',v_hidden_variables,
    'equilibrium_maps_generated',v_equilibrium,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE VIEW civilization_world_model_overview AS
SELECT
  cws.id,
  cws.state_timestamp,
  cws.world_stability_index,
  cws.geopolitical_tension_index,
  cws.economic_stress_index,
  cws.humanitarian_pressure_index,
  cws.systemic_entropy_score,
  cws.civilization_resilience_score,
  cem.equilibrium_status,
  cem.equilibrium_score,
  cem.instability_pressure,
  COUNT(DISTINCT ccpe.id) AS active_propagation_events,
  AVG(ccpe.projected_systemic_impact) AS avg_systemic_impact,
  AVG(ccpe.projected_entropy_shift) AS avg_entropy_shift
FROM civilization_world_states cws
LEFT JOIN civilization_equilibrium_maps cem
  ON cem.generated_at >= cws.created_at - interval '1 hour'
LEFT JOIN civilization_causal_propagation_events ccpe
  ON ccpe.created_at >= cws.created_at - interval '24 hours'
GROUP BY cws.id, cem.id
ORDER BY cws.state_timestamp DESC,
         cws.systemic_entropy_score DESC;

SELECT run_recursive_world_modeling_cycle();

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'recursive-world-model-bootstrap',
  'success',
  'civilization world-modeling intelligence initialized'
);
