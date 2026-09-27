CREATE TABLE IF NOT EXISTS public.telemetry_event_bus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text UNIQUE NOT NULL,
  event_type text NOT NULL,
  source_connector_key text,
  source_domain text,
  source_region text,
  shard_key integer DEFAULT 0,
  priority_score numeric,
  priority_semantics text,
  reported_legacy_priority_score numeric,
  epistemic_status text NOT NULL DEFAULT 'operational_event',
  source_observation_id uuid,
  event_status text DEFAULT 'queued',
  payload jsonb DEFAULT '{}'::jsonb,
  lineage jsonb DEFAULT '{}'::jsonb,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 5,
  available_at timestamptz DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.telemetry_event_bus TO authenticated;
GRANT ALL ON public.telemetry_event_bus TO service_role;
ALTER TABLE public.telemetry_event_bus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read telemetry events" ON public.telemetry_event_bus FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.intervention_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_key text UNIQUE NOT NULL,
  source_propagation_event_id uuid,
  strategy_key text,
  simulation_name text,
  simulation_status text,
  baseline_risk_score numeric,
  projected_risk_after_intervention numeric,
  risk_reduction_score numeric,
  projected_operational_stability numeric,
  projected_economic_impact numeric,
  projected_humanitarian_impact numeric,
  confidence_score numeric,
  intervention_cost_score numeric,
  execution_feasibility numeric,
  geopolitical_risk numeric,
  simulation_semantics text,
  risk_semantics text,
  confidence_semantics text,
  feasibility_semantics text,
  evidence_status text NOT NULL DEFAULT 'insufficient_evidence'
    CHECK (evidence_status IN ('legacy_unverified','insufficient_evidence','evaluated')),
  simulation_summary text,
  simulation_path jsonb DEFAULT '[]'::jsonb,
  intervention_recommendations jsonb DEFAULT '[]'::jsonb,
  outcome_projection jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.intervention_simulations TO authenticated;
GRANT ALL ON public.intervention_simulations TO service_role;
ALTER TABLE public.intervention_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read intervention simulations" ON public.intervention_simulations FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.intervention_approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key text UNIQUE NOT NULL,
  simulation_id uuid REFERENCES public.intervention_simulations(id) ON DELETE CASCADE,
  response_plan_id uuid,
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
GRANT SELECT ON public.intervention_approval_workflows TO authenticated;
GRANT ALL ON public.intervention_approval_workflows TO service_role;
ALTER TABLE public.intervention_approval_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read intervention approvals" ON public.intervention_approval_workflows FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE VIEW public.telemetry_backbone_command_view WITH (security_invoker = true) AS
SELECT event_status, epistemic_status, source_domain, source_region, shard_key,
  COUNT(*) AS event_count,
  ROUND(AVG(priority_score) FILTER (WHERE priority_score IS NOT NULL AND priority_semantics IS NOT NULL
    AND priority_semantics NOT LIKE '%legacy%' AND priority_semantics NOT LIKE '%unverified%'
    AND priority_semantics NOT LIKE '%unknown%' AND priority_semantics NOT LIKE '%withheld%')::numeric, 2) AS avg_priority,
  CASE WHEN COUNT(priority_score) FILTER (WHERE priority_score IS NOT NULL AND priority_semantics IS NOT NULL
    AND priority_semantics NOT LIKE '%legacy%' AND priority_semantics NOT LIKE '%unverified%'
    AND priority_semantics NOT LIKE '%unknown%' AND priority_semantics NOT LIKE '%withheld%') = 0
    THEN 'not_assessed' ELSE 'mean_governed_operational_queue_priority_not_probability' END AS avg_priority_semantics,
  MIN(created_at) AS oldest_event,
  MAX(created_at) AS newest_event,
  MAX(created_at) AS generated_at
FROM public.telemetry_event_bus
GROUP BY event_status, epistemic_status, source_domain, source_region, shard_key;
GRANT SELECT ON public.telemetry_backbone_command_view TO authenticated;

CREATE OR REPLACE VIEW public.intervention_governance_command_view WITH (security_invoker = true) AS
SELECT w.workflow_key, s.simulation_name, w.approval_status, w.safety_rating, w.evidence_gate_status,
  w.required_approver_role, s.risk_reduction_score, s.confidence_score, s.geopolitical_risk,
  s.evidence_status AS simulation_evidence_status, w.created_at, w.created_at AS generated_at
FROM public.intervention_approval_workflows w
JOIN public.intervention_simulations s ON s.id = w.simulation_id;
GRANT SELECT ON public.intervention_governance_command_view TO authenticated;