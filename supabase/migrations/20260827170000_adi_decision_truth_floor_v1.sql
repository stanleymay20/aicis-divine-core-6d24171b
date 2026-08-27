-- AICIS ADI decision truth floor v1
--
-- Historical ADI rows forced absent severity/confidence to numeric zero. External
-- API callers could also cause a fabricated neutral severity. Canonical ADI
-- assessments are now nullable and semantically typed; caller-reported values are
-- preserved separately until a governed assessment establishes them.

ALTER TABLE public.adi_decisions
  ALTER COLUMN severity_score DROP NOT NULL,
  ALTER COLUMN severity_score DROP DEFAULT,
  ALTER COLUMN confidence DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS severity_score_semantics text,
  ADD COLUMN IF NOT EXISTS reported_severity_score numeric CHECK (
    reported_severity_score IS NULL OR (reported_severity_score >= 0 AND reported_severity_score <= 100)
  ),
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS reported_confidence numeric CHECK (
    reported_confidence IS NULL OR (reported_confidence >= 0 AND reported_confidence <= 1)
  ),
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS evidence_semantics text,
  ADD COLUMN IF NOT EXISTS source_snapshot_at timestamptz;

UPDATE public.adi_decisions
SET
  severity_score_semantics = COALESCE(
    severity_score_semantics,
    CASE WHEN severity_score IS NOT NULL THEN 'legacy_severity_score_semantics_unverified' END
  ),
  confidence_semantics = COALESCE(
    confidence_semantics,
    CASE WHEN confidence IS NOT NULL THEN 'legacy_confidence_semantics_unverified' END
  ),
  evidence_status = CASE
    WHEN evidence_status = 'legacy_unknown' THEN 'legacy_unknown'
    ELSE evidence_status
  END,
  evidence_semantics = COALESCE(evidence_semantics, 'legacy_decision_evidence_semantics_unverified');

CREATE OR REPLACE FUNCTION public.guard_adi_decision_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.severity_score IS NOT NULL AND (
    NEW.severity_score_semantics IS NULL
    OR btrim(NEW.severity_score_semantics) = ''
    OR lower(NEW.severity_score_semantics) LIKE '%legacy%'
    OR lower(NEW.severity_score_semantics) LIKE '%unknown%'
    OR lower(NEW.severity_score_semantics) LIKE '%unverified%'
    OR lower(NEW.severity_score_semantics) LIKE '%unlabeled%'
    OR lower(NEW.severity_score_semantics) LIKE '%withheld%'
  ) THEN
    NEW.reported_severity_score := COALESCE(NEW.reported_severity_score, NEW.severity_score);
    NEW.severity_score := NULL;
    NEW.severity_score_semantics := 'withheld_unlabeled_or_unverified_severity_score';
  END IF;

  IF NEW.confidence IS NOT NULL AND (
    NEW.confidence_semantics IS NULL
    OR btrim(NEW.confidence_semantics) = ''
    OR lower(NEW.confidence_semantics) LIKE '%legacy%'
    OR lower(NEW.confidence_semantics) LIKE '%unknown%'
    OR lower(NEW.confidence_semantics) LIKE '%unverified%'
    OR lower(NEW.confidence_semantics) LIKE '%unlabeled%'
    OR lower(NEW.confidence_semantics) LIKE '%withheld%'
  ) THEN
    NEW.reported_confidence := COALESCE(NEW.reported_confidence, NEW.confidence);
    NEW.confidence := NULL;
    NEW.confidence_semantics := 'withheld_unlabeled_or_unverified_confidence';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_adi_decision_truth_floor_v1 ON public.adi_decisions;
CREATE TRIGGER trg_guard_adi_decision_truth_floor_v1
BEFORE INSERT OR UPDATE ON public.adi_decisions
FOR EACH ROW EXECUTE FUNCTION public.guard_adi_decision_truth_floor_v1();

REVOKE ALL ON FUNCTION public.guard_adi_decision_truth_floor_v1() FROM PUBLIC;

COMMENT ON COLUMN public.adi_decisions.severity_score IS
  'Nullable governed ADI severity assessment. NULL means not established; inspect severity_score_semantics.';
COMMENT ON COLUMN public.adi_decisions.reported_severity_score IS
  'Caller/writer-reported severity preserved for audit when it is not eligible to become the canonical ADI severity.';
COMMENT ON COLUMN public.adi_decisions.confidence IS
  'Nullable analytical confidence only when confidence_semantics establish its meaning; never defaulted from absence.';
COMMENT ON COLUMN public.adi_decisions.evidence_status IS
  'Epistemic evidence state for the decision recommendation. Historical rows remain legacy_unknown until reassessed.';