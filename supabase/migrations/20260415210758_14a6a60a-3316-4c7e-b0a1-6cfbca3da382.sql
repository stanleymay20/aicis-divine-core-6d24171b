
-- Fix bridge function with all required columns
CREATE OR REPLACE FUNCTION public.bridge_decision_to_outcome(_decision_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_dec adi_decisions%ROWTYPE;
  v_outcome_id uuid;
BEGIN
  SELECT * INTO v_dec FROM adi_decisions WHERE id = _decision_id;
  IF v_dec IS NULL THEN RAISE EXCEPTION 'Decision not found'; END IF;
  IF v_dec.status != 'approved' THEN RAISE EXCEPTION 'Decision must be approved first'; END IF;

  IF EXISTS (SELECT 1 FROM decision_outcome_log WHERE decision_id = _decision_id) THEN
    SELECT id INTO v_outcome_id FROM decision_outcome_log WHERE decision_id = _decision_id LIMIT 1;
    RETURN v_outcome_id;
  END IF;

  INSERT INTO decision_outcome_log (
    decision_id, signal_id, signal_title, signal_date, domain, signal_confidence,
    recommendation_accepted, action_type, status, evidence_type,
    execution_status, review_sla_hours
  ) VALUES (
    v_dec.id,
    COALESCE(v_dec.signal_id::text, v_dec.id::text),
    v_dec.signal_summary,
    COALESCE(v_dec.created_at::date, CURRENT_DATE),
    v_dec.domain,
    v_dec.confidence,
    true,
    'decision_pipeline',
    'open',
    'decision_intelligence',
    'not_started',
    CASE WHEN v_dec.severity_score >= 8 THEN 4
         WHEN v_dec.severity_score >= 5 THEN 12
         ELSE 24 END
  )
  RETURNING id INTO v_outcome_id;

  RETURN v_outcome_id;
END;
$$;

-- Fix model_registry status constraint to allow 'active'
ALTER TABLE model_registry DROP CONSTRAINT IF EXISTS model_registry_status_check;
ALTER TABLE model_registry ADD CONSTRAINT model_registry_status_check 
  CHECK (status = ANY (ARRAY['current','active','superseded','deprecated']));
