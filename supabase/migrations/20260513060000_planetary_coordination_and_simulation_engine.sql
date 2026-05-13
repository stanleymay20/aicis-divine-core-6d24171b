-- Planetary Coordination + Simulation Intelligence Engine
-- Advances AICIS toward governmental-grade coordination and adaptive simulation.

-- =====================================================
-- 1. Sovereign deployment registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.sovereign_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_key text UNIQUE NOT NULL,
  sovereign_entity text NOT NULL,
  deployment_type text DEFAULT 'national-node',
  hosting_region text,
  data_sovereignty_policy text,
  classification_level text DEFAULT 'restricted',
  operational_status text DEFAULT 'active',
  connected_nodes jsonb DEFAULT '[]'::jsonb,
  trust_framework jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 2. Strategic digital twin registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.strategic_digital_twins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twin_key text UNIQUE NOT NULL,
  twin_name text,
  twin_scope text,
  twin_region text,
  infrastructure_state jsonb DEFAULT '{}'::jsonb,
  population_state jsonb DEFAULT '{}'::jsonb,
  economic_state jsonb DEFAULT '{}'::jsonb,
  climate_state jsonb DEFAULT '{}'::jsonb,
  geopolitical_state jsonb DEFAULT '{}'::jsonb,
  resilience_index numeric DEFAULT 0,
  fragility_index numeric DEFAULT 0,
  forecast_instability_index numeric DEFAULT 0,
  updated_from_signals_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digital_twin_fragility
ON public.strategic_digital_twins(fragility_index DESC, forecast_instability_index DESC);

-- =====================================================
-- 3. Multi-agent simulation system
-- =====================================================
CREATE TABLE IF NOT EXISTS public.multi_agent_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_key text UNIQUE NOT NULL,
  simulation_title text,
  participating_agents jsonb DEFAULT '[]'::jsonb,
  simulation_environment jsonb DEFAULT '{}'::jsonb,
  trigger_conditions jsonb DEFAULT '[]'::jsonb,
  projected_agent_behaviors jsonb DEFAULT '[]'::jsonb,
  emergent_risk_score numeric DEFAULT 0,
  coordination_complexity numeric DEFAULT 0,
  stabilization_probability numeric DEFAULT 0,
  simulation_summary text,
  generated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 4. Strategic resource allocation
-- =====================================================
CREATE TABLE IF NOT EXISTS public.resource_allocation_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_key text UNIQUE NOT NULL,
  target_region text,
  resource_type text,
  urgency_band text DEFAULT 'monitor',
  projected_shortage_risk numeric DEFAULT 0,
  projected_population_impact numeric DEFAULT 0,
  recommended_allocation_level numeric DEFAULT 0,
  optimization_confidence numeric DEFAULT 0,
  linked_risk_assessment_id uuid REFERENCES public.operational_risk_assessments(id) ON DELETE SET NULL,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_allocation_urgency
ON public.resource_allocation_recommendations(urgency_band, projected_population_impact DESC);

-- =====================================================
-- 5. Global dependency graph
-- =====================================================
CREATE TABLE IF NOT EXISTS public.global_dependency_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dependency_key text UNIQUE NOT NULL,
  source_entity text,
  target_entity text,
  dependency_type text,
  dependency_strength numeric DEFAULT 0,
  disruption_risk numeric DEFAULT 0,
  cascade_probability numeric DEFAULT 0,
  strategic_importance numeric DEFAULT 0,
  evidence jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dependency_cascade
ON public.global_dependency_links(cascade_probability DESC, disruption_risk DESC);

-- =====================================================
-- 6. Autonomous coordination agents
-- =====================================================
CREATE TABLE IF NOT EXISTS public.coordination_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text UNIQUE NOT NULL,
  agent_name text,
  operational_domain text,
  assigned_regions jsonb DEFAULT '[]'::jsonb,
  decision_authority_band text DEFAULT 'advisory',
  strategic_focus jsonb DEFAULT '[]'::jsonb,
  current_state text DEFAULT 'active',
  coordination_metrics jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 7. Forecast validation truth layer
-- =====================================================
CREATE TABLE IF NOT EXISTS public.forecast_ground_truth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid REFERENCES public.predictive_forecasts(id) ON DELETE CASCADE,
  realized_outcome text,
  realized_impact numeric DEFAULT 0,
  realized_regions jsonb DEFAULT '[]'::jsonb,
  forecast_accuracy numeric DEFAULT 0,
  calibration_delta numeric DEFAULT 0,
  validation_summary text,
  validated_at timestamptz DEFAULT now(),
  UNIQUE(forecast_id)
);

