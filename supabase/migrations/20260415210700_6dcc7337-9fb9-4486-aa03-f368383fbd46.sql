
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
      UPDATE adi_decisions SET
        status = 'approved',
        approved_at = now(),
        review_notes = 'Auto-approved: confidence=' || ROUND(rec.confidence::numeric, 2) || ', severity=' || rec.severity_score
      WHERE id = rec.id;
      v_auto_approved := v_auto_approved + 1;
    ELSIF rec.severity_score >= 8 THEN
      UPDATE adi_decisions SET
        status = 'needs_review',
        review_notes = 'Critical severity (' || rec.severity_score || ') requires human review'
      WHERE id = rec.id;
      v_needs_review := v_needs_review + 1;
    ELSE
      UPDATE adi_decisions SET
        status = 'needs_review',
        review_notes = 'Confidence below threshold (' || ROUND(rec.confidence::numeric, 2) || '), needs human review'
      WHERE id = rec.id;
      v_needs_review := v_needs_review + 1;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_bridged FROM decision_outcome_log
    WHERE created_at >= now() - interval '5 minutes' AND action_type = 'decision_pipeline';

  RETURN jsonb_build_object(
    'auto_approved', v_auto_approved,
    'needs_review', v_needs_review,
    'bridged_to_outcomes', v_bridged,
    'processed_at', now()
  );
END;
$$;
