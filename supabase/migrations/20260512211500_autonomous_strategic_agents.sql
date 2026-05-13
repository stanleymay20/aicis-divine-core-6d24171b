-- Autonomous Strategic Agents & Cognitive Orchestration
-- Self-organizing planetary intelligence coordination layer

CREATE TABLE IF NOT EXISTS strategic_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL UNIQUE,
  agent_type text NOT NULL,
  mission_class text NOT NULL,
  operational_status text DEFAULT 'active',
  autonomy_level numeric DEFAULT 0,
  confidence_threshold numeric DEFAULT 0,
  escalation_threshold numeric DEFAULT 0,
  monitoring_domains jsonb DEFAULT '[]'::jsonb,
  monitoring_regions jsonb DEFAULT '[]'::jsonb,
  reasoning_capabilities jsonb DEFAULT '[]'::jsonb,
  intervention_capabilities jsonb DEFAULT '[]'::jsonb,
  assigned_priority text DEFAULT 'medium',
  execution_frequency_minutes integer DEFAULT 15,
  last_execution_at timestamptz,
  last_alert_at timestamptz,
  total_alerts_generated integer DEFAULT 0,
  total_predictions_generated integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_agents_status
ON strategic_agents(operational_status);

CREATE INDEX IF NOT EXISTS idx_strategic_agents_priority
ON strategic_agents(assigned_priority);

CREATE TABLE IF NOT EXISTS strategic_agent_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES strategic_agents(id) ON DELETE CASCADE,
  observation_type text NOT NULL,
  observation_priority text DEFAULT 'medium',
  observation_title text NOT NULL,
  observation_summary text,
  supporting_signal_ids jsonb DEFAULT '[]'::jsonb,
  supporting_scenario_ids jsonb DEFAULT '[]'::jsonb,
  supporting_cascade_ids jsonb DEFAULT '[]'::jsonb,
  confidence_score numeric DEFAULT 0,
  urgency_score numeric DEFAULT 0,
  systemic_risk_score numeric DEFAULT 0,
  escalation_probability numeric DEFAULT 0,
  stabilization_probability numeric DEFAULT 0,
  recommended_actions jsonb DEFAULT '[]'::jsonb,
  reasoning_trace jsonb DEFAULT '[]'::jsonb,
  observation_status text DEFAULT 'active',
  generated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_observations_priority
