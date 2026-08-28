-- AICIS intervention + governance epistemic truth floor v1
--
-- The legacy adaptive-intervention branch mixed hand-seeded strategy priors,
-- quarantined planetary-propagation outputs, deterministic arithmetic, and generic
-- response templates into values labelled risk reduction, confidence, feasibility,
-- success probability and outcome accuracy. Preserve the historical material for
-- audit, but do not let it become operational truth. Human-governance primitives
-- remain available and fail closed when evidence is incomplete.

-- -----------------------------------------------------------------------------
-- 1. Strategy registry: catalogue identity is not evaluated effectiveness.
-- -----------------------------------------------------------------------------
ALTER TABLE public.intervention_strategy_registry
  ALTER COLUMN operational_cost_score DROP DEFAULT,
  ALTER COLUMN estimated_effectiveness DROP DEFAULT,
  ALTER COLUMN deployment_complexity DROP DEFAULT,
  ALTER COLUMN deployment_latency_hours DROP DEFAULT,
  ALTER COLUMN geopolitical_sensitivity DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_operational_cost_score numeric,
  ADD COLUMN IF NOT EXISTS operational_cost_semantics text,
  ADD COLUMN IF NOT EXISTS reported_estimated_effectiveness numeric,
  ADD COLUMN IF NOT EXISTS effectiveness_semantics text,
  ADD COLUMN IF NOT EXISTS reported_deployment_complexity numeric,
  ADD COLUMN IF NOT EXISTS deployment_complexity_semantics text,
  ADD COLUMN IF NOT EXISTS reported_deployment_latency_hours numeric,
  ADD COLUMN IF NOT EXISTS deployment_latency_semantics text,
  ADD COLUMN IF NOT EXISTS reported_geopolitical_sensitivity numeric,
  ADD COLUMN IF NOT EXISTS geopolitical_sensitivity_semantics text,
  ADD COLUMN IF NOT EXISTS strategy_evidence_status text NOT NULL DEFAULT 'identity_only'
    CHECK (strategy_evidence_status IN ('identity_only','partial','evaluated')),
  ADD COLUMN IF NOT EXISTS assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_record_keys text[] NOT NULL DEFAULT '{}';

UPDATE public.intervention_strategy_registry
SET
  reported_operational_cost_score = COALESCE(reported_operational_cost_score, operational_cost_score),
  operational_cost_score = NULL,
  operational_cost_semantics = COALESCE(operational_cost_semantics, 'legacy_strategy_cost_prior_unverified'),
  reported_estimated_effectiveness = COALESCE(reported_estimated_effectiveness, estimated_effectiveness),
  estimated_effectiveness = NULL,
  effectiveness_semantics = COALESCE(effectiveness_semantics, 'legacy_strategy_effectiveness_prior_unverified'),
  reported_deployment_complexity = COALESCE(reported_deployment_complexity, deployment_complexity),
  deployment_complexity = NULL,
  deployment_complexity_semantics = COALESCE(deployment_complexity_semantics, 'legacy_strategy_complexity_prior_unverified'),
  reported_deployment_latency_hours = COALESCE(reported_deployment_latency_hours, deployment_latency_hours),
  deployment_latency_hours = NULL,
  deployment_latency_semantics = COALESCE(deployment_latency_semantics, 'legacy_strategy_latency_prior_unverified'),
  reported_geopolitical_sensitivity = COALESCE(reported_geopolitical_sensitivity, geopolitical_sensitivity),
  geopolitical_sensitivity = NULL,
  geopolitical_sensitivity_semantics = COALESCE(geopolitical_sensitivity_semantics, 'legacy_strategy_geopolitical_prior_unverified'),
  strategy_evidence_status = 'identity_only',
  assessed_at = NULL,
  source_record_keys = '{}';

