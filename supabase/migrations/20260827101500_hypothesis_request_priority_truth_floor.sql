-- AICIS hypothesis evidence-request truth floor.
-- A search priority is an operational heuristic, not an empirical probability.
-- When the hypothesis competition is unquantified, priority may remain NULL.

ALTER TABLE public.aicis_evidence_requests
  ALTER COLUMN priority DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS priority_semantics text;

UPDATE public.aicis_evidence_requests
SET priority_semantics = 'legacy_search_priority_semantics_unverified'
WHERE priority IS NOT NULL AND priority_semantics IS NULL;

COMMENT ON COLUMN public.aicis_evidence_requests.priority IS
  'Nullable operational search priority. It is not epistemic confidence or probability. Inspect priority_semantics.';
