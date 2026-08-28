-- AICIS legacy strategic-reasoning quarantine v1
--
-- The legacy multi-agent strategic layer generated confidence/probability/intervention
-- values with random(), seeded trust scores and neutral fallbacks, then averaged those
-- values into consensus. This is not adversarial reasoning or calibrated forecasting.
-- Preserve history for audit and route all future agent reasoning through the governed
-- evidence-linked cognition/position substrate introduced by the 20260828055xxx layer.

-- -----------------------------------------------------------------------------
-- 1. Legacy reasoning agents: identity/specialization is not calibrated authority.
-- -----------------------------------------------------------------------------
ALTER TABLE public.civilization_reasoning_agents
  ALTER COLUMN calibration_weight DROP DEFAULT,
  ALTER COLUMN trust_score DROP DEFAULT,
  ALTER COLUMN adversarial_resilience_score DROP DEFAULT,
  ALTER COLUMN consensus_alignment_score DROP DEFAULT,
  ALTER COLUMN recursive_reasoning_depth DROP DEFAULT,
  ALTER COLUMN active_status DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_calibration_weight numeric,
  ADD COLUMN IF NOT EXISTS calibration_semantics text,
  ADD COLUMN IF NOT EXISTS reported_trust_score numeric,
  ADD COLUMN IF NOT EXISTS trust_semantics text,
  ADD COLUMN IF NOT EXISTS reported_adversarial_resilience_score numeric,
  ADD COLUMN IF NOT EXISTS adversarial_resilience_semantics text,
  ADD COLUMN IF NOT EXISTS reported_consensus_alignment_score numeric,
  ADD COLUMN IF NOT EXISTS consensus_alignment_semantics text,
  ADD COLUMN IF NOT EXISTS registry_semantics text,
  ADD COLUMN IF NOT EXISTS capability_evidence_status text NOT NULL DEFAULT 'declared_only';

UPDATE public.civilization_reasoning_agents
SET
  reported_calibration_weight = COALESCE(reported_calibration_weight, calibration_weight),
  calibration_weight = NULL,
  calibration_semantics = COALESCE(calibration_semantics, 'legacy_seeded_calibration_weight_unverified'),
  reported_trust_score = COALESCE(reported_trust_score, trust_score),
  trust_score = NULL,
  trust_semantics = COALESCE(trust_semantics, 'withheld_agent_identity_not_empirical_trust'),
  reported_adversarial_resilience_score = COALESCE(reported_adversarial_resilience_score, adversarial_resilience_score),
  adversarial_resilience_score = NULL,
  adversarial_resilience_semantics = COALESCE(adversarial_resilience_semantics, 'legacy_seeded_agent_resilience_unverified'),
  reported_consensus_alignment_score = COALESCE(reported_consensus_alignment_score, consensus_alignment_score),
  consensus_alignment_score = NULL,
  consensus_alignment_semantics = COALESCE(consensus_alignment_semantics, 'legacy_seeded_alignment_score_unverified'),
  registry_semantics = COALESCE(registry_semantics, 'legacy_declared_reasoning_role_not_runtime_authority'),
  capability_evidence_status = 'declared_only',
  active_status = false;

-- -----------------------------------------------------------------------------
-- 2. Reasoning sessions: heuristic risk/pressure and consensus fields withheld.
-- -----------------------------------------------------------------------------
ALTER TABLE public.civilization_reasoning_sessions
  ALTER COLUMN consensus_status DROP DEFAULT,
  ALTER COLUMN consensus_confidence DROP DEFAULT,
  ALTER COLUMN disagreement_index DROP DEFAULT,
  ALTER COLUMN adversarial_pressure_score DROP DEFAULT,
  ALTER COLUMN recursive_iteration_count DROP DEFAULT,
  ALTER COLUMN strategic_risk_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_consensus_confidence numeric,
  ADD COLUMN IF NOT EXISTS reported_disagreement_index numeric,
  ADD COLUMN IF NOT EXISTS reported_adversarial_pressure_score numeric,
  ADD COLUMN IF NOT EXISTS reported_strategic_risk_score numeric,
  ADD COLUMN IF NOT EXISTS consensus_semantics text,
  ADD COLUMN IF NOT EXISTS disagreement_semantics text,
  ADD COLUMN IF NOT EXISTS adversarial_pressure_semantics text,
  ADD COLUMN IF NOT EXISTS risk_semantics text,
  ADD COLUMN IF NOT EXISTS reasoning_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.civilization_reasoning_sessions
