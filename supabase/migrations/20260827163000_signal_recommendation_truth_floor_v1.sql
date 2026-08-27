-- AICIS signal recommendation truth floor v1
-- Recommendation existence is an advisory workflow artifact, not a probability.
-- Missing source evidence must never become evidence_count=1, and an upstream
-- signal screen must not be relabeled as recommendation confidence.

ALTER TABLE public.signal_action_recommendations
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN evidence_count DROP DEFAULT,
  ALTER COLUMN evidence_count DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_count_semantics text,
  ADD COLUMN IF NOT EXISTS input_signal_score numeric CHECK (
    input_signal_score IS NULL OR (input_signal_score >= 0 AND input_signal_score <= 100)
  ),
  ADD COLUMN IF NOT EXISTS input_signal_score_semantics text,
  ADD COLUMN IF NOT EXISTS source_identifier_count integer CHECK (
    source_identifier_count IS NULL OR source_identifier_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS independent_origin_count integer CHECK (
    independent_origin_count IS NULL OR independent_origin_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS source_independence_status text,
  ADD COLUMN IF NOT EXISTS source_independence_semantics text;

UPDATE public.signal_action_recommendations
SET
  confidence_semantics = COALESCE(
    confidence_semantics,
    CASE WHEN confidence IS NOT NULL
      THEN 'legacy_recommendation_confidence_semantics_unverified'
      ELSE NULL END
  ),
  evidence_count_semantics = COALESCE(
    evidence_count_semantics,
    CASE WHEN evidence_count IS NOT NULL
      THEN 'legacy_evidence_count_semantics_unverified'
      ELSE NULL END
  );

CREATE OR REPLACE FUNCTION public.guard_signal_recommendation_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confidence IS NOT NULL
     AND (
       NEW.confidence_semantics IS NULL
       OR btrim(NEW.confidence_semantics) = ''
       OR lower(NEW.confidence_semantics) LIKE '%legacy%'
       OR lower(NEW.confidence_semantics) LIKE '%unverified%'
       OR lower(NEW.confidence_semantics) LIKE '%unknown%'
     ) THEN
    NEW.confidence := NULL;
    NEW.confidence_semantics := 'withheld_unlabeled_recommendation_confidence';
  END IF;

  IF NEW.evidence_count IS NOT NULL THEN
    IF NEW.source_independence_status IS DISTINCT FROM 'established'
       OR NEW.independent_origin_count IS NULL
       OR NEW.evidence_count <> NEW.independent_origin_count THEN
      NEW.source_identifier_count := COALESCE(NEW.source_identifier_count, NEW.evidence_count);
      NEW.evidence_count := NULL;
      NEW.evidence_count_semantics := 'withheld_without_independent_origin_proof';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_signal_recommendation_truth_floor_v1
  ON public.signal_action_recommendations;
CREATE TRIGGER trg_guard_signal_recommendation_truth_floor_v1
BEFORE INSERT OR UPDATE ON public.signal_action_recommendations
FOR EACH ROW EXECUTE FUNCTION public.guard_signal_recommendation_truth_floor_v1();

REVOKE ALL ON FUNCTION public.guard_signal_recommendation_truth_floor_v1() FROM PUBLIC;

COMMENT ON COLUMN public.signal_action_recommendations.confidence IS
  'Nullable calibrated recommendation confidence only if such a quantity is actually established. Advisory generation does not imply confidence.';
COMMENT ON COLUMN public.signal_action_recommendations.evidence_count IS
  'Nullable independent-origin evidence count. Publisher/source identifier counts belong in source_identifier_count.';
COMMENT ON COLUMN public.signal_action_recommendations.input_signal_score IS
  'Upstream signal evidence-screen score retained with its original semantics; it is not recommendation confidence.';
COMMENT ON FUNCTION public.guard_signal_recommendation_truth_floor_v1() IS
  'Fail-closed guard preventing legacy or unlabeled recommendation confidence and source counts from masquerading as decision evidence.';