ON strategic_agent_observations(observation_priority, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_observations_risk
ON strategic_agent_observations(systemic_risk_score DESC);

CREATE TABLE IF NOT EXISTS cognitive_orchestration_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orchestration_name text NOT NULL,
  orchestration_type text NOT NULL,
  orchestration_priority text DEFAULT 'medium',
  source_agent_id uuid REFERENCES strategic_agents(id),
  task_payload jsonb DEFAULT '{}'::jsonb,
  execution_reasoning jsonb DEFAULT '[]'::jsonb,
  execution_status text DEFAULT 'pending',
  execution_started_at timestamptz,
  execution_completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cognitive_tasks_status
ON cognitive_orchestration_tasks(execution_status, created_at DESC);

CREATE OR REPLACE FUNCTION bootstrap_strategic_agents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_created integer := 0;
BEGIN

  INSERT INTO strategic_agents (
    agent_name,
    agent_type,
    mission_class,
    autonomy_level,
    confidence_threshold,
    escalation_threshold,
    monitoring_domains,
    monitoring_regions,
    reasoning_capabilities,
    intervention_capabilities,
    assigned_priority,
    execution_frequency_minutes
  )
  VALUES
  (
    'Cascade Sentinel',
    'escalation-monitor',
    'civilization-cascade-detection',
    82,
    70,
    75,
    jsonb_build_array('geopolitics','economics','security'),
    jsonb_build_array('global'),
    jsonb_build_array(
      'cascade reasoning',
      'systemic risk inference',
      'cross-domain propagation analysis'
    ),
    jsonb_build_array(
      'escalation detection',
      'priority alert generation'
    ),
    'critical',
    10
  ),
  (
    'Planetary Stress Observer',
    'systemic-instability-monitor',
    'planetary-stability-analysis',
    78,
    65,
    70,
    jsonb_build_array('climate','migration','economics','infrastructure'),
    jsonb_build_array('global'),
    jsonb_build_array(
      'macro instability analysis',
      'civilization stress mapping'
    ),
    jsonb_build_array(
      'stability forecasting',
      'pressure hotspot detection'
    ),
    'high',
    20
  ),
  (
    'Narrative Drift Hunter',
    'information-dynamics-monitor',
    'narrative-propagation-analysis',
    72,
    60,
    68,
    jsonb_build_array('media','social','geopolitics'),
    jsonb_build_array('global'),
    jsonb_build_array(
      'narrative clustering',
      'information acceleration detection'
    ),
    jsonb_build_array(
      'narrative anomaly alerts'
    ),
    'high',
    15
  ),
  (
    'Strategic Intervention Advisor',
    'intervention-simulation-agent',
    'stabilization-modeling',
    75,
    72,
    80,
    jsonb_build_array('diplomacy','economics','humanitarian'),
    jsonb_build_array('global'),
    jsonb_build_array(
      'intervention effectiveness modeling',
      'stabilization pathway simulation'
    ),
    jsonb_build_array(
      'strategic recommendation generation'
    ),
    'critical',
    30
  )
  ON CONFLICT (agent_name) DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'strategic-agent-bootstrap',
    'success',
    'agents_initialized=' || v_created
  );

  RETURN jsonb_build_object(
    'status','success',
    'agents_created',v_created,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION run_autonomous_strategic_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_observations integer := 0;
BEGIN

  INSERT INTO strategic_agent_observations (
    agent_id,
    observation_type,
    observation_priority,
    observation_title,
    observation_summary,
    supporting_signal_ids,
    supporting_scenario_ids,
    supporting_cascade_ids,
    confidence_score,
    urgency_score,
    systemic_risk_score,
    escalation_probability,
    stabilization_probability,
    recommended_actions,
    reasoning_trace,
    expires_at
  )
  SELECT
    sa.id,
    'systemic-instability-observation',
    CASE
      WHEN ps.civilization_instability_score >= 80 THEN 'critical'
      WHEN ps.civilization_instability_score >= 65 THEN 'high'
      ELSE 'medium'
    END,
    CONCAT(
      sa.agent_name,
      ' detected elevated instability risk in ',
      ps.scenario_name
    ),
    CONCAT(
      'Forecast instability=', ps.civilization_instability_score,
      ', escalation risk=', ps.escalation_risk_score,
      ', stabilization probability=', ps.stabilization_probability
    ),
    CASE
      WHEN ps.originating_event_id IS NOT NULL
      THEN jsonb_build_array(ps.originating_event_id)
      ELSE '[]'::jsonb
    END,
    jsonb_build_array(ps.id),
    CASE
      WHEN ps.originating_cascade_id IS NOT NULL
      THEN jsonb_build_array(ps.originating_cascade_id)
      ELSE '[]'::jsonb
    END,
    LEAST(100,
      ROUND(
        (
          ps.probability_score * 0.5 +
          ps.severity_score * 0.5
        )::numeric
      ,2)
    ),
    ps.severity_score,
    ps.civilization_instability_score,
    ps.escalation_risk_score,
    ps.stabilization_probability,
    ps.recommended_interventions,
    jsonb_build_array(
      CONCAT('Agent=', sa.agent_name),
      CONCAT('Scenario=', ps.scenario_name),
      CONCAT('Forecast priority=',
        CASE
          WHEN ps.civilization_instability_score >= 85 THEN 'planetary-critical'
          WHEN ps.civilization_instability_score >= 70 THEN 'systemic-instability'
          ELSE 'strategic-watch'
        END
      )
    ),
    now() + interval '48 hours'
  FROM strategic_agents sa
  CROSS JOIN predictive_scenarios ps
  WHERE sa.operational_status = 'active'
    AND ps.scenario_status = 'active'
    AND ps.generated_at >= now() - interval '24 hours'
    AND ps.civilization_instability_score >= sa.escalation_threshold
    AND NOT EXISTS (
      SELECT 1
      FROM strategic_agent_observations sao
      WHERE sao.agent_id = sa.id
        AND sao.supporting_scenario_ids @> jsonb_build_array(ps.id)
    )
  LIMIT 200;

  GET DIAGNOSTICS v_observations = ROW_COUNT;

  UPDATE strategic_agents
  SET
    last_execution_at = now(),
    total_alerts_generated = total_alerts_generated + 1,
    updated_at = now()
  WHERE operational_status = 'active';

  INSERT INTO cognitive_orchestration_tasks (
    orchestration_name,
    orchestration_type,
    orchestration_priority,
    source_agent_id,
    task_payload,
    execution_reasoning,
    execution_status,
    execution_started_at
  )
  SELECT
    CONCAT('Orchestration — ', sa.agent_name),
    'strategic-coordination',
    CASE
      WHEN sao.systemic_risk_score >= 85 THEN 'critical'
      WHEN sao.systemic_risk_score >= 70 THEN 'high'
      ELSE 'medium'
    END,
    sa.id,
    jsonb_build_object(
      'observation_id', sao.id,
      'scenario_ids', sao.supporting_scenario_ids,
      'recommended_actions', sao.recommended_actions
    ),
    sao.reasoning_trace,
    'executing',
    now()
  FROM strategic_agent_observations sao
  JOIN strategic_agents sa
    ON sa.id = sao.agent_id
  WHERE sao.generated_at >= now() - interval '5 minutes';

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'autonomous-strategic-cycle',
    'success',
    'observations_generated=' || v_observations
  );

  RETURN jsonb_build_object(
    'status','success',
    'observations_generated',v_observations,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE VIEW strategic_command_center_view AS
SELECT
  sao.observation_title,
  sao.observation_priority,
  sao.confidence_score,
  sao.urgency_score,
  sao.systemic_risk_score,
  sao.escalation_probability,
  sao.stabilization_probability,
  sa.agent_name,
  sa.agent_type,
  sao.recommended_actions,
  sao.generated_at,
  CASE
    WHEN sao.systemic_risk_score >= 90 THEN 'planetary-emergency'
    WHEN sao.systemic_risk_score >= 75 THEN 'strategic-crisis'
    WHEN sao.systemic_risk_score >= 60 THEN 'elevated-watch'
    ELSE 'monitoring'
  END AS command_priority
FROM strategic_agent_observations sao
JOIN strategic_agents sa
  ON sa.id = sao.agent_id
WHERE sao.observation_status = 'active'
ORDER BY sao.systemic_risk_score DESC,
         sao.urgency_score DESC,
         sao.generated_at DESC;

SELECT bootstrap_strategic_agents();

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'autonomous-strategic-agents-bootstrap',
  'success',
  'autonomous strategic orchestration initialized'
);
