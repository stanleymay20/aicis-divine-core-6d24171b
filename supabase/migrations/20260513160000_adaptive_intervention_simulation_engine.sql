-- Adaptive Intervention Simulation Engine
-- Enables AICIS to evaluate mitigation options, coordination strategies,
-- downstream consequences, and operational response effectiveness.

-- =====================================================
-- 1. Intervention strategy registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intervention_strategy_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_key text UNIQUE NOT NULL,
  strategy_name text NOT NULL,
  strategy_domain text NOT NULL,
  intervention_type text DEFAULT 'mitigation',
  target_system_domain text,
  operational_cost_score numeric DEFAULT 50,
  estimated_effectiveness numeric DEFAULT 50,
  deployment_complexity numeric DEFAULT 50,
  deployment_latency_hours numeric DEFAULT 24,
  geopolitical_sensitivity numeric DEFAULT 50,
  coordination_requirements jsonb DEFAULT '[]'::jsonb,
  recommended_conditions jsonb DEFAULT '[]'::jsonb,
  contraindications jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intervention_strategy_domain
ON public.intervention_strategy_registry(strategy_domain, active);

-- =====================================================
-- 2. Intervention simulations
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intervention_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_key text UNIQUE NOT NULL,
  source_propagation_event_id uuid,
  strategy_key text,
  simulation_name text,
  simulation_status text DEFAULT 'completed',
  baseline_risk_score numeric DEFAULT 0,
  projected_risk_after_intervention numeric DEFAULT 0,
  risk_reduction_score numeric DEFAULT 0,
  projected_operational_stability numeric DEFAULT 0,
  projected_economic_impact numeric DEFAULT 0,
  projected_humanitarian_impact numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  intervention_cost_score numeric DEFAULT 0,
  execution_feasibility numeric DEFAULT 0,
  geopolitical_risk numeric DEFAULT 0,
  simulation_summary text,
  simulation_path jsonb DEFAULT '[]'::jsonb,
  intervention_recommendations jsonb DEFAULT '[]'::jsonb,
  outcome_projection jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intervention_simulations_event
ON public.intervention_simulations(source_propagation_event_id, risk_reduction_score DESC);

-- =====================================================
-- 3. Coordination response plans
-- =====================================================
CREATE TABLE IF NOT EXISTS public.coordination_response_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_plan_key text UNIQUE NOT NULL,
  linked_simulation_id uuid,
  plan_name text NOT NULL,
  coordination_scope text DEFAULT 'regional',
  operational_priority text DEFAULT 'high',
  response_status text DEFAULT 'draft',
  recommended_actors jsonb DEFAULT '[]'::jsonb,
  operational_steps jsonb DEFAULT '[]'::jsonb,
  escalation_path jsonb DEFAULT '[]'::jsonb,
  estimated_execution_time_hours numeric DEFAULT 24,
  projected_success_probability numeric DEFAULT 0,
  monitoring_requirements jsonb DEFAULT '[]'::jsonb,
  verification_metrics jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coordination_response_status
ON public.coordination_response_plans(response_status, operational_priority);

-- =====================================================
-- 4. Outcome learning ledger
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intervention_outcome_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_key text UNIQUE NOT NULL,
  simulation_id uuid,
  response_plan_id uuid,
  observed_outcome text,
  actual_risk_reduction numeric DEFAULT 0,
  actual_operational_stability numeric DEFAULT 0,
  actual_humanitarian_impact numeric DEFAULT 0,
  actual_economic_impact numeric DEFAULT 0,
  outcome_accuracy_score numeric DEFAULT 0,
  lessons_learned jsonb DEFAULT '[]'::jsonb,
  adaptation_recommendations jsonb DEFAULT '[]'::jsonb,
  recorded_at timestamptz DEFAULT now()
);

