-- AICIS multi-agent runtime admission guard v1
--
-- A declared agent must not receive operational work until its capability has been
-- explicitly evaluated and activated. Likewise, append-only cognition/position
-- tables must reject unusable confidence semantics even from privileged writers.

CREATE OR REPLACE FUNCTION public.aicis_agent_semantics_unusable_v1(p_semantics text)
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

CREATE OR REPLACE FUNCTION public.guard_agent_cognition_insert_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.originating_agent_key IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.planetary_operational_agents a
    WHERE a.agent_key = NEW.originating_agent_key
      AND a.active IS TRUE
      AND a.capability_evidence_status = 'evaluated'
  ) THEN
    RAISE EXCEPTION 'originating agent must be explicitly evaluated and active';
  END IF;

  IF NEW.confidence_score IS NOT NULL
     AND public.aicis_agent_semantics_unusable_v1(NEW.confidence_semantics) THEN
    RAISE EXCEPTION 'numeric cognition confidence requires usable explicit semantics';
  END IF;

  IF NEW.epistemic_status IN ('derived','inferred','hypothesized')
     AND (NEW.model_or_method IS NULL OR btrim(NEW.model_or_method) = '') THEN
    RAISE EXCEPTION 'derived/inferred/hypothesized cognition requires model_or_method';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_agent_cognition_insert_v1 ON public.agent_cognition_records_v1;
CREATE TRIGGER trg_guard_agent_cognition_insert_v1
BEFORE INSERT ON public.agent_cognition_records_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_agent_cognition_insert_v1();

CREATE OR REPLACE FUNCTION public.guard_agent_position_insert_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.agent_key IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.planetary_operational_agents a
    WHERE a.agent_key = NEW.agent_key
      AND a.active IS TRUE
      AND a.capability_evidence_status = 'evaluated'
  ) THEN
    RAISE EXCEPTION 'position agent must be explicitly evaluated and active';
  END IF;

  IF NEW.confidence_score IS NOT NULL
     AND public.aicis_agent_semantics_unusable_v1(NEW.confidence_semantics) THEN
    RAISE EXCEPTION 'numeric position confidence requires usable explicit semantics';
  END IF;

  IF NEW.position_status IN ('support','oppose')
     AND (NEW.model_or_method IS NULL OR btrim(NEW.model_or_method) = '') THEN
    RAISE EXCEPTION 'support/oppose position requires model_or_method';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_agent_position_insert_v1 ON public.agent_position_records_v1;
CREATE TRIGGER trg_guard_agent_position_insert_v1
BEFORE INSERT ON public.agent_position_records_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_agent_position_insert_v1();

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
    SELECT 1
    FROM public.planetary_operational_agents a
    WHERE a.agent_key = p_assigned_agent_key
      AND a.active IS TRUE
      AND a.capability_evidence_status = 'evaluated'
  ) THEN
    RAISE EXCEPTION 'assigned agent must be explicitly evaluated and active';
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

-- Descriptive arbitration over the latest explicit position per active/evaluated
-- agent. This reports agreement shape only; it never issues truth confidence.
CREATE OR REPLACE FUNCTION public.summarize_agent_positions_v1(p_topic_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (p.agent_key)
      p.agent_key,
      p.position_status,
      p.created_at
    FROM public.agent_position_records_v1 p
    JOIN public.planetary_operational_agents a ON a.agent_key = p.agent_key
    WHERE p.topic_key = p_topic_key
      AND a.active IS TRUE
      AND a.capability_evidence_status = 'evaluated'
    ORDER BY p.agent_key, p.created_at DESC, p.id DESC
  ), counts AS (
    SELECT
      count(*)::integer AS total_positions,
      count(*) FILTER (WHERE position_status = 'support')::integer AS support_count,
      count(*) FILTER (WHERE position_status = 'oppose')::integer AS oppose_count,
      count(*) FILTER (WHERE position_status = 'abstain')::integer AS abstain_count,
      count(*) FILTER (WHERE position_status = 'insufficient_evidence')::integer AS insufficient_evidence_count
    FROM latest
  )
  SELECT jsonb_build_object(
    'topic_key',p_topic_key,
    'total_positions',total_positions,
    'support_count',support_count,
    'oppose_count',oppose_count,
    'abstain_count',abstain_count,
    'insufficient_evidence_count',insufficient_evidence_count,
    'agreement_shape',CASE
      WHEN total_positions = 0 THEN 'no_positions'
      WHEN insufficient_evidence_count > 0 OR abstain_count > 0 THEN 'incomplete'
      WHEN support_count = total_positions THEN 'unanimous_support_position'
      WHEN oppose_count = total_positions THEN 'unanimous_oppose_position'
      WHEN support_count > 0 AND oppose_count > 0 THEN 'divergent_positions'
      ELSE 'mixed_positions'
    END,
    'epistemic_note','position agreement is descriptive and does not establish truth or probability'
  )
  FROM counts;
$$;

REVOKE ALL ON FUNCTION public.aicis_agent_semantics_unusable_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_agent_cognition_insert_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_agent_position_insert_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_governed_agent_coordination_task_v1(text,text,text,text,text[],text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.summarize_agent_positions_v1(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.aicis_agent_semantics_unusable_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_governed_agent_coordination_task_v1(text,text,text,text,text[],text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.summarize_agent_positions_v1(text) TO service_role;