-- -----------------------------------------------------------------------------
-- 2. Intervention simulations: synthetic arithmetic is not forecast evidence.
-- -----------------------------------------------------------------------------
ALTER TABLE public.intervention_simulations
  ALTER COLUMN simulation_status DROP DEFAULT,
  ALTER COLUMN baseline_risk_score DROP DEFAULT,
  ALTER COLUMN projected_risk_after_intervention DROP DEFAULT,
  ALTER COLUMN risk_reduction_score DROP DEFAULT,
  ALTER COLUMN projected_operational_stability DROP DEFAULT,
  ALTER COLUMN projected_economic_impact DROP DEFAULT,
  ALTER COLUMN projected_humanitarian_impact DROP DEFAULT,
  ALTER COLUMN confidence_score DROP DEFAULT,
  ALTER COLUMN intervention_cost_score DROP DEFAULT,
  ALTER COLUMN execution_feasibility DROP DEFAULT,
  ALTER COLUMN geopolitical_risk DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_baseline_risk_score numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_risk_after_intervention numeric,
  ADD COLUMN IF NOT EXISTS reported_risk_reduction_score numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_operational_stability numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_economic_impact numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_humanitarian_impact numeric,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_intervention_cost_score numeric,
  ADD COLUMN IF NOT EXISTS reported_execution_feasibility numeric,
  ADD COLUMN IF NOT EXISTS reported_geopolitical_risk numeric,
  ADD COLUMN IF NOT EXISTS simulation_semantics text,
  ADD COLUMN IF NOT EXISTS risk_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS feasibility_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified'
    CHECK (evidence_status IN ('legacy_unverified','insufficient_evidence','evaluated'));

