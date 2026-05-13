-- Predictive Scenario Simulation Engine
-- Future-state modeling and probabilistic civilization forecasting

CREATE TABLE IF NOT EXISTS predictive_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_name text NOT NULL,
  scenario_type text NOT NULL,
  originating_event_id uuid,
  originating_cascade_id uuid,
  forecast_window_hours integer DEFAULT 24,
  probability_score numeric DEFAULT 0,
  severity_score numeric DEFAULT 0,
  civilization_instability_score numeric DEFAULT 0,
  escalation_risk_score numeric DEFAULT 0,
  intervention_effectiveness_score numeric DEFAULT 0,
  stabilization_probability numeric DEFAULT 0,
  projected_domains jsonb DEFAULT '[]'::jsonb,
  projected_regions jsonb DEFAULT '[]'::jsonb,
  projected_secondary_effects jsonb DEFAULT '[]'::jsonb,
  projected_economic_effects jsonb DEFAULT '[]'::jsonb,
  projected_geopolitical_effects jsonb DEFAULT '[]'::jsonb,
  projected_humanitarian_effects jsonb DEFAULT '[]'::jsonb,
  simulation_reasoning jsonb DEFAULT '[]'::jsonb,
  recommended_interventions jsonb DEFAULT '[]'::jsonb,
  scenario_status text DEFAULT 'active',
  generated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_predictive_scenarios_probability
ON predictive_scenarios(probability_score DESC);

CREATE INDEX IF NOT EXISTS idx_predictive_scenarios_severity
ON predictive_scenarios(severity_score DESC);

CREATE INDEX IF NOT EXISTS idx_predictive_scenarios_generated
ON predictive_scenarios(generated_at DESC);

CREATE TABLE IF NOT EXISTS scenario_branch_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES predictive_scenarios(id) ON DELETE CASCADE,
  branch_name text NOT NULL,
  branch_probability numeric DEFAULT 0,
  branch_risk numeric DEFAULT 0,
  branch_summary text,
  expected_outcomes jsonb DEFAULT '[]'::jsonb,
  intervention_pathways jsonb DEFAULT '[]'::jsonb,
  estimated_time_to_realization_hours numeric,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_predictions_scenario
ON scenario_branch_predictions(scenario_id);

