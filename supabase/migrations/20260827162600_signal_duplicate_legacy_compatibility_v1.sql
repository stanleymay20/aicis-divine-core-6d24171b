-- Compatibility refinement for signal duplicate identity truth floor.
-- Existing legacy duplicate rows may still be updated for unrelated fields, but
-- no new row/transition may become a canonical duplicate without verified identity.

CREATE OR REPLACE FUNCTION public.guard_signal_duplicate_identity_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.canonical_event_status = 'duplicate'
     AND NEW.duplicate_match_status IS DISTINCT FROM 'verified'
     AND (
       TG_OP = 'INSERT'
       OR OLD.canonical_event_status IS DISTINCT FROM 'duplicate'
       OR OLD.duplicate_match_status = 'verified'
     ) THEN
    RAISE EXCEPTION
      'new canonical duplicate status requires verified duplicate identity evidence';
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

REVOKE ALL ON FUNCTION public.guard_signal_duplicate_identity_v1() FROM PUBLIC;

COMMENT ON FUNCTION public.guard_signal_duplicate_identity_v1() IS
  'Allows explicitly marked legacy-unverified duplicate rows to survive unrelated updates, while requiring verified identity for every new duplicate transition.';