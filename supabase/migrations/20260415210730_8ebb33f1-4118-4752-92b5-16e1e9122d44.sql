
-- Fix bridge function to include signal_id
CREATE OR REPLACE FUNCTION public.bridge_decision_to_outcome(_decision_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_dec adi_decisions%ROWTYPE;
  v_outcome_id uuid;
  v_signal_id uuid;
BEGIN
  SELECT * INTO v_dec FROM adi_decisions WHERE id = _decision_id;
  IF v_dec IS NULL THEN RAISE EXCEPTION 'Decision not found'; END IF;
  IF v_dec.status != 'approved' THEN RAISE EXCEPTION 'Decision must be approved first'; END IF;

  IF EXISTS (SELECT 1 FROM decision_outcome_log WHERE decision_id = _decision_id) THEN
    SELECT id INTO v_outcome_id FROM decision_outcome_log WHERE decision_id = _decision_id LIMIT 1;
    RETURN v_outcome_id;
  END IF;

  -- Use decision's signal_id, or generate one
  v_signal_id := COALESCE(v_dec.signal_id, gen_random_uuid());

  INSERT INTO decision_outcome_log (
    decision_id, signal_id, signal_title, domain, signal_confidence,
    recommendation_accepted, action_type,
    execution_status, review_sla_hours
  ) VALUES (
    v_dec.id,
    v_signal_id,
    v_dec.signal_summary,
    v_dec.domain,
    v_dec.confidence,
    true,
    'decision_pipeline',
    'not_started',
    CASE WHEN v_dec.severity_score >= 8 THEN 4
         WHEN v_dec.severity_score >= 5 THEN 12
         ELSE 24 END
  )
  RETURNING id INTO v_outcome_id;

  RETURN v_outcome_id;
END;
$$;

-- Update model_registry constraint to include 'champion'
ALTER TABLE model_registry DROP CONSTRAINT model_registry_model_status_check;
ALTER TABLE model_registry ADD CONSTRAINT model_registry_model_status_check 
  CHECK (model_status = ANY (ARRAY['shadow','challenger','active','champion','deprecated']));
