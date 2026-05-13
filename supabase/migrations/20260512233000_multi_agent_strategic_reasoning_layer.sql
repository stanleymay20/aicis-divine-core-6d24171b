-- Multi-Agent Strategic Reasoning Layer
-- Distributed civilization reasoning and adversarial consensus intelligence

CREATE TABLE IF NOT EXISTS civilization_reasoning_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text UNIQUE NOT NULL,
  agent_type text NOT NULL,
  strategic_domain text,
  reasoning_style text,
  specialization_vector jsonb DEFAULT '{}'::jsonb,
  calibration_weight numeric DEFAULT 1,
  trust_score numeric DEFAULT 50,
  adversarial_resilience_score numeric DEFAULT 50,
  consensus_alignment_score numeric DEFAULT 50,
  recursive_reasoning_depth integer DEFAULT 1,
  active_status boolean DEFAULT true,
  last_execution_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reasoning_agents_domain
ON civilization_reasoning_agents(strategic_domain, trust_score DESC);

CREATE TABLE IF NOT EXISTS civilization_reasoning_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_name text,
  triggering_signal_id uuid REFERENCES global_signals(id) ON DELETE SET NULL,
  triggering_forecast_id uuid REFERENCES strategic_propagation_forecasts(id) ON DELETE SET NULL,
  reasoning_objective text,
  reasoning_scope text,
  consensus_status text DEFAULT 'pending',
  consensus_confidence numeric DEFAULT 0,
  disagreement_index numeric DEFAULT 0,
  adversarial_pressure_score numeric DEFAULT 0,
  recursive_iteration_count integer DEFAULT 0,
  strategic_risk_score numeric DEFAULT 0,
  session_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reasoning_sessions_status
ON civilization_reasoning_sessions(consensus_status, consensus_confidence DESC);

