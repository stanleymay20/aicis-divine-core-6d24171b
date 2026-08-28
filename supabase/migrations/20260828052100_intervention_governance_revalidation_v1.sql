-- AICIS intervention governance revalidation v1
--
-- Follow-up to the intervention truth floor. Separate cost/geopolitical semantics
-- from generic risk semantics, and make every re-evaluation revoke stale automatic
-- workflow state back to pending human review. A prior human decision must never be
-- silently carried across changed evidence without an explicit re-approval action.

ALTER TABLE public.intervention_simulations
  ADD COLUMN IF NOT EXISTS cost_semantics text,
  ADD COLUMN IF NOT EXISTS geopolitical_risk_semantics text;

UPDATE public.intervention_simulations
SET
  cost_semantics = COALESCE(cost_semantics, 'withheld_legacy_intervention_cost_semantics_unverified'),
  geopolitical_risk_semantics = COALESCE(geopolitical_risk_semantics, 'withheld_legacy_geopolitical_risk_semantics_unverified')
WHERE evidence_status <> 'evaluated';

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
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.risk_semantics)
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.geopolitical_risk_semantics) THEN
          v_risk := GREATEST(sim.risk_reduction_score, sim.geopolitical_risk);
          v_passed := sim.risk_reduction_score < 35 AND sim.geopolitical_risk < 50;
          v_status := 'evaluated';
          v_summary := CASE
            WHEN v_passed THEN 'Policy threshold not exceeded; explicit human governance still applies.'
            ELSE 'High-impact intervention requires explicit human approval.'
          END;
        END IF;

      ELSIF pol.policy_key = 'geopolitical-sensitivity-review' THEN
        IF sim.geopolitical_risk IS NOT NULL
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.geopolitical_risk_semantics) THEN
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
           AND NOT public.aicis_intervention_semantics_unusable_v1(sim.cost_semantics) THEN
          v_risk := sim.intervention_cost_score;
          v_passed := sim.intervention_cost_score < 75;
          v_status := 'evaluated';
          v_summary := CASE
            WHEN v_passed THEN 'Policy cost threshold not exceeded.'
            ELSE 'High-cost intervention requires explicit human review.'
          END;
        END IF;

      ELSE
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
    approved_by,
    approved_at,
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
    'Evidence was re-evaluated; explicit authorized human approval is required.',
    NULL,
    NULL,
    now(),
    now()
  )
  ON CONFLICT(workflow_key) DO UPDATE SET
    response_plan_id = EXCLUDED.response_plan_id,
    approval_status = 'pending_review',
    safety_rating = EXCLUDED.safety_rating,
    evidence_gate_status = EXCLUDED.evidence_gate_status,
    required_approver_role = EXCLUDED.required_approver_role,
    approval_reason = EXCLUDED.approval_reason,
    approved_by = NULL,
    approved_at = NULL,
    updated_at = now();

  INSERT INTO public.intervention_human_review_queue(
    review_key,
    simulation_id,
    response_plan_id,
    review_priority,
    review_status,
    review_reason,
    assigned_role,
    reviewer_id,
    reviewer_decision,
    reviewer_notes,
    created_at,
    reviewed_at
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
    NULL,
    NULL,
    NULL,
    now(),
    NULL
  )
  ON CONFLICT(review_key) DO UPDATE SET
    response_plan_id = EXCLUDED.response_plan_id,
    review_priority = EXCLUDED.review_priority,
    review_status = 'open',
    review_reason = EXCLUDED.review_reason,
    assigned_role = EXCLUDED.assigned_role,
    reviewer_id = NULL,
    reviewer_decision = NULL,
    reviewer_notes = NULL,
    reviewed_at = NULL;

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

REVOKE ALL ON FUNCTION public.evaluate_intervention_safety(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_intervention_approval_workflow(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_intervention_safety(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_intervention_approval_workflow(uuid,uuid) TO service_role;

COMMENT ON COLUMN public.intervention_simulations.cost_semantics IS
  'Semantics for intervention_cost_score. Cost-policy thresholds are deterministic governance rules, not probabilities.';
COMMENT ON COLUMN public.intervention_simulations.geopolitical_risk_semantics IS
  'Semantics for geopolitical_risk. Missing or legacy semantics make the relevant safety gate not evaluable.';
