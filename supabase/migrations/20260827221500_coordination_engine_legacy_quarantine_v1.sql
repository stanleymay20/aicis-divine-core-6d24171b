-- AICIS Coordination Engine Legacy Quarantine v1
--
-- Historical coordination outputs were deterministic templates/formulas over
-- ungoverned strategic-twin and operational-risk scores. Preserve them for audit,
-- but do not expose stabilization probability, optimization confidence, shortage
-- risk, or allocation levels as canonical intelligence.

ALTER TABLE public.resource_allocation_recommendations
  ALTER COLUMN urgency_band DROP DEFAULT,
  ALTER COLUMN projected_shortage_risk DROP DEFAULT,
  ALTER COLUMN projected_population_impact DROP DEFAULT,
  ALTER COLUMN recommended_allocation_level DROP DEFAULT,
  ALTER COLUMN optimization_confidence DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_outputs jsonb,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS allocation_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS recommendation_semantics text,
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'legacy';

UPDATE public.resource_allocation_recommendations
SET
  reported_legacy_outputs = COALESCE(
    reported_legacy_outputs,
    jsonb_build_object(
      'urgency_band', urgency_band,
      'projected_shortage_risk', projected_shortage_risk,
      'projected_population_impact', projected_population_impact,
      'recommended_allocation_level', recommended_allocation_level,
      'optimization_confidence', optimization_confidence,
      'resource_type', resource_type
    )
  ),
  urgency_band = NULL,
  projected_shortage_risk = NULL,
  projected_population_impact = NULL,
  recommended_allocation_level = NULL,
  optimization_confidence = NULL,
  evidence_status = 'legacy_unknown',
  allocation_semantics = COALESCE(allocation_semantics, 'withheld_legacy_arithmetic_allocation_formula_unvalidated'),
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_legacy_upstream_score_not_optimization_confidence'),
  recommendation_semantics = COALESCE(recommendation_semantics, 'withheld_legacy_threshold_template_not_evidence_derived_recommendation'),
  generation_status = 'quarantined_legacy';

ALTER TABLE public.multi_agent_simulations
  ALTER COLUMN emergent_risk_score DROP DEFAULT,
  ALTER COLUMN coordination_complexity DROP DEFAULT,
  ALTER COLUMN stabilization_probability DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_outputs jsonb,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS simulation_semantics text,
  ADD COLUMN IF NOT EXISTS risk_semantics text,
  ADD COLUMN IF NOT EXISTS complexity_semantics text,
  ADD COLUMN IF NOT EXISTS stabilization_semantics text,
  ADD COLUMN IF NOT EXISTS behavior_semantics text,
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'legacy';

UPDATE public.multi_agent_simulations
SET
  reported_legacy_outputs = COALESCE(
    reported_legacy_outputs,
    jsonb_build_object(
      'emergent_risk_score', emergent_risk_score,
      'coordination_complexity', coordination_complexity,
      'stabilization_probability', stabilization_probability,
      'projected_agent_behaviors', projected_agent_behaviors,
      'trigger_conditions', trigger_conditions
    )
  ),
  emergent_risk_score = NULL,
  coordination_complexity = NULL,
  stabilization_probability = NULL,
  projected_agent_behaviors = '[]'::jsonb,
  evidence_status = 'legacy_unknown',
  simulation_semantics = COALESCE(simulation_semantics, 'withheld_legacy_multi_agent_template_not_executed_agent_simulation'),
  risk_semantics = COALESCE(risk_semantics, 'withheld_legacy_average_of_unverified_twin_indices'),
  complexity_semantics = COALESCE(complexity_semantics, 'withheld_legacy_fragility_plus_constant_formula'),
  stabilization_semantics = COALESCE(stabilization_semantics, 'withheld_one_hundred_minus_fragility_not_probability'),
  behavior_semantics = COALESCE(behavior_semantics, 'withheld_static_behavior_template_not_agent_model_output'),
  generation_status = 'quarantined_legacy';

CREATE OR REPLACE VIEW public.resource_allocation_command_view AS
SELECT
  target_region,
  resource_type,
  urgency_band,
  projected_shortage_risk,
  projected_population_impact,
  recommended_allocation_level,
  optimization_confidence,
  evidence_status,
  allocation_semantics,
  confidence_semantics,
  recommendation_semantics,
  generation_status,
  generated_at
FROM public.resource_allocation_recommendations
ORDER BY generated_at DESC;

CREATE OR REPLACE VIEW public.multi_agent_simulation_command_view AS
SELECT
  simulation_title,
  emergent_risk_score,
  risk_semantics,
  coordination_complexity,
  complexity_semantics,
  stabilization_probability,
  stabilization_semantics,
  simulation_semantics,
  evidence_status,
  generation_status,
  generated_at
FROM public.multi_agent_simulations
ORDER BY generated_at DESC;

CREATE OR REPLACE VIEW public.digital_twin_command_view AS
SELECT
  twin_region,
  resilience_index,
  resilience_semantics,
  fragility_index,
  fragility_semantics,
  forecast_instability_index,
  instability_semantics,
  evidence_status,
  twin_semantics,
  generation_status,
  updated_at
FROM public.strategic_digital_twins
ORDER BY updated_at DESC;

CREATE OR REPLACE FUNCTION public.generate_resource_allocation_recommendations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'allocations',0,
    'reason','legacy_allocation_engine_depended_on_quarantined_operational_risk_scores_and_template_thresholds',
    'replacement_required',true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_multi_agent_simulations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'simulations',0,
    'reason','legacy_multi_agent_engine_was_static_arithmetic_and_behavior_templates_not_executed_agent_simulation',
    'replacement_required',true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_planetary_coordination_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'risk_assessments',jsonb_build_object('status','quarantined'),
    'digital_twins',jsonb_build_object('status','quarantined'),
    'simulations',jsonb_build_object('status','quarantined'),
    'allocations',jsonb_build_object('status','quarantined'),
    'reason','legacy_coordination_cycle_depended_on_ungoverned_composite_scores',
    'replacement_required',true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_resource_allocation_recommendations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_resource_allocation_recommendations()
  TO service_role;

REVOKE ALL ON FUNCTION public.generate_multi_agent_simulations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_multi_agent_simulations()
  TO service_role;

REVOKE ALL ON FUNCTION public.run_planetary_coordination_cycle()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_planetary_coordination_cycle()
  TO service_role;

COMMENT ON TABLE public.resource_allocation_recommendations IS
  'Historical allocation outputs retained for audit. Canonical allocation/risk/confidence fields are withheld until a governed optimization model and evidence contract exist.';
COMMENT ON TABLE public.multi_agent_simulations IS
  'Historical rows retained for audit. Legacy outputs were arithmetic/template generation, not executed agent simulations or calibrated probabilities.';
COMMENT ON FUNCTION public.run_planetary_coordination_cycle() IS
  'Quarantined legacy coordination cycle. Does not mutate strategic truth until replacement governed engines exist.';
