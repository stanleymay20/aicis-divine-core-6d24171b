-- AICIS ML Training Knowledge-Time Truth Floor v3
--
-- Purpose:
--   Prevent historical ML rows from being treated as leakage-safe merely because
--   they have a snapshot_date / temporal split. Event time is not knowledge time.
--
-- This migration is additive and intentionally fail-closed. It does NOT rewrite
-- historical manifests, train a model, promote a model, activate cron, or enable
-- any production writer.
--
-- Required invariant for a training row to be scientifically eligible:
--   every evidence item used by every feature must have
--     valid_time <= historical_cutoff
--     knowledge_time <= historical_cutoff
--   and the proof must be represented by immutable lineage, not a caller flag.

ALTER TABLE public.training_dataset_aicis
  ADD COLUMN IF NOT EXISTS historical_cutoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS knowledge_time_status text NOT NULL DEFAULT 'unverified'
    CHECK (knowledge_time_status IN ('unverified','verified_leakage_safe','rejected_leakage_risk')),
  ADD COLUMN IF NOT EXISTS knowledge_time_proof_version text,
  ADD COLUMN IF NOT EXISTS knowledge_time_proof_sha256 text,
  ADD COLUMN IF NOT EXISTS knowledge_time_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS knowledge_time_verification_method text;

ALTER TABLE public.training_dataset_aicis
  DROP CONSTRAINT IF EXISTS training_dataset_aicis_knowledge_time_verified_ck;
ALTER TABLE public.training_dataset_aicis
  ADD CONSTRAINT training_dataset_aicis_knowledge_time_verified_ck CHECK (
    knowledge_time_status <> 'verified_leakage_safe'
    OR (
      historical_cutoff_at IS NOT NULL
      AND knowledge_time_proof_version IS NOT NULL
      AND btrim(knowledge_time_proof_version) <> ''
      AND knowledge_time_proof_sha256 ~ '^[0-9a-f]{64}$'
      AND knowledge_time_verified_at IS NOT NULL
      AND knowledge_time_verification_method IS NOT NULL
      AND btrim(knowledge_time_verification_method) <> ''
    )
  );

COMMENT ON COLUMN public.training_dataset_aicis.historical_cutoff_at IS
  'Historical as-of cutoff for the feature row. Scientific eligibility additionally requires immutable proof that all feature evidence was both valid and knowable by this cutoff.';
COMMENT ON COLUMN public.training_dataset_aicis.knowledge_time_status IS
  'Fail-closed leakage status. unverified is not equivalent to leakage-safe.';
COMMENT ON COLUMN public.training_dataset_aicis.knowledge_time_proof_sha256 IS
  'Digest of an immutable knowledge-time lineage proof. Presence of a digest alone is not proof; verified_leakage_safe requires a governed verifier and proof contract.';

-- Existing rows predate this proof contract. Preserve them; do not manufacture
-- historical certainty by backfilling a verified state.
UPDATE public.training_dataset_aicis
SET knowledge_time_status = 'unverified'
WHERE knowledge_time_status IS DISTINCT FROM 'unverified'
  AND knowledge_time_proof_version IS NULL;

-- Training manifests must record the proof state that existed when the immutable
-- feature snapshot was admitted. Existing manifests remain intact and explicitly
-- UNKNOWN under the new fields.
ALTER TABLE public.ml_model_training_manifest_rows
  ADD COLUMN IF NOT EXISTS historical_cutoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS knowledge_time_status text NOT NULL DEFAULT 'unverified'
    CHECK (knowledge_time_status IN ('unverified','verified_leakage_safe','rejected_leakage_risk')),
  ADD COLUMN IF NOT EXISTS knowledge_time_proof_version text,
  ADD COLUMN IF NOT EXISTS knowledge_time_proof_sha256 text;

COMMENT ON COLUMN public.ml_model_training_manifest_rows.knowledge_time_status IS
  'Knowledge-time proof state frozen into the training manifest. Legacy manifests default to unverified and are not scientific evidence of leakage safety.';

ALTER TABLE public.ml_model_training_runs
  ADD COLUMN IF NOT EXISTS knowledge_time_policy text NOT NULL DEFAULT 'unverified_legacy_or_unknown',
  ADD COLUMN IF NOT EXISTS leakage_safe_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leakage_unverified_rows integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ml_model_training_runs.knowledge_time_policy IS
  'Versioned policy describing whether the run admitted only rows with proven historical knowledge-time integrity.';

