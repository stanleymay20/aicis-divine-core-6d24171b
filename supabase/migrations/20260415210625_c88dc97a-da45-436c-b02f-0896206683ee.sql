
-- 1. Bridge function: creates outcome log entry from an approved decision
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

  -- Check if already bridged
  IF EXISTS (SELECT 1 FROM decision_outcome_log WHERE decision_id = _decision_id) THEN
    SELECT id INTO v_outcome_id FROM decision_outcome_log WHERE decision_id = _decision_id LIMIT 1;
    RETURN v_outcome_id;
  END IF;

  INSERT INTO decision_outcome_log (
    decision_id, signal_title, domain, signal_confidence,
    recommendation_accepted, action_type,
    execution_status, review_sla_hours
  ) VALUES (
    v_dec.id,
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

-- 2. Trigger: auto-bridge on approval
CREATE OR REPLACE FUNCTION public.on_decision_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'approved') THEN
    PERFORM bridge_decision_to_outcome(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_decision_approved ON adi_decisions;
CREATE TRIGGER trg_decision_approved
AFTER UPDATE OF status ON adi_decisions
FOR EACH ROW
EXECUTE FUNCTION on_decision_approved();

-- 3. Auto-review function: processes pending decisions in batch
CREATE OR REPLACE FUNCTION public.auto_review_decisions(_batch_size int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_auto_approved int := 0;
  v_needs_review int := 0;
  v_bridged int := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, confidence, severity_score
    FROM adi_decisions
    WHERE status = 'pending'
    ORDER BY severity_score DESC, created_at ASC
    LIMIT _batch_size
  LOOP
    IF rec.confidence >= 0.7 AND rec.severity_score <= 7 THEN
      -- Auto-approve high-confidence, non-critical decisions
      UPDATE adi_decisions SET
        status = 'approved',
        approved_at = now(),
        approved_by = 'auto_review',
        review_notes = 'Auto-approved: confidence=' || ROUND(rec.confidence::numeric, 2) || ', severity=' || rec.severity_score
      WHERE id = rec.id;
      v_auto_approved := v_auto_approved + 1;
    ELSIF rec.severity_score >= 8 THEN
      -- Critical decisions need human review
      UPDATE adi_decisions SET
        status = 'needs_review',
        review_notes = 'Critical severity (' || rec.severity_score || ') requires human review'
      WHERE id = rec.id;
      v_needs_review := v_needs_review + 1;
    ELSE
      -- Medium confidence — flag for review
      UPDATE adi_decisions SET
        status = 'needs_review',
        review_notes = 'Confidence below threshold (' || ROUND(rec.confidence::numeric, 2) || '), needs human review'
      WHERE id = rec.id;
      v_needs_review := v_needs_review + 1;
    END IF;
  END LOOP;

  -- Count bridged (created by trigger)
  SELECT COUNT(*) INTO v_bridged FROM decision_outcome_log
    WHERE created_at >= now() - interval '1 minute' AND action_type = 'decision_pipeline';

  RETURN jsonb_build_object(
    'auto_approved', v_auto_approved,
    'needs_review', v_needs_review,
    'bridged_to_outcomes', v_bridged,
    'processed_at', now()
  );
END;
$$;

-- 4. Add decision_id column to decision_outcome_log if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'decision_outcome_log' AND column_name = 'decision_id'
  ) THEN
    ALTER TABLE decision_outcome_log ADD COLUMN decision_id uuid REFERENCES adi_decisions(id);
    CREATE INDEX idx_dol_decision_id ON decision_outcome_log(decision_id);
  END IF;
END $$;
