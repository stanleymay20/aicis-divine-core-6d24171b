-- Intervention Governance + Safety Layer
-- Adds approval workflows, evidence gates, human oversight, safety constraints,
-- and risk controls for AICIS intervention recommendations.

CREATE TABLE IF NOT EXISTS public.intervention_safety_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text UNIQUE NOT NULL,
  policy_name text NOT NULL,
  policy_domain text,
  policy_type text DEFAULT 'safety_gate',
  severity text DEFAULT 'high',
  rule_config jsonb DEFAULT '{}'::jsonb,
  requires_human_approval boolean DEFAULT true,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intervention_approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key text UNIQUE NOT NULL,
  simulation_id uuid REFERENCES public.intervention_simulations(id) ON DELETE CASCADE,
  response_plan_id uuid REFERENCES public.coordination_response_plans(id) ON DELETE SET NULL,
  approval_status text DEFAULT 'pending_review',
  safety_rating text DEFAULT 'unknown',
  evidence_gate_status text DEFAULT 'pending',
  required_approver_role text DEFAULT 'senior_analyst',
  approval_reason text,
  rejection_reason text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intervention_safety_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_key text UNIQUE NOT NULL,
  simulation_id uuid REFERENCES public.intervention_simulations(id) ON DELETE CASCADE,
  policy_key text REFERENCES public.intervention_safety_policies(policy_key) ON DELETE SET NULL,
  passed boolean DEFAULT false,
  risk_score numeric DEFAULT 0,
  evaluation_summary text,
  required_mitigation text,
  evaluated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intervention_human_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_key text UNIQUE NOT NULL,
  simulation_id uuid REFERENCES public.intervention_simulations(id) ON DELETE CASCADE,
  response_plan_id uuid REFERENCES public.coordination_response_plans(id) ON DELETE SET NULL,
  review_priority text DEFAULT 'medium',
  review_status text DEFAULT 'open',
  review_reason text,
  assigned_role text DEFAULT 'senior_analyst',
  reviewer_id uuid,
  reviewer_decision text,
  reviewer_notes text,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_intervention_approval_status