UPDATE public.intervention_simulations
SET
  reported_baseline_risk_score = COALESCE(reported_baseline_risk_score, baseline_risk_score),
  reported_projected_risk_after_intervention = COALESCE(reported_projected_risk_after_intervention, projected_risk_after_intervention),
  reported_risk_reduction_score = COALESCE(reported_risk_reduction_score, risk_reduction_score),
  reported_projected_operational_stability = COALESCE(reported_projected_operational_stability, projected_operational_stability),
  reported_projected_economic_impact = COALESCE(reported_projected_economic_impact, projected_economic_impact),
  reported_projected_humanitarian_impact = COALESCE(reported_projected_humanitarian_impact, projected_humanitarian_impact),
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  reported_intervention_cost_score = COALESCE(reported_intervention_cost_score, intervention_cost_score),
  reported_execution_feasibility = COALESCE(reported_execution_feasibility, execution_feasibility),
  reported_geopolitical_risk = COALESCE(reported_geopolitical_risk, geopolitical_risk),
  baseline_risk_score = NULL,
  projected_risk_after_intervention = NULL,
  risk_reduction_score = NULL,
  projected_operational_stability = NULL,
  projected_economic_impact = NULL,
  projected_humanitarian_impact = NULL,
  confidence_score = NULL,
  intervention_cost_score = NULL,
  execution_feasibility = NULL,
  geopolitical_risk = NULL,
  simulation_status = 'legacy_quarantined',
  simulation_semantics = COALESCE(simulation_semantics, 'legacy_deterministic_intervention_arithmetic_unverified'),
  risk_semantics = COALESCE(risk_semantics, 'withheld_not_established_as_risk_forecast'),
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_not_established_as_epistemic_confidence'),
  feasibility_semantics = COALESCE(feasibility_semantics, 'withheld_not_empirically_evaluated'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 3. Coordination plans: templates are not probability-bearing action plans.
-- -----------------------------------------------------------------------------
ALTER TABLE public.coordination_response_plans
  ALTER COLUMN coordination_scope DROP DEFAULT,
  ALTER COLUMN operational_priority DROP DEFAULT,
  ALTER COLUMN estimated_execution_time_hours DROP DEFAULT,
  ALTER COLUMN projected_success_probability DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_coordination_scope text,
  ADD COLUMN IF NOT EXISTS reported_operational_priority text,
  ADD COLUMN IF NOT EXISTS reported_estimated_execution_time_hours numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_success_probability numeric,
  ADD COLUMN IF NOT EXISTS success_probability_semantics text,
  ADD COLUMN IF NOT EXISTS execution_time_semantics text,
  ADD COLUMN IF NOT EXISTS plan_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.coordination_response_plans
SET
  reported_coordination_scope = COALESCE(reported_coordination_scope, coordination_scope),
  reported_operational_priority = COALESCE(reported_operational_priority, operational_priority),
  reported_estimated_execution_time_hours = COALESCE(reported_estimated_execution_time_hours, estimated_execution_time_hours),
  reported_projected_success_probability = COALESCE(reported_projected_success_probability, projected_success_probability),
  coordination_scope = NULL,
  operational_priority = NULL,
  estimated_execution_time_hours = NULL,
  projected_success_probability = NULL,
  response_status = CASE WHEN response_status IN ('generated','draft') THEN 'legacy_quarantined' ELSE response_status END,
  success_probability_semantics = COALESCE(success_probability_semantics, 'withheld_not_established_as_probability'),
  execution_time_semantics = COALESCE(execution_time_semantics, 'legacy_execution_time_assumption_unverified'),
  plan_semantics = COALESCE(plan_semantics, 'legacy_response_template_not_operational_authorization'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 4. Outcome ledger: missing realized outcomes must not become zeros.
-- -----------------------------------------------------------------------------
ALTER TABLE public.intervention_outcome_ledger
  ALTER COLUMN actual_risk_reduction DROP DEFAULT,
  ALTER COLUMN actual_operational_stability DROP DEFAULT,
  ALTER COLUMN actual_humanitarian_impact DROP DEFAULT,
  ALTER COLUMN actual_economic_impact DROP DEFAULT,
  ALTER COLUMN outcome_accuracy_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_actual_risk_reduction numeric,
  ADD COLUMN IF NOT EXISTS reported_actual_operational_stability numeric,
  ADD COLUMN IF NOT EXISTS reported_actual_humanitarian_impact numeric,
  ADD COLUMN IF NOT EXISTS reported_actual_economic_impact numeric,
  ADD COLUMN IF NOT EXISTS reported_outcome_accuracy_score numeric,
  ADD COLUMN IF NOT EXISTS outcome_metric_semantics text,
  ADD COLUMN IF NOT EXISTS accuracy_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.intervention_outcome_ledger
SET
  reported_actual_risk_reduction = COALESCE(reported_actual_risk_reduction, actual_risk_reduction),
  reported_actual_operational_stability = COALESCE(reported_actual_operational_stability, actual_operational_stability),
  reported_actual_humanitarian_impact = COALESCE(reported_actual_humanitarian_impact, actual_humanitarian_impact),
  reported_actual_economic_impact = COALESCE(reported_actual_economic_impact, actual_economic_impact),
  reported_outcome_accuracy_score = COALESCE(reported_outcome_accuracy_score, outcome_accuracy_score),
  actual_risk_reduction = NULL,
  actual_operational_stability = NULL,
  actual_humanitarian_impact = NULL,
  actual_economic_impact = NULL,
  outcome_accuracy_score = NULL,
  outcome_metric_semantics = COALESCE(outcome_metric_semantics, 'legacy_outcome_metrics_semantics_unverified'),
  accuracy_semantics = COALESCE(accuracy_semantics, 'withheld_projection_comparability_not_established'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 5. Safety evaluations: unknown is not zero risk and not a pass.
-- -----------------------------------------------------------------------------
ALTER TABLE public.intervention_safety_evaluations
  ALTER COLUMN passed DROP DEFAULT,
  ALTER COLUMN risk_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_risk_score numeric,
  ADD COLUMN IF NOT EXISTS risk_score_semantics text,
  ADD COLUMN IF NOT EXISTS evaluation_status text NOT NULL DEFAULT 'not_evaluable'
    CHECK (evaluation_status IN ('not_evaluable','requires_human_review','evaluated')),
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'insufficient_evidence';

UPDATE public.intervention_safety_evaluations
SET
  reported_risk_score = COALESCE(reported_risk_score, risk_score),
  risk_score = NULL,
  passed = NULL,
  risk_score_semantics = COALESCE(risk_score_semantics, 'legacy_policy_risk_score_semantics_unverified'),
  evaluation_status = 'not_evaluable',
  evidence_status = 'insufficient_evidence',
  evaluation_summary = 'Historical safety evaluation quarantined: underlying intervention metrics were not governed evidence.',
  required_mitigation = 'Human review required before any operational use.';

-- Policy thresholds are governance rules, not empirical probabilities. Replace
-- the legacy confidence threshold with an explicit evidence-state requirement.
UPDATE public.intervention_safety_policies
SET rule_config = jsonb_build_object(
      'required_simulation_evidence_status','evaluated',
      'requires_governed_metric_semantics',true
    ),
    requires_human_approval = true,
    updated_at = now()
WHERE policy_key = 'evidence-quality-threshold';

CREATE OR REPLACE FUNCTION public.aicis_intervention_semantics_unusable_v1(p_semantics text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_semantics IS NULL
    OR btrim(p_semantics) = ''
    OR lower(p_semantics) LIKE '%legacy%'
    OR lower(p_semantics) LIKE '%unknown%'
    OR lower(p_semantics) LIKE '%unverified%'
    OR lower(p_semantics) LIKE '%unspecified%'
    OR lower(p_semantics) LIKE '%unlabeled%'
    OR lower(p_semantics) LIKE '%withheld%';
$$;

REVOKE ALL ON FUNCTION public.aicis_intervention_semantics_unusable_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_intervention_semantics_unusable_v1(text) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. Synthetic intervention generation is disabled. Keep names callable so an
-- unknown historical caller receives an explicit abstention rather than an error.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_intervention_simulation(
  p_propagation_event_id uuid,
  p_strategy_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'adaptive-intervention-simulation',
    'skipped',
    'quarantined: legacy intervention arithmetic is not an evaluated counterfactual model'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','evaluated_counterfactual_model_required',
    'propagation_event_id',p_propagation_event_id,
    'strategy_key',p_strategy_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_coordination_response_plan(
  p_simulation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'coordination-response-plan',
    'skipped',
    'quarantined: response templates cannot be promoted from unevaluated intervention simulations'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','governed_intervention_evidence_required',
    'simulation_id',p_simulation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_intervention_outcome(
  p_simulation_id uuid,
  p_response_plan_id uuid,
  p_observed_outcome text,
  p_actual_risk_reduction numeric DEFAULT NULL,
  p_actual_operational_stability numeric DEFAULT NULL,
  p_actual_humanitarian_impact numeric DEFAULT NULL,
  p_actual_economic_impact numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'intervention-outcome-recording',
    'skipped',
    'quarantined: outcome recording requires explicit provenance and metric semantics'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','provenance_aware_outcome_contract_required',
    'simulation_id',p_simulation_id,
    'response_plan_id',p_response_plan_id,
    'observed_outcome_supplied',p_observed_outcome IS NOT NULL,
    'numeric_values_supplied',
      (p_actual_risk_reduction IS NOT NULL
       OR p_actual_operational_stability IS NOT NULL
       OR p_actual_humanitarian_impact IS NOT NULL
       OR p_actual_economic_impact IS NOT NULL)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Governance remains active but fail-closed. It evaluates policy gates only
-- for future simulations explicitly marked evaluated with usable semantics.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_intervention_safety(
  p_simulation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sim record;
  pol record;
  v_passed boolean;
  v_risk numeric;
  v_status text;
  v_summary text;
  v_count integer := 0;
  v_failed integer := 0;
  v_not_evaluable integer := 0;
  v_requires_review integer := 0;
BEGIN
  SELECT * INTO sim
  FROM public.intervention_simulations
  WHERE id = p_simulation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_simulation');
  END IF;

  FOR pol IN
    SELECT *
    FROM public.intervention_safety_policies
    WHERE enabled = true
    ORDER BY policy_key
  LOOP
    v_passed := NULL;
    v_risk := NULL;
    v_status := 'not_evaluable';
    v_summary := 'Evidence is insufficient to evaluate this policy gate.';

    IF sim.evidence_status = 'evaluated' THEN
      IF pol.policy_key = 'evidence-quality-threshold' THEN
        IF NOT public.aicis_intervention_semantics_unusable_v1(sim.simulation_semantics)
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.risk_semantics)
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.feasibility_semantics) THEN
          v_passed := true;
          v_status := 'evaluated';
          v_summary := 'Governed simulation evidence contract is present; no probability claim is implied.';
        END IF;

      ELSIF pol.policy_key = 'no-autonomous-high-impact-action' THEN
        IF sim.risk_reduction_score IS NOT NULL
           AND sim.geopolitical_risk IS NOT NULL
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.risk_semantics) THEN
          v_risk := GREATEST(sim.risk_reduction_score, sim.geopolitical_risk);
          v_passed := sim.risk_reduction_score < 35 AND sim.geopolitical_risk < 50;
          v_status := 'evaluated';
          v_summary := CASE
            WHEN v_passed THEN 'Policy threshold not exceeded; human governance requirements still apply.'
            ELSE 'High-impact intervention requires explicit human approval.'
          END;
        END IF;

      ELSIF pol.policy_key = 'geopolitical-sensitivity-review' THEN
        IF sim.geopolitical_risk IS NOT NULL
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.risk_semantics) THEN
          v_risk := sim.geopolitical_risk;
          v_passed := sim.geopolitical_risk < 60;
          v_status := 'evaluated';
          v_summary := CASE
            WHEN v_passed THEN 'Policy threshold not exceeded; this is not a safety probability.'
            ELSE 'Geopolitical sensitivity requires explicit human review.'
          END;
        END IF;

      ELSIF pol.policy_key = 'economic-disruption-review' THEN
        IF sim.intervention_cost_score IS NOT NULL
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.risk_semantics) THEN
          v_risk := sim.intervention_cost_score;
          v_passed := sim.intervention_cost_score < 75;
          v_status := 'evaluated';
          v_summary := CASE
            WHEN v_passed THEN 'Policy cost threshold not exceeded.'
            ELSE 'High-cost intervention requires explicit human review.'
          END;
        END IF;

      ELSE
        -- Humanitarian and any future unmatched safety policy must never pass by
        -- default. They are routed to explicit human review.
        v_status := 'requires_human_review';
        v_summary := 'Policy requires explicit human review; no automated pass is available.';
      END IF;
    END IF;

    INSERT INTO public.intervention_safety_evaluations(
      evaluation_key,
      simulation_id,
      policy_key,
      passed,
      risk_score,
      evaluation_summary,
      required_mitigation,
      evaluated_at,
      risk_score_semantics,
      evaluation_status,
      evidence_status
    ) VALUES (
      md5(p_simulation_id::text || '|' || pol.policy_key),
      p_simulation_id,
      pol.policy_key,
      v_passed,
      v_risk,
      v_summary,
      CASE
        WHEN v_passed IS TRUE THEN NULL
        ELSE 'Human approval and evidence review required before operational use.'
      END,
      now(),
      CASE WHEN v_risk IS NULL THEN NULL ELSE 'deterministic_policy_threshold_input_not_probability' END,
      v_status,
      CASE WHEN v_status = 'evaluated' THEN 'governed_input_contract' ELSE 'insufficient_evidence' END
    )
    ON CONFLICT(evaluation_key) DO UPDATE SET
      passed = EXCLUDED.passed,
      risk_score = EXCLUDED.risk_score,
      evaluation_summary = EXCLUDED.evaluation_summary,
      required_mitigation = EXCLUDED.required_mitigation,
      evaluated_at = EXCLUDED.evaluated_at,
      risk_score_semantics = EXCLUDED.risk_score_semantics,
      evaluation_status = EXCLUDED.evaluation_status,
      evidence_status = EXCLUDED.evidence_status;

    v_count := v_count + 1;
    IF v_passed IS FALSE THEN v_failed := v_failed + 1; END IF;
    IF v_status = 'not_evaluable' THEN v_not_evaluable := v_not_evaluable + 1; END IF;
    IF v_status = 'requires_human_review' THEN v_requires_review := v_requires_review + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status',CASE
      WHEN v_not_evaluable > 0 THEN 'not_evaluable'
      WHEN v_failed > 0 OR v_requires_review > 0 THEN 'requires_human_review'
      ELSE 'evaluated'
    END,
    'policies_evaluated',v_count,
    'failed_policies',v_failed,
    'not_evaluable_policies',v_not_evaluable,
    'human_review_policies',v_requires_review
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_intervention_approval_workflow(
  p_simulation_id uuid,
  p_response_plan_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sim record;
  v_eval jsonb;
  v_failed integer := 0;
  v_not_evaluable integer := 0;
  v_human_review integer := 0;
  v_key text;
  v_safety text;
  v_evidence_gate text;
  v_priority text;
BEGIN
  SELECT * INTO sim
  FROM public.intervention_simulations
  WHERE id = p_simulation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_simulation');
  END IF;

  v_eval := public.evaluate_intervention_safety(p_simulation_id);
  v_failed := COALESCE((v_eval->>'failed_policies')::integer,0);
  v_not_evaluable := COALESCE((v_eval->>'not_evaluable_policies')::integer,0);
  v_human_review := COALESCE((v_eval->>'human_review_policies')::integer,0);

  v_safety := CASE
    WHEN v_failed > 0 THEN 'high_risk'
    WHEN v_not_evaluable > 0 THEN 'unknown'
    ELSE 'requires_review'
  END;

  v_evidence_gate := CASE
    WHEN sim.evidence_status = 'evaluated' AND v_not_evaluable = 0 THEN 'passed'
    ELSE 'failed_closed'
  END;

  v_priority := CASE
    WHEN v_failed > 0 THEN 'critical'
    WHEN v_not_evaluable > 0 THEN 'high'
    ELSE 'medium'
  END;

  v_key := md5(p_simulation_id::text || '|approval');

  INSERT INTO public.intervention_approval_workflows(
    workflow_key,
    simulation_id,
    response_plan_id,
    approval_status,
    safety_rating,
    evidence_gate_status,
    required_approver_role,
    approval_reason,
    created_at,
    updated_at
  ) VALUES (
    v_key,
    p_simulation_id,
    p_response_plan_id,
    'pending_review',
    v_safety,
    v_evidence_gate,
    CASE WHEN v_failed > 0 THEN 'executive_reviewer' ELSE 'senior_analyst' END,
    'Workflow is fail-closed; only an explicit authorized human decision may approve an intervention.',
    now(),
    now()
  )
  ON CONFLICT(workflow_key) DO UPDATE SET
    approval_status = CASE
      WHEN public.intervention_approval_workflows.approval_status = 'approved'
        THEN public.intervention_approval_workflows.approval_status
      ELSE 'pending_review'
    END,
    safety_rating = EXCLUDED.safety_rating,
    evidence_gate_status = EXCLUDED.evidence_gate_status,
    required_approver_role = EXCLUDED.required_approver_role,
    approval_reason = EXCLUDED.approval_reason,
    updated_at = now();

  INSERT INTO public.intervention_human_review_queue(
    review_key,
    simulation_id,
    response_plan_id,
    review_priority,
    review_status,
    review_reason,
    assigned_role,
    created_at
  ) VALUES (
    md5(p_simulation_id::text || '|human_review'),
    p_simulation_id,
    p_response_plan_id,
    v_priority,
    'open',
    CASE
      WHEN v_not_evaluable > 0 THEN 'Evidence is incomplete; automated clearance is prohibited.'
      WHEN v_failed > 0 THEN 'One or more deterministic safety-policy thresholds were exceeded.'
      WHEN v_human_review > 0 THEN 'One or more policies explicitly require human review.'
      ELSE 'Human approval remains mandatory before operational use.'
    END,
    CASE WHEN v_failed > 0 THEN 'executive_reviewer' ELSE 'senior_analyst' END,
    now()
  )
  ON CONFLICT(review_key) DO UPDATE SET
    review_priority = EXCLUDED.review_priority,
    review_status = CASE
      WHEN public.intervention_human_review_queue.review_status = 'closed'
        THEN public.intervention_human_review_queue.review_status
      ELSE 'open'
    END,
    review_reason = EXCLUDED.review_reason,
    assigned_role = EXCLUDED.assigned_role;

  RETURN jsonb_build_object(
    'status','pending_human_review',
    'workflow_key',v_key,
    'safety_rating',v_safety,
    'evidence_gate_status',v_evidence_gate,
    'failed_policies',v_failed,
    'not_evaluable_policies',v_not_evaluable,
    'human_review_policies',v_human_review
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_intervention_governance_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_count integer := 0;
BEGIN
  FOR rec IN
    SELECT s.id
    FROM public.intervention_simulations s
    LEFT JOIN public.intervention_approval_workflows w ON w.simulation_id = s.id
    WHERE s.evidence_status = 'evaluated'
      AND w.id IS NULL
    ORDER BY s.created_at ASC
    LIMIT 100
  LOOP
    PERFORM public.create_intervention_approval_workflow(rec.id, NULL);
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'intervention-governance-cycle',
    CASE WHEN v_count = 0 THEN 'skipped' ELSE 'success' END,
    CASE
      WHEN v_count = 0 THEN 'no evaluated intervention simulations awaiting governance review'
      ELSE 'fail-closed human-review workflows created=' || v_count
    END
  );

  RETURN jsonb_build_object(
    'status',CASE WHEN v_count = 0 THEN 'no_evaluated_inputs' ELSE 'pending_human_review' END,
    'workflows_created',v_count
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Compatibility views expose evidence state and sort unknowns last.
-- -----------------------------------------------------------------------------
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
  s.evidence_status,
  s.simulation_semantics,
  s.created_at
FROM public.intervention_simulations s
LEFT JOIN public.planetary_propagation_events p
  ON p.id = s.source_propagation_event_id
ORDER BY s.risk_reduction_score DESC NULLS LAST, s.created_at DESC;

CREATE OR REPLACE VIEW public.coordination_response_command_view AS
SELECT
  plan_name,
  coordination_scope,
  operational_priority,
  response_status,
  projected_success_probability,
  success_probability_semantics,
  evidence_status,
  estimated_execution_time_hours,
  created_at
FROM public.coordination_response_plans
ORDER BY projected_success_probability DESC NULLS LAST, created_at DESC;

CREATE OR REPLACE VIEW public.intervention_governance_command_view AS
SELECT
  w.workflow_key,
  s.simulation_name,
  w.approval_status,
  w.safety_rating,
  w.evidence_gate_status,
  w.required_approver_role,
  s.risk_reduction_score,
  s.confidence_score,
  s.geopolitical_risk,
  s.evidence_status AS simulation_evidence_status,
  w.created_at
FROM public.intervention_approval_workflows w
JOIN public.intervention_simulations s ON s.id = w.simulation_id
ORDER BY
  CASE w.safety_rating WHEN 'high_risk' THEN 1 WHEN 'unknown' THEN 2 WHEN 'requires_review' THEN 3 ELSE 4 END,
  w.created_at DESC;

REVOKE ALL ON FUNCTION public.generate_intervention_simulation(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_coordination_response_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_intervention_outcome(uuid,uuid,text,numeric,numeric,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_intervention_safety(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_intervention_approval_workflow(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_intervention_governance_cycle() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.generate_intervention_simulation(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_coordination_response_plan(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_intervention_outcome(uuid,uuid,text,numeric,numeric,numeric,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_intervention_safety(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_intervention_approval_workflow(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_intervention_governance_cycle() TO service_role;

COMMENT ON TABLE public.intervention_simulations IS
  'Legacy intervention simulations retained for audit. New canonical projections require an evaluated counterfactual evidence contract.';
COMMENT ON COLUMN public.coordination_response_plans.projected_success_probability IS
  'Nullable evaluated probability only. Legacy template confidence cannot populate this field.';
COMMENT ON COLUMN public.intervention_safety_evaluations.passed IS
  'Nullable deterministic policy-gate result. NULL means not evaluable; it must never be interpreted as a pass.';