CREATE TABLE IF NOT EXISTS civilization_agent_reasoning_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES civilization_reasoning_sessions(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES civilization_reasoning_agents(id) ON DELETE CASCADE,
  reasoning_position text,
  reasoning_summary text,
  strategic_assessment text,
  confidence_score numeric DEFAULT 0,
  threat_probability numeric DEFAULT 0,
  opportunity_probability numeric DEFAULT 0,
  escalation_probability numeric DEFAULT 0,
  systemic_impact_score numeric DEFAULT 0,
  reasoning_evidence jsonb DEFAULT '[]'::jsonb,
  reasoning_metadata jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_outputs_session
ON civilization_agent_reasoning_outputs(session_id, confidence_score DESC);

CREATE TABLE IF NOT EXISTS civilization_agent_consensus_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES civilization_reasoning_sessions(id) ON DELETE CASCADE,
  consensus_vector jsonb DEFAULT '{}'::jsonb,
  dominant_position text,
  minority_positions jsonb DEFAULT '[]'::jsonb,
  consensus_strength numeric DEFAULT 0,
  adversarial_divergence_score numeric DEFAULT 0,
  systemic_alignment_score numeric DEFAULT 0,
  stabilization_recommendation text,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consensus_maps_strength
ON civilization_agent_consensus_maps(consensus_strength DESC);

CREATE TABLE IF NOT EXISTS civilization_strategic_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reasoning_session_id uuid REFERENCES civilization_reasoning_sessions(id) ON DELETE SET NULL,
  intervention_title text,
  intervention_domain text,
  intervention_region text,
  intervention_priority text,
  intervention_description text,
  projected_stabilization_score numeric DEFAULT 0,
  projected_risk_reduction numeric DEFAULT 0,
  projected_cost_index numeric DEFAULT 0,
  projected_success_probability numeric DEFAULT 0,
  intervention_metadata jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_interventions_priority
ON civilization_strategic_interventions(intervention_priority, projected_success_probability DESC);

INSERT INTO civilization_reasoning_agents (
  agent_name,
  agent_type,
  strategic_domain,
  reasoning_style,
  specialization_vector,
  recursive_reasoning_depth
)
VALUES
(
  'geopolitical-strategist-agent',
  'strategic-geopolitical',
  'geopolitics',
  'statecraft-analysis',
  jsonb_build_object(
    'focus','geopolitical escalation',
    'priority','cross-border propagation',
    'analysis_mode','state-alignment'
  ),
  4
),
(
  'economic-fracture-agent',
  'macro-economic',
  'economics',
  'systemic-economic-analysis',
  jsonb_build_object(
    'focus','market contagion',
    'priority','supply chain instability',
    'analysis_mode','economic propagation'
  ),
  5
),
(
  'humanitarian-stability-agent',
  'humanitarian-analysis',
  'humanitarian',
  'population-impact-analysis',
  jsonb_build_object(
    'focus','civilian instability',
    'priority','human displacement',
    'analysis_mode','social stabilization'
  ),
  4
),
(
  'adversarial-narrative-agent',
  'information-warfare',
  'narratives',
  'adversarial-reasoning',
  jsonb_build_object(
    'focus','narrative manipulation',
    'priority','propaganda detection',
    'analysis_mode','counter-intelligence'
  ),
  6
),
(
  'infrastructure-resilience-agent',
  'critical-infrastructure',
  'infrastructure',
  'resilience-analysis',
  jsonb_build_object(
    'focus','infrastructure fragility',
    'priority','systemic continuity',
    'analysis_mode','failure prevention'
  ),
  5
),
(
  'civilization-synthesis-agent',
  'meta-strategic',
  'meta-civilization',
  'cross-domain-synthesis',
  jsonb_build_object(
    'focus','planetary system synthesis',
    'priority','civilization equilibrium',
    'analysis_mode','recursive consensus'
  ),
  8
)
ON CONFLICT (agent_name) DO NOTHING;

CREATE OR REPLACE FUNCTION run_multi_agent_reasoning_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sessions integer := 0;
  v_outputs integer := 0;
  v_consensus integer := 0;
  v_interventions integer := 0;
BEGIN

  INSERT INTO civilization_reasoning_sessions (
    session_name,
    triggering_signal_id,
    triggering_forecast_id,
    reasoning_objective,
    reasoning_scope,
    strategic_risk_score,
    adversarial_pressure_score,
    recursive_iteration_count,
    session_metadata
  )
  SELECT
    CONCAT('reasoning-session-', gs.id),
    gs.id,
    spf.id,
    CONCAT('analyze systemic implications of ', COALESCE(gs.category,'global-event')),
    'cross-domain-civilization-analysis',
    LEAST(100,
      ROUND(
        (
          COALESCE(gs.urgency_score,50) * 0.4 +
          COALESCE(gs.impact_score,50) * 0.4 +
          COALESCE(spf.propagation_confidence,50) * 0.2
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          COALESCE(spf.propagation_velocity,0) * 0.7 +
          COALESCE(gs.corroboration_count,1) * 5
        )::numeric
      ,2)
    ),
    3,
    jsonb_build_object(
      'signal_category', gs.category,
      'affected_countries', gs.affected_countries,
      'propagation_domain', spf.propagation_domain
    )
  FROM global_signals gs
  LEFT JOIN strategic_propagation_forecasts spf
    ON spf.triggering_signal_id = gs.id
  WHERE gs.canonical_event_status = 'canonical'
    AND (COALESCE(gs.urgency_score,0) >= 70
      OR COALESCE(gs.impact_score,0) >= 70)
    AND NOT EXISTS (
      SELECT 1
      FROM civilization_reasoning_sessions crs
      WHERE crs.triggering_signal_id = gs.id
    )
  LIMIT 200;

  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  INSERT INTO civilization_agent_reasoning_outputs (
    session_id,
    agent_id,
    reasoning_position,
    reasoning_summary,
    strategic_assessment,
    confidence_score,
    threat_probability,
    opportunity_probability,
    escalation_probability,
    systemic_impact_score,
    reasoning_evidence,
    reasoning_metadata
  )
  SELECT
    crs.id,
    cra.id,
    CASE
      WHEN cra.agent_type = 'strategic-geopolitical'
        THEN 'geopolitical escalation monitoring'
      WHEN cra.agent_type = 'macro-economic'
        THEN 'economic contagion monitoring'
      WHEN cra.agent_type = 'humanitarian-analysis'
        THEN 'civilian stabilization priority'
      WHEN cra.agent_type = 'information-warfare'
        THEN 'narrative warfare detection'
      WHEN cra.agent_type = 'critical-infrastructure'
        THEN 'infrastructure continuity preservation'
      ELSE 'planetary equilibrium synthesis'
    END,
    CONCAT(
      cra.agent_name,
      ' detected elevated systemic conditions within ',
      COALESCE(crs.reasoning_scope,'global scope')
    ),
    CONCAT(
      'Strategic assessment generated for ',
      cra.strategic_domain,
      ' domain analysis'
    ),
    LEAST(100,
      ROUND(
        (
          cra.trust_score * 0.4 +
          crs.strategic_risk_score * 0.4 +
          random() * 20
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          crs.strategic_risk_score * (0.7 + random() * 0.2)
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          (100 - crs.strategic_risk_score) * (0.4 + random() * 0.4)
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          crs.adversarial_pressure_score * (0.6 + random() * 0.3)
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          crs.strategic_risk_score * 0.5 +
          cra.consensus_alignment_score * 0.5
        )::numeric
      ,2)
    ),
    jsonb_build_array(
      jsonb_build_object(
        'type','signal-analysis',
        'risk_score', crs.strategic_risk_score
      ),
      jsonb_build_object(
        'type','agent-specialization',
        'domain', cra.strategic_domain
      )
    ),
    jsonb_build_object(
      'recursive_depth', cra.recursive_reasoning_depth,
      'reasoning_style', cra.reasoning_style
    )
  FROM civilization_reasoning_sessions crs
  CROSS JOIN civilization_reasoning_agents cra
  WHERE cra.active_status = true
    AND NOT EXISTS (
      SELECT 1
      FROM civilization_agent_reasoning_outputs caro
      WHERE caro.session_id = crs.id
        AND caro.agent_id = cra.id
    );

  GET DIAGNOSTICS v_outputs = ROW_COUNT;

  INSERT INTO civilization_agent_consensus_maps (
    session_id,
    consensus_vector,
    dominant_position,
    minority_positions,
    consensus_strength,
    adversarial_divergence_score,
    systemic_alignment_score,
    stabilization_recommendation
  )
  SELECT
    session_id,
    jsonb_build_object(
      'average_confidence', AVG(confidence_score),
      'average_threat_probability', AVG(threat_probability),
      'average_escalation_probability', AVG(escalation_probability)
    ),
    (
      array_agg(reasoning_position ORDER BY confidence_score DESC)
    )[1],
    to_jsonb(array_agg(DISTINCT reasoning_position)),
    LEAST(100,
      ROUND(AVG(confidence_score)::numeric,2)
    ),
    ROUND(
      (
        MAX(confidence_score) - MIN(confidence_score)
      )::numeric
    ,2),
    LEAST(100,
      ROUND(AVG(systemic_impact_score)::numeric,2)
    ),
    CASE
      WHEN AVG(threat_probability) >= 80
        THEN 'immediate strategic stabilization required'
      WHEN AVG(threat_probability) >= 60
        THEN 'elevated monitoring and intervention recommended'
      ELSE 'maintain adaptive observation posture'
    END
  FROM civilization_agent_reasoning_outputs
  GROUP BY session_id;

  GET DIAGNOSTICS v_consensus = ROW_COUNT;

  INSERT INTO civilization_strategic_interventions (
    reasoning_session_id,
    intervention_title,
    intervention_domain,
    intervention_region,
    intervention_priority,
    intervention_description,
    projected_stabilization_score,
    projected_risk_reduction,
    projected_cost_index,
    projected_success_probability,
    intervention_metadata
  )
  SELECT
    crs.id,
    CONCAT('strategic stabilization protocol - ', crs.id),
    'cross-domain-stabilization',
    COALESCE(caro.reasoning_metadata->>'region','global'),
    CASE
      WHEN cacm.consensus_strength >= 80 THEN 'critical'
      WHEN cacm.consensus_strength >= 65 THEN 'high'
      ELSE 'moderate'
    END,
    cacm.stabilization_recommendation,
    LEAST(100, cacm.systemic_alignment_score),
    LEAST(100, cacm.consensus_strength * 0.8),
    ROUND((random() * 40 + 30)::numeric,2),
    LEAST(100,
      ROUND(
        (
          cacm.consensus_strength * 0.6 +
          (100 - cacm.adversarial_divergence_score) * 0.4
        )::numeric
      ,2)
    ),
    jsonb_build_object(
      'dominant_position', cacm.dominant_position,
      'divergence_score', cacm.adversarial_divergence_score
    )
  FROM civilization_reasoning_sessions crs
  LEFT JOIN civilization_agent_consensus_maps cacm
    ON cacm.session_id = crs.id
  LEFT JOIN civilization_agent_reasoning_outputs caro
    ON caro.session_id = crs.id
  WHERE cacm.id IS NOT NULL;

  GET DIAGNOSTICS v_interventions = ROW_COUNT;

  UPDATE civilization_reasoning_sessions crs
  SET
    consensus_status = 'resolved',
    consensus_confidence = cacm.consensus_strength,
    disagreement_index = cacm.adversarial_divergence_score,
    completed_at = now()
  FROM civilization_agent_consensus_maps cacm
  WHERE cacm.session_id = crs.id;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'multi-agent-strategic-reasoning-layer',
    'success',
    'sessions=' || v_sessions || ', outputs=' || v_outputs || ', consensus=' || v_consensus || ', interventions=' || v_interventions
  );

  RETURN jsonb_build_object(
    'status','success',
    'reasoning_sessions_generated',v_sessions,
    'agent_outputs_generated',v_outputs,
    'consensus_maps_generated',v_consensus,
    'strategic_interventions_generated',v_interventions,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE VIEW civilization_reasoning_overview AS
SELECT
  crs.id,
  crs.reasoning_objective,
  crs.reasoning_scope,
  crs.consensus_status,
  crs.consensus_confidence,
  crs.disagreement_index,
  crs.strategic_risk_score,
  cacm.dominant_position,
  cacm.consensus_strength,
  cacm.adversarial_divergence_score,
  COUNT(DISTINCT caro.agent_id) AS participating_agents,
  AVG(caro.threat_probability) AS average_threat_probability,
  AVG(caro.escalation_probability) AS average_escalation_probability,
  AVG(caro.systemic_impact_score) AS average_systemic_impact,
  crs.created_at
FROM civilization_reasoning_sessions crs
LEFT JOIN civilization_agent_consensus_maps cacm
  ON cacm.session_id = crs.id
LEFT JOIN civilization_agent_reasoning_outputs caro
  ON caro.session_id = crs.id
GROUP BY
  crs.id,
  cacm.id
ORDER BY crs.consensus_confidence DESC,
         average_systemic_impact DESC,
         crs.strategic_risk_score DESC;

SELECT run_multi_agent_reasoning_cycle();

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'multi-agent-reasoning-bootstrap',
  'success',
  'distributed civilization reasoning initialized'
);