ON public.intervention_approval_workflows(approval_status, safety_rating, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intervention_human_review_status
ON public.intervention_human_review_queue(review_status, review_priority, created_at DESC);

INSERT INTO public.intervention_safety_policies(policy_key,policy_name,policy_domain,policy_type,severity,rule_config,requires_human_approval)
VALUES
('no-autonomous-high-impact-action','No autonomous high-impact intervention','all','human_approval_gate','critical',jsonb_build_object('min_risk_reduction_requiring_approval',35,'min_geopolitical_risk_requiring_approval',50),true),
('evidence-quality-threshold','Evidence quality threshold','all','evidence_gate','high',jsonb_build_object('minimum_confidence_score',65,'minimum_evidence_score',60),true),
('geopolitical-sensitivity-review','Geopolitical sensitivity review','governance','risk_gate','critical',jsonb_build_object('geopolitical_risk_threshold',60),true),
('humanitarian-harm-avoidance','Humanitarian harm avoidance','humanitarian','safety_gate','critical',jsonb_build_object('requires_humanitarian_review',true),true),
('economic-disruption-review','Economic disruption review','economy','risk_gate','high',jsonb_build_object('cost_score_threshold',75),true)
ON CONFLICT(policy_key) DO UPDATE SET
  rule_config = EXCLUDED.rule_config,
  enabled = true,
  updated_at = now();

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
  v_summary text;
  v_count integer := 0;
  v_failed integer := 0;
BEGIN
  SELECT * INTO sim FROM public.intervention_simulations WHERE id = p_simulation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_simulation');
  END IF;

  FOR pol IN SELECT * FROM public.intervention_safety_policies WHERE enabled = true LOOP
    v_risk := 0;
    v_passed := true;
    v_summary := 'Policy passed.';

    IF pol.policy_key = 'no-autonomous-high-impact-action' THEN
      v_risk := GREATEST(COALESCE(sim.risk_reduction_score,0), COALESCE(sim.geopolitical_risk,0));
      v_passed := COALESCE(sim.risk_reduction_score,0) < 35 AND COALESCE(sim.geopolitical_risk,0) < 50;
      v_summary := CASE WHEN v_passed THEN 'Autonomous threshold not exceeded.' ELSE 'High-impact intervention requires human approval.' END;
    ELSIF pol.policy_key = 'evidence-quality-threshold' THEN
      v_risk := 100 - COALESCE(sim.confidence_score,0);
      v_passed := COALESCE(sim.confidence_score,0) >= 65;
      v_summary := CASE WHEN v_passed THEN 'Confidence threshold satisfied.' ELSE 'Insufficient confidence for unsupervised recommendation.' END;
    ELSIF pol.policy_key = 'geopolitical-sensitivity-review' THEN
      v_risk := COALESCE(sim.geopolitical_risk,0);
      v_passed := COALESCE(sim.geopolitical_risk,0) < 60;
      v_summary := CASE WHEN v_passed THEN 'Geopolitical risk under review threshold.' ELSE 'Geopolitical sensitivity requires review.' END;
    ELSIF pol.policy_key = 'economic-disruption-review' THEN
      v_risk := COALESCE(sim.intervention_cost_score,0);
      v_passed := COALESCE(sim.intervention_cost_score,0) < 75;
      v_summary := CASE WHEN v_passed THEN 'Cost risk under review threshold.' ELSE 'High cost intervention requires review.' END;
    ELSE
      v_risk := 50;
      v_passed := true;
    END IF;

    INSERT INTO public.intervention_safety_evaluations(
      evaluation_key,simulation_id,policy_key,passed,risk_score,evaluation_summary,required_mitigation,evaluated_at
    ) VALUES (
      md5(p_simulation_id::text || '|' || pol.policy_key),
      p_simulation_id,
      pol.policy_key,
      v_passed,
      v_risk,
      v_summary,
      CASE WHEN v_passed THEN NULL ELSE 'Human approval and evidence review required before operational recommendation.' END,
      now()
    )
    ON CONFLICT(evaluation_key) DO UPDATE SET
      passed = EXCLUDED.passed,
      risk_score = EXCLUDED.risk_score,
      evaluation_summary = EXCLUDED.evaluation_summary,
      required_mitigation = EXCLUDED.required_mitigation,
      evaluated_at = now();

    v_count := v_count + 1;
    IF NOT v_passed THEN v_failed := v_failed + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('status','success','policies_evaluated',v_count,'failed_policies',v_failed);
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
  v_failed integer;
  v_key text;
  v_safety text;
BEGIN
  SELECT * INTO sim FROM public.intervention_simulations WHERE id = p_simulation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_simulation');
  END IF;

  v_eval := public.evaluate_intervention_safety(p_simulation_id);
  v_failed := COALESCE((v_eval->>'failed_policies')::integer,0);
  v_safety := CASE WHEN v_failed = 0 THEN 'cleared' WHEN v_failed <= 2 THEN 'requires_review' ELSE 'high_risk' END;
  v_key := md5(p_simulation_id::text || '|approval');

  INSERT INTO public.intervention_approval_workflows(
    workflow_key,simulation_id,response_plan_id,approval_status,safety_rating,evidence_gate_status,
    required_approver_role,approval_reason,created_at,updated_at
  ) VALUES (
    v_key,p_simulation_id,p_response_plan_id,
    CASE WHEN v_failed = 0 AND COALESCE(sim.confidence_score,0) >= 80 THEN 'eligible_for_approval' ELSE 'pending_review' END,
    v_safety,
    CASE WHEN COALESCE(sim.confidence_score,0) >= 65 THEN 'passed' ELSE 'failed' END,
    CASE WHEN v_safety = 'high_risk' THEN 'executive_reviewer' ELSE 'senior_analyst' END,
    'Workflow generated from safety/evidence gates.',
    now(),now()
  )
  ON CONFLICT(workflow_key) DO UPDATE SET
    approval_status = EXCLUDED.approval_status,
    safety_rating = EXCLUDED.safety_rating,
    evidence_gate_status = EXCLUDED.evidence_gate_status,
    required_approver_role = EXCLUDED.required_approver_role,
    updated_at = now();

  IF v_failed > 0 OR COALESCE(sim.confidence_score,0) < 80 THEN
    INSERT INTO public.intervention_human_review_queue(
      review_key,simulation_id,response_plan_id,review_priority,review_status,review_reason,assigned_role,created_at
    ) VALUES (
      md5(p_simulation_id::text || '|human_review'),
      p_simulation_id,
      p_response_plan_id,
      CASE WHEN v_safety = 'high_risk' THEN 'critical' WHEN v_safety = 'requires_review' THEN 'high' ELSE 'medium' END,
      'open',
      'Intervention requires human review due to safety, confidence, or geopolitical constraints.',
      CASE WHEN v_safety = 'high_risk' THEN 'executive_reviewer' ELSE 'senior_analyst' END,
      now()
    )
    ON CONFLICT(review_key) DO UPDATE SET
      review_priority = EXCLUDED.review_priority,
      review_status = CASE WHEN public.intervention_human_review_queue.review_status = 'closed' THEN 'open' ELSE public.intervention_human_review_queue.review_status END,
      review_reason = EXCLUDED.review_reason;
  END IF;

  RETURN jsonb_build_object('status','success','workflow_key',v_key,'safety_rating',v_safety,'failed_policies',v_failed);
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
    SELECT s.*
    FROM public.intervention_simulations s
    LEFT JOIN public.intervention_approval_workflows w ON w.simulation_id = s.id
    WHERE w.id IS NULL
    ORDER BY s.risk_reduction_score DESC, s.confidence_score DESC
    LIMIT 100
  LOOP
    PERFORM public.create_intervention_approval_workflow(rec.id, NULL);
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('intervention-governance-cycle','success','workflows_created=' || v_count);

  RETURN jsonb_build_object('status','success','workflows_created',v_count);
END;
$$;

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
  w.created_at
FROM public.intervention_approval_workflows w
JOIN public.intervention_simulations s ON s.id = w.simulation_id
ORDER BY
  CASE w.safety_rating WHEN 'high_risk' THEN 1 WHEN 'requires_review' THEN 2 ELSE 3 END,
  s.risk_reduction_score DESC;

CREATE OR REPLACE VIEW public.intervention_human_review_command_view AS
SELECT
  q.review_priority,
  q.review_status,
  s.simulation_name,
  q.review_reason,
  q.assigned_role,
  q.reviewer_decision,
  q.created_at,
  q.reviewed_at
FROM public.intervention_human_review_queue q
JOIN public.intervention_simulations s ON s.id = q.simulation_id
ORDER BY
  CASE q.review_priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
  q.created_at DESC;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'intervention-governance-safety-layer',
  'success',
  'intervention safety policies, approval workflows, human review queue, and governance cycle initialized'
);
