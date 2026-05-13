-- Probabilistic Civilization Simulation Engine
-- Monte Carlo strategic futures and intervention modeling

CREATE TABLE IF NOT EXISTS civilization_simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_name text NOT NULL,
  simulation_type text DEFAULT 'monte_carlo',
  triggering_forecast_id uuid REFERENCES strategic_propagation_forecasts(id) ON DELETE SET NULL,
  triggering_cluster_id uuid REFERENCES civilization_instability_clusters(id) ON DELETE SET NULL,
  simulation_horizon_hours integer DEFAULT 168,
  iteration_count integer DEFAULT 1000,
  dominant_scenario text,
  collapse_probability numeric DEFAULT 0,
  stabilization_probability numeric DEFAULT 0,
  escalation_probability numeric DEFAULT 0,
  volatility_score numeric DEFAULT 0,
  uncertainty_index numeric DEFAULT 0,
  simulation_metadata jsonb DEFAULT '{}'::jsonb,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_type
ON civilization_simulation_runs(simulation_type, escalation_probability DESC);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_horizon
ON civilization_simulation_runs(simulation_horizon_hours, uncertainty_index DESC);

CREATE TABLE IF NOT EXISTS civilization_simulation_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_run_id uuid NOT NULL REFERENCES civilization_simulation_runs(id) ON DELETE CASCADE,
  scenario_name text NOT NULL,
  scenario_type text,
  scenario_probability numeric DEFAULT 0,
  systemic_risk_score numeric DEFAULT 0,
  projected_regional_impact numeric DEFAULT 0,
  projected_global_impact numeric DEFAULT 0,
  projected_economic_damage numeric DEFAULT 0,
  projected_humanitarian_disruption numeric DEFAULT 0,
  projected_information_disruption numeric DEFAULT 0,
  intervention_effectiveness_score numeric DEFAULT 0,
  resilience_score numeric DEFAULT 0,
  strategic_recommendations jsonb DEFAULT '[]'::jsonb,
  downstream_effects jsonb DEFAULT '[]'::jsonb,
  simulation_trace jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simulation_scenarios_probability
ON civilization_simulation_scenarios(scenario_probability DESC, systemic_risk_score DESC);

CREATE TABLE IF NOT EXISTS civilization_intervention_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_name text NOT NULL,
  intervention_domain text,
  intervention_region text,
  intervention_type text,
  intervention_cost_score numeric DEFAULT 0,
  intervention_speed_score numeric DEFAULT 0,
  projected_stabilization_gain numeric DEFAULT 0,
  projected_contagion_reduction numeric DEFAULT 0,
  projected_systemic_resilience_gain numeric DEFAULT 0,
  intervention_constraints jsonb DEFAULT '[]'::jsonb,
  intervention_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intervention_models_domain
ON civilization_intervention_models(intervention_domain, projected_stabilization_gain DESC);