-- =====================================================
-- 5. Seed intervention strategies
-- =====================================================
INSERT INTO public.intervention_strategy_registry(
  strategy_key,strategy_name,strategy_domain,intervention_type,target_system_domain,
  operational_cost_score,estimated_effectiveness,deployment_complexity,
  deployment_latency_hours,geopolitical_sensitivity,coordination_requirements,recommended_conditions
)
VALUES
(
  'food-relief-coordination',
  'Food Relief Coordination',
  'humanitarian',
  'mitigation',
  'food',
  70,85,65,48,40,
  jsonb_build_array('NGOs','regional governments','logistics operators'),
  jsonb_build_array('food instability','migration pressure','humanitarian crisis')
),
(
  'energy-grid-stabilization',
  'Energy Grid Stabilization',
  'energy',
  'stabilization',
  'energy',
  80,78,75,24,55,
  jsonb_build_array('energy operators','regional governments','infrastructure coordinators'),
  jsonb_build_array('grid instability','power shortages','energy price shock')
),
(
  'shipping-route-rerouting',
  'Shipping Route Rerouting',
  'logistics',
  'adaptation',
  'logistics',
  60,72,58,12,35,
  jsonb_build_array('shipping operators','ports','trade coordinators'),
  jsonb_build_array('maritime chokepoint','port disruption','trade instability')
),
(
  'climate-disaster-predeployment',
  'Climate Disaster Predeployment',
  'climate',
  'prevention',
  'climate',
  75,88,72,36,45,
  jsonb_build_array('emergency agencies','regional governments','NGOs'),
  jsonb_build_array('extreme weather','flood risk','wildfire escalation')
)
ON CONFLICT(strategy_key) DO UPDATE SET
  estimated_effectiveness = EXCLUDED.estimated_effectiveness,
  updated_at = now();