CREATE INDEX IF NOT EXISTS idx_forecast_truth_accuracy
ON public.forecast_ground_truth(forecast_accuracy DESC, calibration_delta ASC);

-- =====================================================
-- 8. Reinforcement learning memory
-- =====================================================
CREATE TABLE IF NOT EXISTS public.reinforcement_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_key text UNIQUE NOT NULL,
  source_domain text,
  triggering_pattern text,
  successful_response_pattern text,
  failed_response_pattern text,
  reinforcement_score numeric DEFAULT 0,
  adaptation_priority numeric DEFAULT 0,
  learning_summary text,
  created_at timestamptz DEFAULT now()
);

-- =====================================================
-- 9. Strategic simulation functions
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_strategic_digital_twins(
  p_window interval DEFAULT interval '14 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_twins integer := 0;
BEGIN
  INSERT INTO public.strategic_digital_twins (
    twin_key,
    twin_name,
    twin_scope,
    twin_region,
    infrastructure_state,
    population_state,
    economic_state,
    climate_state,
    geopolitical_state,
    resilience_index,
    fragility_index,
    forecast_instability_index,
    updated_from_signals_at,
    created_at,
    updated_at
  )
  SELECT
    md5(COALESCE(c,'GLOBAL')),
    CONCAT(COALESCE(c,'GLOBAL'),' strategic twin'),
    'regional-operational-model',
    COALESCE(c,'GLOBAL'),
    jsonb_build_object(
      'avg_infrastructure_risk', ROUND(AVG(COALESCE(gs.impact_score,0))::numeric,2),
      'signal_count', COUNT(*)
    ),
    jsonb_build_object(
      'migration_pressure', ROUND(AVG(CASE WHEN gs.category = 'migration' THEN COALESCE(gs.impact_score,0) ELSE 0 END)::numeric,2),
      'health_pressure', ROUND(AVG(CASE WHEN gs.category = 'health' THEN COALESCE(gs.impact_score,0) ELSE 0 END)::numeric,2)
    ),
    jsonb_build_object(
      'economic_instability', ROUND(AVG(CASE WHEN gs.category IN ('economy','energy','supply-chain') THEN COALESCE(gs.predictive_priority,0) ELSE 0 END)::numeric,2)
    ),
    jsonb_build_object(
      'climate_stress', ROUND(AVG(CASE WHEN gs.category IN ('climate','environment','weather') THEN COALESCE(gs.impact_score,0) ELSE 0 END)::numeric,2)
    ),
    jsonb_build_object(
      'geopolitical_escalation', ROUND(AVG(CASE WHEN gs.category IN ('conflict','geopolitics') THEN COALESCE(gs.predictive_priority,0) ELSE 0 END)::numeric,2)
    ),
    GREATEST(0,100 - ROUND(AVG(COALESCE(gs.impact_score,0))::numeric,2)),
    ROUND(AVG(COALESCE(gs.impact_score,0))::numeric,2),
    ROUND((AVG(COALESCE(gs.predictive_priority,0)) + AVG(COALESCE(gs.anomaly_score,0))) / 2::numeric,2),
    now(),
    now(),
    now()
  FROM public.global_signals gs
  CROSS JOIN LATERAL unnest(COALESCE(gs.affected_countries, ARRAY['GLOBAL'])) c
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
  GROUP BY c
  ON CONFLICT(twin_key) DO UPDATE SET
    infrastructure_state = EXCLUDED.infrastructure_state,
    population_state = EXCLUDED.population_state,
    economic_state = EXCLUDED.economic_state,
    climate_state = EXCLUDED.climate_state,
    geopolitical_state = EXCLUDED.geopolitical_state,
    resilience_index = EXCLUDED.resilience_index,
    fragility_index = EXCLUDED.fragility_index,
    forecast_instability_index = EXCLUDED.forecast_instability_index,
    updated_from_signals_at = now(),
    updated_at = now();

  GET DIAGNOSTICS v_twins = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('strategic-digital-twins','success','twins=' || v_twins);

  RETURN jsonb_build_object('status','success','digital_twins',v_twins);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_resource_allocation_recommendations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.resource_allocation_recommendations (
    allocation_key,
    target_region,
    resource_type,
    urgency_band,
    projected_shortage_risk,
    projected_population_impact,
    recommended_allocation_level,
    optimization_confidence,
    linked_risk_assessment_id,
    generated_at
  )
  SELECT
    md5(ora.country_code || '|' || ora.sector),
    ora.country_code,
    CASE
      WHEN ora.humanitarian_risk >= 70 THEN 'humanitarian-aid'
      WHEN ora.infrastructure_risk >= 70 THEN 'infrastructure-support'
      WHEN ora.cyber_risk >= 70 THEN 'cyber-response'
      ELSE 'strategic-monitoring'
    END,
    CASE
      WHEN ora.aggregate_risk_index >= 85 THEN 'critical'
      WHEN ora.aggregate_risk_index >= 70 THEN 'strategic'
      ELSE 'monitor'
    END,
    ora.aggregate_risk_index,
    ROUND((ora.humanitarian_risk + ora.social_risk) / 2::numeric,2),
    ROUND((ora.aggregate_risk_index + ora.infrastructure_risk) / 2::numeric,2),
    ora.confidence_score,
    ora.id,
    now()
  FROM public.operational_risk_assessments ora
  ON CONFLICT(allocation_key) DO UPDATE SET
    projected_shortage_risk = EXCLUDED.projected_shortage_risk,
    projected_population_impact = EXCLUDED.projected_population_impact,
    recommended_allocation_level = EXCLUDED.recommended_allocation_level,
    optimization_confidence = EXCLUDED.optimization_confidence,
    generated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('resource-allocation-engine','success','allocations=' || v_rows);

  RETURN jsonb_build_object('status','success','allocations',v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_multi_agent_simulations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.multi_agent_simulations (
    simulation_key,
    simulation_title,
    participating_agents,
    simulation_environment,
    trigger_conditions,
    projected_agent_behaviors,
    emergent_risk_score,
    coordination_complexity,
    stabilization_probability,
    simulation_summary,
    generated_at
  )
  SELECT
    md5(sd.twin_region || '|multi-agent'),
    CONCAT(sd.twin_region,' multi-agent strategic simulation'),
    jsonb_build_array(
      'government',
      'humanitarian',
      'population',
      'economic',
      'infrastructure'
    ),
    jsonb_build_object(
      'fragility_index',sd.fragility_index,
      'instability_index',sd.forecast_instability_index
    ),
    jsonb_build_array(
      'resource_shortage',
      'migration_pressure',
      'geopolitical_escalation'
    ),
    jsonb_build_array(
      'border_reinforcement',
      'aid_coordination',
      'infrastructure_stabilization'
    ),
    ROUND((sd.fragility_index + sd.forecast_instability_index) / 2::numeric,2),
    ROUND((sd.fragility_index + 35)::numeric,2),
    GREATEST(0,100 - sd.fragility_index),
    CONCAT('Strategic simulation generated for ',sd.twin_region,' operational environment.'),
    now()
  FROM public.strategic_digital_twins sd
  ON CONFLICT(simulation_key) DO UPDATE SET
    emergent_risk_score = EXCLUDED.emergent_risk_score,
    coordination_complexity = EXCLUDED.coordination_complexity,
    stabilization_probability = EXCLUDED.stabilization_probability,
    simulation_summary = EXCLUDED.simulation_summary,
    generated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('multi-agent-simulation','success','simulations=' || v_rows);

  RETURN jsonb_build_object('status','success','simulations',v_rows);
END;
$$;

CREATE OR REPLACE VIEW public.digital_twin_command_view AS
SELECT
  twin_region,
  resilience_index,
  fragility_index,
  forecast_instability_index,
  updated_at
FROM public.strategic_digital_twins
ORDER BY fragility_index DESC;

CREATE OR REPLACE VIEW public.resource_allocation_command_view AS
SELECT
  target_region,
  resource_type,
  urgency_band,
  projected_shortage_risk,
  projected_population_impact,
  recommended_allocation_level,
  optimization_confidence,
  generated_at
FROM public.resource_allocation_recommendations
ORDER BY projected_population_impact DESC;

CREATE OR REPLACE VIEW public.multi_agent_simulation_command_view AS
SELECT
  simulation_title,
  emergent_risk_score,
  coordination_complexity,
  stabilization_probability,
  generated_at
FROM public.multi_agent_simulations
ORDER BY emergent_risk_score DESC;

CREATE OR REPLACE FUNCTION public.run_planetary_coordination_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
BEGIN
  r1 := public.generate_operational_risk_assessments(interval '14 days');
  r2 := public.generate_strategic_digital_twins(interval '14 days');
  r3 := public.generate_multi_agent_simulations();

  PERFORM public.generate_resource_allocation_recommendations();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('planetary-coordination-cycle','success','coordination cycle completed');

  RETURN jsonb_build_object(
    'status','success',
    'risk_assessments',r1,
    'digital_twins',r2,
    'simulations',r3
  );
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'planetary-coordination-and-simulation-engine',
  'success',
  'digital twins, sovereign deployments, resource optimization, and multi-agent simulation initialized'
);