SET
  reported_consensus_confidence = COALESCE(reported_consensus_confidence, consensus_confidence),
  reported_disagreement_index = COALESCE(reported_disagreement_index, disagreement_index),
  reported_adversarial_pressure_score = COALESCE(reported_adversarial_pressure_score, adversarial_pressure_score),
  reported_strategic_risk_score = COALESCE(reported_strategic_risk_score, strategic_risk_score),
  consensus_confidence = NULL,
  disagreement_index = NULL,
  adversarial_pressure_score = NULL,
  strategic_risk_score = NULL,
  consensus_status = 'legacy_quarantined',
  consensus_semantics = COALESCE(consensus_semantics, 'withheld_not_position_based_consensus'),
  disagreement_semantics = COALESCE(disagreement_semantics, 'legacy_random_output_dispersion_not_reasoning_disagreement'),
  adversarial_pressure_semantics = COALESCE(adversarial_pressure_semantics, 'legacy_signal_score_arithmetic_unverified'),
  risk_semantics = COALESCE(risk_semantics, 'withheld_not_established_as_strategic_risk_measure'),
  reasoning_semantics = COALESCE(reasoning_semantics, 'legacy_randomized_multi_agent_reasoning_unverified'),
  evidence_status = 'legacy_unverified',
  completed_at = NULL;

-- -----------------------------------------------------------------------------
-- 3. Agent outputs: random probabilities/confidence are never canonical evidence.
-- -----------------------------------------------------------------------------
ALTER TABLE public.civilization_agent_reasoning_outputs
  ALTER COLUMN confidence_score DROP DEFAULT,
  ALTER COLUMN threat_probability DROP DEFAULT,
  ALTER COLUMN opportunity_probability DROP DEFAULT,
  ALTER COLUMN escalation_probability DROP DEFAULT,
  ALTER COLUMN systemic_impact_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_threat_probability numeric,
  ADD COLUMN IF NOT EXISTS reported_opportunity_probability numeric,
  ADD COLUMN IF NOT EXISTS reported_escalation_probability numeric,
  ADD COLUMN IF NOT EXISTS reported_systemic_impact_score numeric,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS systemic_impact_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.civilization_agent_reasoning_outputs