-- =====================================================
-- 6. Simulation generator
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_intervention_simulation(
  p_propagation_event_id uuid,
  p_strategy_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_strategy record;
  v_sim_key text;
  v_baseline numeric;
  v_post numeric;
  v_reduction numeric;
  v_feasibility numeric;
  v_confidence numeric;
BEGIN
  SELECT * INTO v_event
  FROM public.planetary_propagation_events
  WHERE id = p_propagation_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_propagation_event');
  END IF;

  SELECT * INTO v_strategy
  FROM public.intervention_strategy_registry
  WHERE strategy_key = p_strategy_key
    AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_strategy');
  END IF;

  v_baseline := COALESCE(v_event.impact_severity,50);

  v_reduction := ROUND(
    (v_baseline * (COALESCE(v_strategy.estimated_effectiveness,50)/100.0) * 0.65)::numeric,
    2
  );

  v_post := GREATEST(0, ROUND((v_baseline - v_reduction)::numeric,2));

  v_feasibility := GREATEST(0, LEAST(100,
    100 - (COALESCE(v_strategy.deployment_complexity,50) * 0.4)
        - (COALESCE(v_strategy.geopolitical_sensitivity,50) * 0.2)
  ));

  v_confidence := ROUND(
    ((COALESCE(v_event.evidence_score,50) * 0.45)
    + (COALESCE(v_strategy.estimated_effectiveness,50) * 0.35)
    + (v_feasibility * 0.2))::numeric,
    2
  );

  v_sim_key := md5(p_propagation_event_id::text || '|' || p_strategy_key);

  INSERT INTO public.intervention_simulations(
    simulation_key,
    source_propagation_event_id,
    strategy_key,
    simulation_name,
    simulation_status,
    baseline_risk_score,
    projected_risk_after_intervention,
    risk_reduction_score,
    projected_operational_stability,
    projected_economic_impact,
    projected_humanitarian_impact,
    confidence_score,
    intervention_cost_score,
    execution_feasibility,
    geopolitical_risk,
    simulation_summary,
    simulation_path,
    intervention_recommendations,
    outcome_projection,
    created_at,
    updated_at
  ) VALUES (
    v_sim_key,
    p_propagation_event_id,
    p_strategy_key,
    v_strategy.strategy_name || ' Simulation',
    'completed',
    v_baseline,
    v_post,
    v_reduction,
    ROUND((50 + v_reduction * 0.6)::numeric,2),
    ROUND((100 - COALESCE(v_strategy.operational_cost_score,50))::numeric,2),
    ROUND((50 + v_reduction * 0.7)::numeric,2),
    v_confidence,
    COALESCE(v_strategy.operational_cost_score,50),
    v_feasibility,
    COALESCE(v_strategy.geopolitical_sensitivity,50),
    'Projected mitigation impact generated from planetary propagation analysis.',
    jsonb_build_array(
      jsonb_build_object(
        'source_event',v_event.source_event,
        'strategy',v_strategy.strategy_name,
        'projected_reduction',v_reduction
      )
    ),
    jsonb_build_array(
      'Increase regional monitoring',
      'Coordinate operational stakeholders',
      'Escalate if propagation accelerates'
    ),
    jsonb_build_object(
      'projected_risk_after_intervention',v_post,
      'confidence',v_confidence,
      'execution_feasibility',v_feasibility
    ),
    now(),
    now()
  )
  ON CONFLICT(simulation_key) DO UPDATE SET
    projected_risk_after_intervention = EXCLUDED.projected_risk_after_intervention,
    risk_reduction_score = EXCLUDED.risk_reduction_score,
    confidence_score = EXCLUDED.confidence_score,
    execution_feasibility = EXCLUDED.execution_feasibility,
    updated_at = now();

  RETURN jsonb_build_object(
    'status','success',
    'simulation_key',v_sim_key,
    'baseline_risk',v_baseline,
    'projected_risk_after_intervention',v_post,
    'risk_reduction_score',v_reduction,
    'confidence_score',v_confidence
  );
END;
$$;

-- =====================================================
-- 7. Automatic coordination response generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_coordination_response_plan(
  p_simulation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sim record;
  strat record;
  v_key text;
BEGIN
  SELECT * INTO sim
  FROM public.intervention_simulations
  WHERE id = p_simulation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_simulation');
  END IF;

  SELECT * INTO strat
  FROM public.intervention_strategy_registry
  WHERE strategy_key = sim.strategy_key;

  v_key := md5(p_simulation_id::text || '|response_plan');

  INSERT INTO public.coordination_response_plans(
    response_plan_key,
    linked_simulation_id,
    plan_name,
    coordination_scope,
    operational_priority,
    response_status,
    recommended_actors,
    operational_steps,
    escalation_path,
    estimated_execution_time_hours,
    projected_success_probability,
    monitoring_requirements,
    verification_metrics,
    created_at,
    updated_at
  ) VALUES (
    v_key,
    p_simulation_id,
    strat.strategy_name || ' Response Coordination Plan',
    'international',
    CASE WHEN sim.risk_reduction_score >= 40 THEN 'critical' ELSE 'high' END,
    'generated',
    COALESCE(strat.coordination_requirements,'[]'::jsonb),
    jsonb_build_array(
      'Validate telemetry and propagation path',
      'Notify regional coordination actors',
      'Deploy mitigation logistics',
      'Monitor intervention effectiveness'
    ),
    jsonb_build_array(
      'regional escalation',
      'international escalation',
      'executive crisis coordination'
    ),
    COALESCE(strat.deployment_latency_hours,24),
    sim.confidence_score,
    jsonb_build_array(
      'telemetry continuity',
      'risk reduction verification',
      'coordination latency monitoring'
    ),
    jsonb_build_array(
      'risk reduction delta',
      'humanitarian stabilization',
      'operational continuity'
    ),
    now(),
    now()
  )
  ON CONFLICT(response_plan_key) DO UPDATE SET
    projected_success_probability = EXCLUDED.projected_success_probability,
    response_status = 'generated',
    updated_at = now();

  RETURN jsonb_build_object('status','success','response_plan_key',v_key);
END;
$$;

-- =====================================================
-- 8. Outcome learning engine
-- =====================================================
CREATE OR REPLACE FUNCTION public.record_intervention_outcome(
  p_simulation_id uuid,
  p_response_plan_id uuid,
  p_observed_outcome text,
  p_actual_risk_reduction numeric DEFAULT 0,
  p_actual_operational_stability numeric DEFAULT 0,
  p_actual_humanitarian_impact numeric DEFAULT 0,
  p_actual_economic_impact numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sim record;
  v_accuracy numeric;
  v_key text;
BEGIN
  SELECT * INTO sim
  FROM public.intervention_simulations
  WHERE id = p_simulation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_simulation');
  END IF;

  v_accuracy := GREATEST(0, LEAST(100,
    100 - ABS(COALESCE(sim.risk_reduction_score,0) - p_actual_risk_reduction)
  ));

  v_key := md5(p_simulation_id::text || '|' || now()::text);

  INSERT INTO public.intervention_outcome_ledger(
    outcome_key,
    simulation_id,
    response_plan_id,
    observed_outcome,
    actual_risk_reduction,
    actual_operational_stability,
    actual_humanitarian_impact,
    actual_economic_impact,
    outcome_accuracy_score,
    lessons_learned,
    adaptation_recommendations,
    recorded_at
  ) VALUES (
    v_key,
    p_simulation_id,
    p_response_plan_id,
    p_observed_outcome,
    p_actual_risk_reduction,
    p_actual_operational_stability,
    p_actual_humanitarian_impact,
    p_actual_economic_impact,
    v_accuracy,
    jsonb_build_array(
      'compare projected vs actual outcome',
      'evaluate coordination latency',
      'improve propagation assumptions'
    ),
    jsonb_build_array(
      'refine intervention weighting',
      'adjust geopolitical sensitivity scoring',
      'improve simulation confidence calibration'
    ),
    now()
  );

  RETURN jsonb_build_object('status','success','outcome_accuracy_score',v_accuracy);
END;
$$;

-- =====================================================
-- 9. Command views
-- =====================================================
CREATE OR REPLACE VIEW public.intervention_simulation_command_view AS
SELECT
  s.simulation_name,
  s.strategy_key,
  p.source_event,
  p.source_domain,
  s.baseline_risk_score,
  s.projected_risk_after_intervention,
  s.risk_reduction_score,
  s.confidence_score,
  s.execution_feasibility,
  s.geopolitical_risk,
  s.created_at
FROM public.intervention_simulations s
LEFT JOIN public.planetary_propagation_events p
  ON p.id = s.source_propagation_event_id
ORDER BY s.risk_reduction_score DESC, s.confidence_score DESC;

CREATE OR REPLACE VIEW public.coordination_response_command_view AS
SELECT
  plan_name,
  coordination_scope,
  operational_priority,
  response_status,
  projected_success_probability,
  estimated_execution_time_hours,
  created_at
FROM public.coordination_response_plans
ORDER BY projected_success_probability DESC, created_at DESC;

CREATE OR REPLACE VIEW public.intervention_learning_command_view AS
SELECT
  observed_outcome,
  actual_risk_reduction,
  outcome_accuracy_score,
  recorded_at
FROM public.intervention_outcome_ledger
ORDER BY outcome_accuracy_score DESC, recorded_at DESC;

-- =====================================================
-- 10. Autonomous simulation orchestrator
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_autonomous_intervention_simulation_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  strat record;
  v_simulations integer := 0;
BEGIN
  FOR rec IN
    SELECT *
    FROM public.planetary_propagation_events
    WHERE generated_at >= now() - interval '24 hours'
      AND impact_severity >= 60
    ORDER BY impact_severity DESC
    LIMIT 25
  LOOP
    FOR strat IN
      SELECT *
      FROM public.intervention_strategy_registry
      WHERE active = true
        AND (
          target_system_domain IS NULL
          OR target_system_domain = rec.source_domain
          OR target_system_domain = rec.impact_type
        )
    LOOP
      PERFORM public.generate_intervention_simulation(rec.id, strat.strategy_key);
      v_simulations := v_simulations + 1;
    END LOOP;
  END LOOP;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'autonomous-intervention-simulation-cycle',
    'success',
    'simulations_generated=' || v_simulations
  );

  RETURN jsonb_build_object('status','success','simulations_generated',v_simulations);
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'adaptive-intervention-simulation-engine',
  'success',
  'intervention strategies, response coordination, simulation generation, and outcome learning initialized'
);