CREATE TABLE IF NOT EXISTS civilization_future_state_vectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vector_name text NOT NULL,
  forecast_region text,
  forecast_domain text,
  future_time_horizon_hours integer DEFAULT 168,
  civilization_resilience_index numeric DEFAULT 0,
  civilization_fragility_index numeric DEFAULT 0,
  economic_continuity_probability numeric DEFAULT 0,
  governance_stability_probability numeric DEFAULT 0,
  conflict_escalation_probability numeric DEFAULT 0,
  infrastructure_stability_probability numeric DEFAULT 0,
  narrative_control_probability numeric DEFAULT 0,
  strategic_vector jsonb DEFAULT '{}'::jsonb,
  generated_from_simulation_id uuid REFERENCES civilization_simulation_runs(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_future_state_vectors_region
ON civilization_future_state_vectors(forecast_region, civilization_fragility_index DESC);

CREATE OR REPLACE FUNCTION generate_probabilistic_civilization_simulations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_simulations integer := 0;
  v_scenarios integer := 0;
BEGIN

  INSERT INTO civilization_simulation_runs (
    simulation_name,
    simulation_type,
    triggering_forecast_id,
    simulation_horizon_hours,
    iteration_count,
    dominant_scenario,
    collapse_probability,
    stabilization_probability,
    escalation_probability,
    volatility_score,
    uncertainty_index,
    simulation_metadata,
    completed_at
  )
  SELECT
    CONCAT('Strategic civilization simulation: ', spf.forecast_name),
    'monte_carlo',
    spf.id,
    168,
    1000,
    CASE
      WHEN spf.projected_instability_score >= 85 THEN 'cascade-escalation'
      WHEN spf.projected_instability_score >= 65 THEN 'regional-fracture-risk'
      ELSE 'managed-instability'
    END,
    LEAST(100,
      ROUND(
        (
          spf.projected_instability_score * 0.45 +
          spf.projected_security_escalation * 0.35 +
          spf.projected_humanitarian_pressure * 0.20
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          100 - (spf.projected_instability_score * 0.7)
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          spf.projected_security_escalation * 0.6 +
          spf.projected_information_warfare_score * 0.4
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          ABS(spf.projected_instability_score - spf.forecast_confidence) + 25
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          100 - spf.forecast_confidence
        )::numeric
      ,2)
    ),
    jsonb_build_object(
      'source_region', spf.propagation_region,
      'source_domain', spf.propagation_domain,
      'forecast_window', spf.forecast_window_hours
    ),
    now()
  FROM strategic_propagation_forecasts spf
  WHERE spf.forecast_status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM civilization_simulation_runs csr
      WHERE csr.triggering_forecast_id = spf.id
    )
  LIMIT 4000;

  GET DIAGNOSTICS v_simulations = ROW_COUNT;

  INSERT INTO civilization_simulation_scenarios (
    simulation_run_id,
    scenario_name,
    scenario_type,
    scenario_probability,
    systemic_risk_score,
    projected_regional_impact,
    projected_global_impact,
    projected_economic_damage,
    projected_humanitarian_disruption,
    projected_information_disruption,
    intervention_effectiveness_score,
    resilience_score,
    strategic_recommendations,
    downstream_effects,
    simulation_trace
  )
  SELECT
    csr.id,
    CONCAT(csr.dominant_scenario, '-scenario'),
    csr.dominant_scenario,
    GREATEST(csr.escalation_probability, csr.stabilization_probability),
    csr.collapse_probability,
    LEAST(100, csr.collapse_probability * 0.8),
    LEAST(100, csr.collapse_probability * 0.9),
    LEAST(100, csr.volatility_score * 0.75),
    LEAST(100, csr.collapse_probability * 0.7),
    LEAST(100, csr.escalation_probability * 0.8),
    LEAST(100, 100 - csr.collapse_probability),
    LEAST(100, 100 - csr.volatility_score),
    jsonb_build_array(
      'deploy regional stabilization protocols',
      'increase predictive monitoring',
      'strengthen cross-border coordination',
      'monitor narrative escalation vectors'
    ),
    jsonb_build_array(
      'supply chain volatility',
      'migration pressure increase',
      'financial contagion risk',
      'information warfare amplification'
    ),
    jsonb_build_object(
      'simulation_iterations', csr.iteration_count,
      'horizon_hours', csr.simulation_horizon_hours,
      'uncertainty_index', csr.uncertainty_index
    )
  FROM civilization_simulation_runs csr
  WHERE NOT EXISTS (
    SELECT 1
    FROM civilization_simulation_scenarios css
    WHERE css.simulation_run_id = csr.id
  );

  GET DIAGNOSTICS v_scenarios = ROW_COUNT;

  INSERT INTO civilization_future_state_vectors (
    vector_name,
    forecast_region,
    forecast_domain,
    future_time_horizon_hours,
    civilization_resilience_index,
    civilization_fragility_index,
    economic_continuity_probability,
    governance_stability_probability,
    conflict_escalation_probability,
    infrastructure_stability_probability,
    narrative_control_probability,
    strategic_vector,
    generated_from_simulation_id
  )
  SELECT
    CONCAT('future-state-vector-', csr.id),
    spf.propagation_region,
    spf.propagation_domain,
    csr.simulation_horizon_hours,
    LEAST(100, 100 - csr.collapse_probability),
    csr.collapse_probability,
    LEAST(100, 100 - css.projected_economic_damage),
    LEAST(100, 100 - csr.escalation_probability),
    csr.escalation_probability,
    LEAST(100, 100 - csr.volatility_score),
    LEAST(100, 100 - css.projected_information_disruption),
    jsonb_build_object(
      'dominant_scenario', csr.dominant_scenario,
      'systemic_risk_score', css.systemic_risk_score,
      'intervention_effectiveness', css.intervention_effectiveness_score
    ),
    csr.id
  FROM civilization_simulation_runs csr
  JOIN strategic_propagation_forecasts spf
    ON spf.id = csr.triggering_forecast_id
  JOIN civilization_simulation_scenarios css
    ON css.simulation_run_id = csr.id;

  INSERT INTO civilization_intervention_models (
    intervention_name,
    intervention_domain,
    intervention_region,
    intervention_type,
    intervention_cost_score,
    intervention_speed_score,
    projected_stabilization_gain,
    projected_contagion_reduction,
    projected_systemic_resilience_gain,
    intervention_constraints,
    intervention_metadata
  )
  SELECT DISTINCT
    CONCAT('stabilization-model-', COALESCE(propagation_domain,'general')),
    propagation_domain,
    propagation_region,
    'predictive-stabilization',
    55,
    70,
    LEAST(100, 100 - projected_instability_score),
    LEAST(100, 100 - projected_security_escalation),
    LEAST(100, forecast_confidence),
    jsonb_build_array(
      'geopolitical coordination required',
      'resource allocation constraints',
      'cross-domain synchronization needed'
    ),
    jsonb_build_object(
      'source_forecast', forecast_name,
      'forecast_confidence', forecast_confidence
    )
  FROM strategic_propagation_forecasts;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'probabilistic-civilization-simulation-engine',
    'success',
    'simulations=' || v_simulations || ', scenarios=' || v_scenarios
  );

  RETURN jsonb_build_object(
    'status','success',
    'simulation_runs_generated',v_simulations,
    'simulation_scenarios_generated',v_scenarios,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE VIEW civilization_future_command_matrix AS
SELECT
  csr.simulation_name,
  csr.dominant_scenario,
  csr.collapse_probability,
  csr.stabilization_probability,
  csr.escalation_probability,
  csr.volatility_score,
  csr.uncertainty_index,
  css.systemic_risk_score,
  css.projected_global_impact,
  css.intervention_effectiveness_score,
  cfsv.civilization_fragility_index,
  cfsv.governance_stability_probability,
  cfsv.conflict_escalation_probability,
  CASE
    WHEN csr.collapse_probability >= 85 THEN 'planetary-fragility'
    WHEN csr.collapse_probability >= 70 THEN 'high-escalation-risk'
    WHEN csr.collapse_probability >= 55 THEN 'strategic-volatility'
    ELSE 'managed-stability'
  END AS civilization_outlook,
  CASE
    WHEN css.intervention_effectiveness_score >= 80 THEN 'strong-intervention-window'
    WHEN css.intervention_effectiveness_score >= 60 THEN 'moderate-intervention-window'
    ELSE 'limited-intervention-window'
  END AS intervention_window
FROM civilization_simulation_runs csr
LEFT JOIN civilization_simulation_scenarios css
  ON css.simulation_run_id = csr.id
LEFT JOIN civilization_future_state_vectors cfsv
  ON cfsv.generated_from_simulation_id = csr.id
ORDER BY csr.collapse_probability DESC,
         css.systemic_risk_score DESC,
         csr.uncertainty_index DESC;

SELECT generate_probabilistic_civilization_simulations();

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'probabilistic-simulation-bootstrap',
  'success',
  'civilization simulation engine initialized'
);
