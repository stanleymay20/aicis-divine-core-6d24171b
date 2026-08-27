-- AICIS causal quantitative-abstention enforcement.
--
-- Defense in depth: if any attached causal-evidence category is present but not
-- quantitatively interpretable under the declared truth-floor semantics, the
-- aggregate causal screen must abstain. A missing numeric component is never
-- allowed to act as an observed zero merely because the formula can still run.

CREATE OR REPLACE FUNCTION public.enforce_causal_assessment_quantitative_truth_floor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.quantitative_evidence_status IN (
    'attached_evidence_unquantified',
    'partial_quantitative_coverage'
  ) THEN
    NEW.causal_score := NULL;
    NEW.confidence := NULL;
    NEW.eligible_for_cascade := false;
    NEW.score_semantics := 'abstained_incomplete_quantitative_evidence';
    NEW.confidence_semantics := 'not_calibrated_no_causal_probability_issued';
  END IF;

  -- A truth-floor-v2 automated assessment cannot promote itself into the
  -- strongest causal-truth label. That requires a separate governed process.
  IF NEW.method = 'aicis-evidence-causal-screen-v2'
     AND NEW.verdict = 'causally-supported' THEN
    NEW.verdict := 'mechanistically-supported';
    NEW.eligible_for_cascade := false;
  END IF;

  -- Any row without a numeric screen score is, by definition, ineligible for
  -- automated cascade propagation.
  IF NEW.causal_score IS NULL THEN
    NEW.eligible_for_cascade := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_causal_assessment_quantitative_truth_floor
  ON public.aicis_causal_assessments;
CREATE TRIGGER trg_enforce_causal_assessment_quantitative_truth_floor
BEFORE INSERT OR UPDATE ON public.aicis_causal_assessments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_causal_assessment_quantitative_truth_floor();

REVOKE ALL ON FUNCTION public.enforce_causal_assessment_quantitative_truth_floor() FROM PUBLIC;

COMMENT ON FUNCTION public.enforce_causal_assessment_quantitative_truth_floor() IS
  'Prevents partially quantified causal evidence from being converted into a numeric causal score or automated cascade eligibility.';
