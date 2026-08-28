-- AICIS multi-agent coordination epistemic truth floor v1
--
-- Agent identity/capability configuration is not epistemic authority. The legacy
-- layer seeded confidence/trust/priority numbers, inferred escalation from those
-- seeds, wrote generic strings as evidence, and declared consensus from agent count.
-- Preserve the coordination concept, but require explicit evidence and recorded
-- positions before any future arbitration can claim agreement.

-- -----------------------------------------------------------------------------
-- 1. Agent registry: role/capability catalogue, not confidence authority.
-- -----------------------------------------------------------------------------
ALTER TABLE public.planetary_operational_agents
  ALTER COLUMN agent_role DROP DEFAULT,
  ALTER COLUMN operational_scope DROP DEFAULT,
  ALTER COLUMN coordination_priority DROP DEFAULT,
  ALTER COLUMN confidence_weight DROP DEFAULT,
  ALTER COLUMN escalation_threshold DROP DEFAULT,
  ALTER COLUMN autonomy_level DROP DEFAULT,
  ALTER COLUMN governance_profile DROP DEFAULT,
  ALTER COLUMN active DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_operational_scope text,
  ADD COLUMN IF NOT EXISTS reported_coordination_priority numeric,
  ADD COLUMN IF NOT EXISTS coordination_priority_semantics text,
  ADD COLUMN IF NOT EXISTS reported_confidence_weight numeric,
  ADD COLUMN IF NOT EXISTS confidence_weight_semantics text,
  ADD COLUMN IF NOT EXISTS reported_escalation_threshold numeric,
  ADD COLUMN IF NOT EXISTS escalation_threshold_semantics text,
  ADD COLUMN IF NOT EXISTS registry_semantics text,
  ADD COLUMN IF NOT EXISTS capability_evidence_status text NOT NULL DEFAULT 'declared_only'
    CHECK (capability_evidence_status IN ('declared_only','evaluated','suspended'));

UPDATE public.planetary_operational_agents
SET
  reported_operational_scope = COALESCE(reported_operational_scope, operational_scope),
  operational_scope = NULL,
  reported_coordination_priority = COALESCE(reported_coordination_priority, coordination_priority),
  coordination_priority = NULL,
  coordination_priority_semantics = COALESCE(coordination_priority_semantics, 'legacy_seeded_agent_priority_policy_unverified'),
  reported_confidence_weight = COALESCE(reported_confidence_weight, confidence_weight),
  confidence_weight = NULL,
  confidence_weight_semantics = COALESCE(confidence_weight_semantics, 'withheld_agent_identity_not_epistemic_confidence'),
  reported_escalation_threshold = COALESCE(reported_escalation_threshold, escalation_threshold),
  escalation_threshold = NULL,
  escalation_threshold_semantics = COALESCE(escalation_threshold_semantics, 'legacy_seeded_escalation_policy_unverified'),
  registry_semantics = COALESCE(registry_semantics, 'declared_capability_registry_not_runtime_authority'),
  capability_evidence_status = 'declared_only',
  active = false;

-- -----------------------------------------------------------------------------
-- 2. Coordination mesh: declared communication topology is not trust evidence.
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_coordination_mesh
  ALTER COLUMN coordination_type DROP DEFAULT,
  ALTER COLUMN trust_weight DROP DEFAULT,
  ALTER COLUMN coordination_frequency DROP DEFAULT,
  ALTER COLUMN active DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_trust_weight numeric,
  ADD COLUMN IF NOT EXISTS trust_weight_semantics text,
  ADD COLUMN IF NOT EXISTS mesh_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'declared_only';

UPDATE public.agent_coordination_mesh
SET
  reported_trust_weight = COALESCE(reported_trust_weight, trust_weight),
  trust_weight = NULL,
  trust_weight_semantics = COALESCE(trust_weight_semantics, 'withheld_declared_link_not_empirical_trust'),
  mesh_semantics = COALESCE(mesh_semantics, 'declared_coordination_route_not_observed_reliability'),
  evidence_status = 'declared_only',
  active = false;