CREATE TABLE IF NOT EXISTS intervention_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_name text NOT NULL,
  intervention_type text NOT NULL,
  target_domains jsonb DEFAULT '[]'::jsonb,
  target_regions jsonb DEFAULT '[]'::jsonb,
  historical_effectiveness numeric DEFAULT 0,
  stabilization_gain numeric DEFAULT 0,
  escalation_reduction numeric DEFAULT 0,
  deployment_speed_hours numeric,
  operational_cost_score numeric DEFAULT 0,
  geopolitical_complexity_score numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_predictive_scenarios(
  p_forecast_window_hours integer DEFAULT 72
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_created integer := 0;
BEGIN

  INSERT INTO predictive_scenarios (
    scenario_name,
    scenario_type,
    originating_event_id,
    originating_cascade_id,
    forecast_window_hours,
    probability_score,
    severity_score,
    civilization_instability_score,
    escalation_risk_score,
    intervention_effectiveness_score,
    stabilization_probability,
    projected_domains,
    projected_regions,
    projected_secondary_effects,
    projected_economic_effects,
    projected_geopolitical_effects,
    projected_humanitarian_effects,
    simulation_reasoning,
    recommended_interventions,
    expires_at
  )
  SELECT
    CONCAT(
      'Scenario Forecast — ',
      cce.cascade_name
    ),
    CASE
      WHEN cce.cascade_severity >= 80 THEN 'planetary-escalation'
      WHEN cce.cascade_severity >= 60 THEN 'systemic-risk'
      ELSE 'localized-instability'
    END,
    cce.originating_signal_id,
    cce.id,
    p_forecast_window_hours,
    LEAST(100,
      ROUND(
        (
          cce.propagation_probability * 0.40 +
          cce.systemic_impact_score * 0.35 +
          cce.cascade_severity * 0.25
        )::numeric
      ,2)
    ),
    cce.cascade_severity,
    LEAST(100,
      ROUND(
        (
          cce.systemic_impact_score * 0.50 +
          cce.propagation_probability * 0.30 +
          (100 - cce.stabilization_probability) * 0.20
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          cce.propagation_probability * 0.60 +
          cce.cascade_severity * 0.40
        )::numeric
      ,2)
    ),
    GREATEST(5,
      ROUND(
        (100 - cce.cascade_severity * 0.7)::numeric
      ,2)
    ),
    cce.stabilization_probability,
    cce.affected_domains,
    cce.affected_regions,
    CASE
      WHEN cce.cascade_severity >= 75 THEN
        jsonb_build_array(
          'cross-border supply chain disruption',
          'elevated geopolitical volatility',
          'financial instability propagation'
        )
      ELSE
        jsonb_build_array(
          'localized operational disruption',
          'regional narrative amplification'
        )
    END,
    CASE
      WHEN cce.cascade_type = 'multi-domain-systemic' THEN
        jsonb_build_array(
          'commodity price volatility',
          'energy market instability',
          'capital flow uncertainty'
        )
      ELSE
        jsonb_build_array(
          'sector-specific volatility'
        )
    END,
    CASE
      WHEN cce.cascade_severity >= 70 THEN
        jsonb_build_array(
          'regional alliance pressure',
          'diplomatic escalation risk',
          'cross-border policy responses'
        )
      ELSE
        jsonb_build_array(
          'localized diplomatic response'
        )
    END,
    CASE
      WHEN cce.cascade_severity >= 65 THEN
        jsonb_build_array(
          'migration pressure risk',
          'infrastructure stress',
          'resource allocation pressure'
        )
      ELSE
        jsonb_build_array(
          'localized humanitarian effects'
        )
    END,
    jsonb_build_array(
      CONCAT('Cascade severity=', cce.cascade_severity),
      CONCAT('Propagation probability=', cce.propagation_probability),
      CONCAT('Systemic impact=', cce.systemic_impact_score),
      CONCAT('Affected domains=', jsonb_array_length(cce.affected_domains))
    ),
    CASE
      WHEN cce.cascade_severity >= 80 THEN
        jsonb_build_array(
          'multilateral coordination',
          'rapid stabilization deployment',
          'cross-domain containment strategy'
        )
      WHEN cce.cascade_severity >= 60 THEN
        jsonb_build_array(
          'regional intervention coordination',
          'strategic de-escalation measures'
        )
      ELSE
        jsonb_build_array(
          'localized mitigation'
        )
    END,
    now() + make_interval(hours => p_forecast_window_hours)
  FROM civilization_cascade_events cce
  WHERE cce.created_at >= now() - interval '24 hours'
    AND cce.cascade_severity >= 45
    AND NOT EXISTS (
      SELECT 1
      FROM predictive_scenarios ps
      WHERE ps.originating_cascade_id = cce.id
    )
  LIMIT 100;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  INSERT INTO scenario_branch_predictions (
    scenario_id,
    branch_name,
    branch_probability,
    branch_risk,
    branch_summary,
    expected_outcomes,
    intervention_pathways,
    estimated_time_to_realization_hours
  )
  SELECT
    ps.id,
    branch.branch_name,
    branch.branch_probability,
    branch.branch_risk,
    branch.branch_summary,
    branch.expected_outcomes,
    branch.intervention_pathways,
    branch.estimated_time
  FROM predictive_scenarios ps
  CROSS JOIN LATERAL (
    VALUES
    (
      'stabilization-path',
      GREATEST(10, ps.stabilization_probability),
      GREATEST(5, 100 - ps.stabilization_probability),
      'Containment and stabilization trajectory.',
      jsonb_build_array(
        'reduced escalation pressure',
        'improved systemic resilience'
      ),
      jsonb_build_array(
        'coordinated intervention',
        'rapid response mechanisms'
      ),
      ps.forecast_window_hours * 0.6
    ),
    (
      'controlled-escalation',
      LEAST(100, ps.escalation_risk_score * 0.7),
      ps.escalation_risk_score,
      'Escalation remains active but partially contained.',
      jsonb_build_array(
        'continued regional instability',
        'moderate systemic pressure'
      ),
      jsonb_build_array(
        'targeted diplomatic measures',
        'sector-specific mitigation'
      ),
      ps.forecast_window_hours * 0.8
    ),
    (
      'systemic-cascade',
      LEAST(100, ps.civilization_instability_score * 0.8),
      LEAST(100, ps.severity_score + 15),
      'Cross-domain instability propagation scenario.',
      jsonb_build_array(
        'multi-domain disruption',
        'global stress amplification',
        'supply chain destabilization'
      ),
      jsonb_build_array(
        'global coordination response',
        'emergency stabilization frameworks'
      ),
      ps.forecast_window_hours
    )
  ) AS branch(
    branch_name,
    branch_probability,
    branch_risk,
    branch_summary,
    expected_outcomes,
    intervention_pathways,
    estimated_time
  )
  WHERE ps.generated_at >= now() - interval '5 minutes';

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'predictive-scenario-simulation-engine',
    'success',
    'scenarios_created=' || v_created
  );

  RETURN jsonb_build_object(
    'status','success',
    'scenarios_created',v_created,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE VIEW planetary_forecast_command_view AS
SELECT
  ps.scenario_name,
  ps.scenario_type,
  ps.probability_score,
  ps.severity_score,
  ps.civilization_instability_score,
  ps.escalation_risk_score,
  ps.stabilization_probability,
  ps.projected_domains,
  ps.projected_regions,
  ps.recommended_interventions,
  ps.generated_at,
  CASE
    WHEN ps.civilization_instability_score >= 85 THEN 'planetary-critical'
    WHEN ps.civilization_instability_score >= 70 THEN 'systemic-instability'
    WHEN ps.civilization_instability_score >= 50 THEN 'strategic-watch'
    ELSE 'monitoring'
  END AS forecast_priority
FROM predictive_scenarios ps
WHERE ps.scenario_status = 'active'
ORDER BY ps.civilization_instability_score DESC,
         ps.probability_score DESC;

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'predictive-simulation-bootstrap',
  'success',
  'predictive simulation infrastructure initialized'
);