SET
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  reported_threat_probability = COALESCE(reported_threat_probability, threat_probability),
  reported_opportunity_probability = COALESCE(reported_opportunity_probability, opportunity_probability),
  reported_escalation_probability = COALESCE(reported_escalation_probability, escalation_probability),
  reported_systemic_impact_score = COALESCE(reported_systemic_impact_score, systemic_impact_score),
  confidence_score = NULL,
  threat_probability = NULL,
  opportunity_probability = NULL,
  escalation_probability = NULL,
  systemic_impact_score = NULL,
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_randomized_score_not_epistemic_confidence'),
  probability_semantics = COALESCE(probability_semantics, 'withheld_randomized_values_not_probabilities'),
  systemic_impact_semantics = COALESCE(systemic_impact_semantics, 'legacy_agent_alignment_arithmetic_unverified'),
  evidence_semantics = COALESCE(evidence_semantics, 'legacy_generic_reasoning_evidence_without_exact_lineage'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 4. Consensus maps: averages of generated scores are not consensus evidence.
-- -----------------------------------------------------------------------------
ALTER TABLE public.civilization_agent_consensus_maps
  ALTER COLUMN consensus_strength DROP DEFAULT,
  ALTER COLUMN adversarial_divergence_score DROP DEFAULT,
  ALTER COLUMN systemic_alignment_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_consensus_strength numeric,
  ADD COLUMN IF NOT EXISTS reported_adversarial_divergence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_systemic_alignment_score numeric,
  ADD COLUMN IF NOT EXISTS reported_stabilization_recommendation text,
  ADD COLUMN IF NOT EXISTS consensus_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.civilization_agent_consensus_maps
SET
  reported_consensus_strength = COALESCE(reported_consensus_strength, consensus_strength),
  reported_adversarial_divergence_score = COALESCE(reported_adversarial_divergence_score, adversarial_divergence_score),
  reported_systemic_alignment_score = COALESCE(reported_systemic_alignment_score, systemic_alignment_score),
  reported_stabilization_recommendation = COALESCE(reported_stabilization_recommendation, stabilization_recommendation),
  consensus_strength = NULL,
  adversarial_divergence_score = NULL,
  systemic_alignment_score = NULL,
  dominant_position = NULL,
  minority_positions = '[]'::jsonb,
  stabilization_recommendation = NULL,
  consensus_semantics = COALESCE(consensus_semantics, 'withheld_generated_score_averages_not_position_consensus'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 5. Strategic interventions: random cost/success and generated recommendations.
-- -----------------------------------------------------------------------------
ALTER TABLE public.civilization_strategic_interventions
  ALTER COLUMN projected_stabilization_score DROP DEFAULT,
  ALTER COLUMN projected_risk_reduction DROP DEFAULT,
  ALTER COLUMN projected_cost_index DROP DEFAULT,
  ALTER COLUMN projected_success_probability DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_intervention_priority text,
  ADD COLUMN IF NOT EXISTS reported_projected_stabilization_score numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_risk_reduction numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_cost_index numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_success_probability numeric,
  ADD COLUMN IF NOT EXISTS intervention_semantics text,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.civilization_strategic_interventions
SET
  reported_intervention_priority = COALESCE(reported_intervention_priority, intervention_priority),
  reported_projected_stabilization_score = COALESCE(reported_projected_stabilization_score, projected_stabilization_score),
  reported_projected_risk_reduction = COALESCE(reported_projected_risk_reduction, projected_risk_reduction),
  reported_projected_cost_index = COALESCE(reported_projected_cost_index, projected_cost_index),
  reported_projected_success_probability = COALESCE(reported_projected_success_probability, projected_success_probability),
  intervention_priority = NULL,
  projected_stabilization_score = NULL,
  projected_risk_reduction = NULL,
  projected_cost_index = NULL,
  projected_success_probability = NULL,
  intervention_description = NULL,
  intervention_semantics = COALESCE(intervention_semantics, 'legacy_generated_strategic_intervention_not_operational_recommendation'),
  probability_semantics = COALESCE(probability_semantics, 'withheld_randomized_success_score_not_probability'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 6. Disable the randomized cycle. Future reasoning must use agent_cognition_records_v1
-- and agent_position_records_v1 with exact evidence lineage.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_multi_agent_reasoning_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'multi-agent-strategic-reasoning-layer',
    'skipped',
    'quarantined: randomized agent probabilities/consensus/interventions disabled; use governed evidence-linked cognition and positions'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'randomized_reasoning',false,
    'synthetic_consensus',false,
    'synthetic_interventions',false,
    'replacement_cognition_table','agent_cognition_records_v1',
    'replacement_position_table','agent_position_records_v1'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Compatibility overview exposes the quarantine rather than naked scores.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.civilization_reasoning_overview AS
SELECT
  crs.id,
  crs.reasoning_objective,
  crs.reasoning_scope,
  crs.consensus_status,
  crs.consensus_confidence,
  crs.consensus_semantics,
  crs.disagreement_index,
  crs.disagreement_semantics,
  crs.strategic_risk_score,
  crs.risk_semantics,
  crs.evidence_status,
  COUNT(DISTINCT caro.agent_id) AS participating_agents,
  crs.created_at
FROM public.civilization_reasoning_sessions crs
LEFT JOIN public.civilization_agent_reasoning_outputs caro
  ON caro.session_id = crs.id
GROUP BY crs.id
ORDER BY crs.created_at DESC;

REVOKE ALL ON FUNCTION public.run_multi_agent_reasoning_cycle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_multi_agent_reasoning_cycle() TO service_role;

COMMENT ON TABLE public.civilization_reasoning_agents IS
  'Legacy declared strategic-agent catalogue. Seeded trust/calibration/alignment values are quarantined and agents are inactive.';
COMMENT ON TABLE public.civilization_agent_reasoning_outputs IS
  'Legacy randomized agent outputs retained for audit only; canonical probability/confidence fields are NULL.';
COMMENT ON TABLE public.civilization_strategic_interventions IS
  'Legacy generated intervention artifacts retained for audit only; not operational recommendations.';