-- Canonical eligibility view. This does not infer safety from snapshot_date,
-- feature_version, split_strategy, freshness, or a caller-supplied boolean.
CREATE OR REPLACE VIEW public.ml_training_rows_knowledge_time_eligible_v3
WITH (security_invoker = true)
AS
SELECT t.*
FROM public.training_dataset_aicis t
WHERE t.knowledge_time_status = 'verified_leakage_safe'
  AND t.historical_cutoff_at IS NOT NULL
  AND t.knowledge_time_proof_version IS NOT NULL
  AND btrim(t.knowledge_time_proof_version) <> ''
  AND t.knowledge_time_proof_sha256 ~ '^[0-9a-f]{64}$'
  AND t.knowledge_time_verified_at IS NOT NULL
  AND t.knowledge_time_verification_method IS NOT NULL
  AND btrim(t.knowledge_time_verification_method) <> '';

REVOKE ALL ON public.ml_training_rows_knowledge_time_eligible_v3 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ml_training_rows_knowledge_time_eligible_v3 TO service_role;

COMMENT ON VIEW public.ml_training_rows_knowledge_time_eligible_v3 IS
  'Fail-closed ML training input surface. A row is exposed only after governed proof of historical knowledge-time integrity; snapshot_date alone is insufficient.';

-- The historical implementation of prepare_ml_training_manifest is not present
-- in the source-of-truth repository, so do not pretend we can safely patch its
-- internals here. Instead place a non-bypassable database guard on manifest rows.
CREATE OR REPLACE FUNCTION public.enforce_ml_manifest_knowledge_time_truth_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source public.training_dataset_aicis%ROWTYPE;
BEGIN
  SELECT * INTO v_source
  FROM public.training_dataset_aicis
  WHERE id = NEW.training_row_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'training source row % does not exist', NEW.training_row_id;
  END IF;

  IF v_source.knowledge_time_status <> 'verified_leakage_safe'
     OR v_source.historical_cutoff_at IS NULL
     OR v_source.knowledge_time_proof_version IS NULL
     OR btrim(v_source.knowledge_time_proof_version) = ''
     OR v_source.knowledge_time_proof_sha256 !~ '^[0-9a-f]{64}$'
     OR v_source.knowledge_time_verified_at IS NULL
     OR v_source.knowledge_time_verification_method IS NULL
     OR btrim(v_source.knowledge_time_verification_method) = '' THEN
    RAISE EXCEPTION 'training row % has no governed historical knowledge-time proof', NEW.training_row_id;
  END IF;

  -- Freeze the proven state into the immutable manifest rather than trusting
  -- caller-supplied manifest metadata.
  NEW.historical_cutoff_at := v_source.historical_cutoff_at;
  NEW.knowledge_time_status := v_source.knowledge_time_status;
  NEW.knowledge_time_proof_version := v_source.knowledge_time_proof_version;
  NEW.knowledge_time_proof_sha256 := v_source.knowledge_time_proof_sha256;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_ml_manifest_knowledge_time_truth_v3()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_ml_manifest_knowledge_time_truth_v3()
  TO service_role;

DROP TRIGGER IF EXISTS trg_enforce_ml_manifest_knowledge_time_truth_v3
  ON public.ml_model_training_manifest_rows;
CREATE TRIGGER trg_enforce_ml_manifest_knowledge_time_truth_v3
BEFORE INSERT OR UPDATE ON public.ml_model_training_manifest_rows
FOR EACH ROW EXECUTE FUNCTION public.enforce_ml_manifest_knowledge_time_truth_v3();

-- Legacy manifests are preserved for audit. They are deliberately not rewritten
-- as verified; corrected future lineage must be a new manifest/run.
UPDATE public.ml_model_training_runs r
SET knowledge_time_policy = 'unverified_legacy_or_unknown'
WHERE EXISTS (
  SELECT 1
  FROM public.ml_model_training_manifest_rows m
  WHERE m.training_run_id = r.id
    AND m.knowledge_time_status <> 'verified_leakage_safe'
);
