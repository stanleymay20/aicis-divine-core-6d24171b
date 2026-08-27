-- AICIS signal duplicate-identity truth floor v1
-- Similar title/time/geography is evidence for review, not proof that two reports
-- describe the same real-world event.

ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS candidate_duplicate_of_signal_id uuid
    REFERENCES public.global_signals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS candidate_canonical_event_id uuid,
  ADD COLUMN IF NOT EXISTS duplicate_match_status text NOT NULL DEFAULT 'not_assessed'
    CHECK (duplicate_match_status IN ('not_assessed','candidate','verified','rejected','legacy_unverified')),
  ADD COLUMN IF NOT EXISTS duplicate_similarity_score numeric CHECK (
    duplicate_similarity_score IS NULL OR
    (duplicate_similarity_score >= 0 AND duplicate_similarity_score <= 1)
  ),
  ADD COLUMN IF NOT EXISTS duplicate_match_semantics text,
  ADD COLUMN IF NOT EXISTS duplicate_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS duplicate_reviewed_by uuid;

UPDATE public.global_signals
SET
  duplicate_match_status = 'legacy_unverified',
  duplicate_match_semantics = COALESCE(
    duplicate_match_semantics,
    'legacy_duplicate_status_identity_evidence_unverified'
  )
WHERE canonical_event_status = 'duplicate'
  AND duplicate_match_status = 'not_assessed';

CREATE INDEX IF NOT EXISTS idx_global_signals_duplicate_candidate_v1
  ON public.global_signals(candidate_duplicate_of_signal_id, duplicate_match_status)
  WHERE candidate_duplicate_of_signal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_signal_duplicate_identity_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.canonical_event_status = 'duplicate'
     AND NEW.duplicate_match_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION
      'canonical duplicate status requires verified duplicate identity evidence';
  END IF;

  IF NEW.duplicate_match_status = 'candidate' THEN
    IF NEW.candidate_duplicate_of_signal_id IS NULL
       OR NEW.duplicate_similarity_score IS NULL
       OR NEW.duplicate_match_semantics IS NULL THEN
      RAISE EXCEPTION
        'duplicate candidate requires candidate target, similarity score, and match semantics';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_signal_duplicate_identity_v1 ON public.global_signals;
CREATE TRIGGER trg_guard_signal_duplicate_identity_v1
BEFORE INSERT OR UPDATE ON public.global_signals
FOR EACH ROW EXECUTE FUNCTION public.guard_signal_duplicate_identity_v1();

REVOKE ALL ON FUNCTION public.guard_signal_duplicate_identity_v1() FROM PUBLIC;

COMMENT ON COLUMN public.global_signals.candidate_duplicate_of_signal_id IS
  'Candidate same-event target nominated by similarity logic. This field does not assert duplicate identity.';
COMMENT ON COLUMN public.global_signals.duplicate_similarity_score IS
  'String/context similarity score used to nominate duplicate review candidates; it is not identity confidence.';
COMMENT ON COLUMN public.global_signals.duplicate_match_status IS
  'Identity-review status for same-event consolidation. Only verified may be persisted as canonical_event_status=duplicate.';
COMMENT ON FUNCTION public.guard_signal_duplicate_identity_v1() IS
  'Prevents fuzzy or legacy-unverified similarity from silently becoming canonical same-event identity.';