-- -----------------------------------------------------------------------------
-- 3. Legacy tasks: missing policy/evidence must not imply queued/safe/no-review.
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_coordination_tasks
  ALTER COLUMN coordination_status DROP DEFAULT,
  ALTER COLUMN operational_priority DROP DEFAULT,
  ALTER COLUMN confidence_requirement DROP DEFAULT,
  ALTER COLUMN escalation_required DROP DEFAULT,
  ALTER COLUMN governance_review_required DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_operational_priority text,
  ADD COLUMN IF NOT EXISTS priority_semantics text,
  ADD COLUMN IF NOT EXISTS reported_confidence_requirement numeric,
  ADD COLUMN IF NOT EXISTS confidence_requirement_semantics text,
  ADD COLUMN IF NOT EXISTS source_evidence_record_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS task_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.agent_coordination_tasks
SET
  reported_operational_priority = COALESCE(reported_operational_priority, operational_priority),
  operational_priority = NULL,
  priority_semantics = COALESCE(priority_semantics, 'legacy_task_priority_policy_unverified'),
  reported_confidence_requirement = COALESCE(reported_confidence_requirement, confidence_requirement),
  confidence_requirement = NULL,
  confidence_requirement_semantics = COALESCE(confidence_requirement_semantics, 'withheld_not_a_calibrated_confidence_gate'),
  coordination_status = 'legacy_quarantined',
  escalation_required = true,
  governance_review_required = true,
  source_evidence_record_keys = '{}',
  task_semantics = COALESCE(task_semantics, 'legacy_agent_task_without_evidence_contract'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 4. Shared cognition + consensus legacy outputs.
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_shared_cognition_memory
  ALTER COLUMN confidence_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS cognition_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.agent_shared_cognition_memory
SET
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  confidence_score = NULL,
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_not_established_as_epistemic_confidence'),
  cognition_semantics = COALESCE(cognition_semantics, 'legacy_generated_agent_cognition_without_exact_evidence_lineage'),
  evidence_status = 'legacy_unverified';

ALTER TABLE public.agent_consensus_arbitration
  ALTER COLUMN consensus_status DROP DEFAULT,
  ALTER COLUMN consensus_confidence DROP DEFAULT,
  ALTER COLUMN escalation_required DROP DEFAULT,
  ALTER COLUMN human_review_required DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_consensus_confidence numeric,
  ADD COLUMN IF NOT EXISTS consensus_confidence_semantics text,
  ADD COLUMN IF NOT EXISTS arbitration_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.agent_consensus_arbitration
SET
  reported_consensus_confidence = COALESCE(reported_consensus_confidence, consensus_confidence),
  consensus_confidence = NULL,
  consensus_status = 'legacy_quarantined',
  consensus_confidence_semantics = COALESCE(consensus_confidence_semantics, 'withheld_agent_count_not_consensus_confidence'),
  arbitration_semantics = COALESCE(arbitration_semantics, 'legacy_agent_count_consensus_not_position_arbitration'),
  evidence_status = 'legacy_unverified',
  escalation_required = true,
  human_review_required = true,
  final_resolution = NULL,
  resolved_at = NULL;

-- -----------------------------------------------------------------------------
-- 5. Governed append-only agent cognition records.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_cognition_records_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cognition_key text NOT NULL,
  originating_agent_key text REFERENCES public.planetary_operational_agents(agent_key) ON DELETE SET NULL,
  cognition_type text NOT NULL,
  source_domain text,
  cognition_summary text NOT NULL,
  epistemic_status text NOT NULL
    CHECK (epistemic_status IN ('observed','derived','inferred','hypothesized','contradicted','retracted')),
  supporting_evidence_record_keys text[] NOT NULL,
  confidence_score numeric,
  confidence_semantics text,
  model_or_method text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(supporting_evidence_record_keys) > 0),
  CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  CHECK (confidence_score IS NULL OR confidence_semantics IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_agent_cognition_records_agent_time_v1
ON public.agent_cognition_records_v1(originating_agent_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_cognition_records_domain_time_v1
ON public.agent_cognition_records_v1(source_domain, created_at DESC);

CREATE OR REPLACE FUNCTION public.block_agent_cognition_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'agent_cognition_records_v1 is append-only; add contradiction/retraction cognition instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_agent_cognition_mutation_v1 ON public.agent_cognition_records_v1;
CREATE TRIGGER trg_block_agent_cognition_mutation_v1
BEFORE UPDATE OR DELETE ON public.agent_cognition_records_v1
FOR EACH ROW EXECUTE FUNCTION public.block_agent_cognition_mutation_v1();

-- -----------------------------------------------------------------------------
-- 6. Explicit agent positions. Consensus can only be discussed from positions,
-- never from the number of participating agent names.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_position_records_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_key text NOT NULL,
  agent_key text REFERENCES public.planetary_operational_agents(agent_key) ON DELETE SET NULL,
  position_status text NOT NULL
    CHECK (position_status IN ('support','oppose','abstain','insufficient_evidence')),
  position_summary text NOT NULL,
  supporting_evidence_record_keys text[] NOT NULL DEFAULT '{}',
  confidence_score numeric,
  confidence_semantics text,
  model_or_method text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  CHECK (confidence_score IS NULL OR confidence_semantics IS NOT NULL),
  CHECK (position_status IN ('abstain','insufficient_evidence') OR cardinality(supporting_evidence_record_keys) > 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_position_topic_time_v1
ON public.agent_position_records_v1(topic_key, created_at DESC);

CREATE OR REPLACE FUNCTION public.block_agent_position_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'agent_position_records_v1 is append-only; record a new position instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_agent_position_mutation_v1 ON public.agent_position_records_v1;
CREATE TRIGGER trg_block_agent_position_mutation_v1
BEFORE UPDATE OR DELETE ON public.agent_position_records_v1
FOR EACH ROW EXECUTE FUNCTION public.block_agent_position_mutation_v1();

-- -----------------------------------------------------------------------------
-- 7. Governed work-request creator. Priority is explicit policy metadata and the
-- task always requires governance review unless a future approved policy says otherwise.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_governed_agent_coordination_task_v1(
  p_task_type text,
  p_source_event text,
  p_source_domain text,
  p_assigned_agent_key text,
  p_source_evidence_record_keys text[],
  p_operational_priority text DEFAULT NULL,
  p_priority_semantics text DEFAULT NULL,
  p_task_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_key text;
BEGIN
  IF p_task_type IS NULL OR btrim(p_task_type) = '' THEN
    RAISE EXCEPTION 'task_type is required';
  END IF;
  IF p_source_event IS NULL OR btrim(p_source_event) = '' THEN
    RAISE EXCEPTION 'source_event is required';
  END IF;
  IF p_assigned_agent_key IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.planetary_operational_agents WHERE agent_key = p_assigned_agent_key
  ) THEN
    RAISE EXCEPTION 'known assigned_agent_key is required';
  END IF;
  IF p_source_evidence_record_keys IS NULL OR cardinality(p_source_evidence_record_keys) = 0 THEN
    RAISE EXCEPTION 'at least one source evidence record key is required';
  END IF;
  IF p_operational_priority IS NOT NULL AND (p_priority_semantics IS NULL OR btrim(p_priority_semantics) = '') THEN
    RAISE EXCEPTION 'priority_semantics is required when operational_priority is supplied';
  END IF;

  v_key := md5(
    p_task_type || '|' || p_source_event || '|' || p_assigned_agent_key || '|' ||
    array_to_string(p_source_evidence_record_keys, ',')
  );

  INSERT INTO public.agent_coordination_tasks(
    task_key,
    task_type,
    source_event,
    source_domain,
    assigned_agent_key,
    coordination_status,
    operational_priority,
    priority_semantics,
    confidence_requirement,
    confidence_requirement_semantics,
    escalation_required,
    governance_review_required,
    source_evidence_record_keys,
    task_payload,
    task_semantics,
    evidence_status,
    created_at,
    updated_at
  ) VALUES (
    v_key,
    p_task_type,
    p_source_event,
    p_source_domain,
    p_assigned_agent_key,
    'queued_for_review',
    p_operational_priority,
    p_priority_semantics,
    NULL,
    'no_epistemic_confidence_gate',
    true,
    true,
    p_source_evidence_record_keys,
    COALESCE(p_task_payload,'{}'::jsonb),
    'governed_evidence_linked_work_request_v1',
    'evidence_linked',
    now(),
    now()
  )
  ON CONFLICT(task_key) DO UPDATE SET
    coordination_status = CASE
      WHEN public.agent_coordination_tasks.coordination_status = 'completed'
        THEN public.agent_coordination_tasks.coordination_status
      ELSE 'queued_for_review'
    END,
    operational_priority = EXCLUDED.operational_priority,
    priority_semantics = EXCLUDED.priority_semantics,
    governance_review_required = true,
    escalation_required = true,
    source_evidence_record_keys = EXCLUDED.source_evidence_record_keys,
    task_payload = EXCLUDED.task_payload,
    task_semantics = EXCLUDED.task_semantics,
    evidence_status = EXCLUDED.evidence_status,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Legacy autonomous-looking functions become explicit abstention stubs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delegate_agent_coordination_task(
  p_task_type text,
  p_source_event text,
  p_source_domain text,
  p_priority text DEFAULT 'medium'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','explicit_agent_assignment_and_evidence_keys_required',
    'task_type',p_task_type,
    'source_event',p_source_event,
    'source_domain',p_source_domain,
    'reported_priority',p_priority
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.propagate_agent_cognition(
  p_originating_agent text,
  p_cognition_type text,
  p_source_domain text,
  p_summary text,
  p_confidence numeric DEFAULT 70
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','exact_supporting_evidence_and_epistemic_status_required',
    'originating_agent',p_originating_agent,
    'cognition_type',p_cognition_type,
    'source_domain',p_source_domain,
    'legacy_confidence_argument_ignored',p_confidence IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_agent_consensus(
  p_topic text,
  p_agents jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','recorded_agent_positions_required_for_arbitration',
    'topic',p_topic,
    'participant_names_do_not_establish_consensus',true,
    'reported_agents',COALESCE(p_agents,'[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_multi_agent_coordination_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'multi-agent-coordination-cycle',
    'skipped',
    'quarantined: automatic delegation/cognition/consensus disabled; governed evidence-linked work requests remain available'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'automatic_delegation',false,
    'automatic_cognition_propagation',false,
    'automatic_consensus',false,
    'governed_work_queue_available',true
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Security and compatibility views.
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_cognition_records_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_position_records_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_cognition_records_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agent_position_records_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.agent_cognition_records_v1 TO service_role;
GRANT SELECT, INSERT ON TABLE public.agent_position_records_v1 TO service_role;

CREATE OR REPLACE VIEW public.operational_agent_command_view AS
SELECT
  agent_name,
  agent_domain,
  agent_role,
  operational_scope,
  autonomy_level,
  governance_profile,
  coordination_priority,
  confidence_weight,
  capability_evidence_status,
  registry_semantics,
  active,
  created_at
FROM public.planetary_operational_agents
ORDER BY agent_name;

CREATE OR REPLACE VIEW public.agent_task_command_view AS
SELECT
  task_type,
  source_event,
  source_domain,
  assigned_agent_key,
  coordination_status,
  operational_priority,
  priority_semantics,
  escalation_required,
  governance_review_required,
  evidence_status,
  created_at,
  completed_at
FROM public.agent_coordination_tasks
ORDER BY created_at DESC;

CREATE OR REPLACE VIEW public.agent_cognition_command_view AS
SELECT
  originating_agent,
  cognition_type,
  source_domain,
  cognition_summary,
  confidence_score,
  confidence_semantics,
  evidence_status,
  created_at
FROM public.agent_shared_cognition_memory
ORDER BY confidence_score DESC NULLS LAST, created_at DESC;

CREATE OR REPLACE VIEW public.agent_consensus_command_view AS
SELECT
  arbitration_topic,
  consensus_status,
  consensus_confidence,
  consensus_confidence_semantics,
  arbitration_semantics,
  evidence_status,
  escalation_required,
  human_review_required,
  created_at,
  resolved_at
FROM public.agent_consensus_arbitration
ORDER BY consensus_confidence DESC NULLS LAST, created_at DESC;

REVOKE ALL ON FUNCTION public.create_governed_agent_coordination_task_v1(text,text,text,text,text[],text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delegate_agent_coordination_task(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propagate_agent_cognition(text,text,text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_agent_consensus(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_multi_agent_coordination_cycle() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_governed_agent_coordination_task_v1(text,text,text,text,text[],text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delegate_agent_coordination_task(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.propagate_agent_cognition(text,text,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_agent_consensus(text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_multi_agent_coordination_cycle() TO service_role;

COMMENT ON TABLE public.planetary_operational_agents IS
  'Declared agent role/capability registry. Agent identity never supplies epistemic confidence or operational authority by itself.';
COMMENT ON TABLE public.agent_cognition_records_v1 IS
  'Append-only evidence-linked agent cognition records with explicit epistemic status; no generic evidence strings or default confidence.';
COMMENT ON TABLE public.agent_position_records_v1 IS
  'Append-only explicit positions for future arbitration. Participant count alone can never establish consensus.';
