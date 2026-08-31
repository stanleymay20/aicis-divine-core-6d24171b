-- AICIS Model Cortex Verified Outcome Gate v1
--
-- Scientific invariant:
--   a caller-supplied binary label is not evaluation truth.
--   Brier/ECE competency evidence may only use an externally verified event
--   that has been explicitly resolved against the prediction target by a
--   versioned resolution rule.
--
-- This migration is additive. It does NOT enable writers, cron jobs, target
-- Supabase cutover, model promotion, or any production activation.

-- -----------------------------------------------------------------------------
-- 1. Explicit target-resolution ledger.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aicis_model_outcome_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_system text NOT NULL DEFAULT 'model_cortex',
  prediction_id text NOT NULL,
  external_outcome_id uuid NOT NULL
    REFERENCES public.prediction_external_outcomes(id) ON DELETE RESTRICT,
  target_definition text NOT NULL,
  target_semantics text NOT NULL,
  target_version text NOT NULL,
  resolution_rule text NOT NULL,
  resolution_rule_version text NOT NULL,
  resolved_binary_outcome smallint CHECK (resolved_binary_outcome IN (0, 1)),
  resolution_status text NOT NULL DEFAULT 'pending' CHECK (resolution_status IN (
    'pending', 'verified', 'rejected', 'superseded'
  )),
  resolver text,
  resolved_at timestamptz,
  resolution_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aicis_model_outcome_resolutions_verified_requirements CHECK (
    resolution_status <> 'verified'
    OR (
      resolved_binary_outcome IS NOT NULL
      AND resolver IS NOT NULL
      AND btrim(resolver) <> ''
      AND resolved_at IS NOT NULL
      AND btrim(target_definition) <> ''
      AND btrim(target_semantics) <> ''
      AND btrim(target_version) <> ''
      AND btrim(resolution_rule) <> ''
      AND btrim(resolution_rule_version) <> ''
    )
  ),
  UNIQUE (
    prediction_system,
    prediction_id,
    external_outcome_id,
    resolution_rule_version
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aicis_model_outcome_resolutions_active_verified
  ON public.aicis_model_outcome_resolutions(prediction_system, prediction_id)
  WHERE resolution_status = 'verified';

CREATE INDEX IF NOT EXISTS idx_aicis_model_outcome_resolutions_external
  ON public.aicis_model_outcome_resolutions(external_outcome_id, resolution_status);

CREATE OR REPLACE FUNCTION public.validate_aicis_model_outcome_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_external public.prediction_external_outcomes%ROWTYPE;
  v_prediction_exists boolean;
BEGIN
  SELECT *
  INTO v_external
  FROM public.prediction_external_outcomes e
  WHERE e.id = NEW.external_outcome_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'external outcome % does not exist', NEW.external_outcome_id;
  END IF;

  IF v_external.prediction_system IS DISTINCT FROM NEW.prediction_system
     OR v_external.prediction_id IS DISTINCT FROM NEW.prediction_id THEN
    RAISE EXCEPTION 'external outcome does not belong to prediction_system=% prediction_id=%',
      NEW.prediction_system, NEW.prediction_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.aicis_model_predictions p
    WHERE p.id::text = NEW.prediction_id
  ) INTO v_prediction_exists;

  IF NOT v_prediction_exists THEN
    RAISE EXCEPTION 'Model Cortex prediction % does not exist', NEW.prediction_id;
  END IF;

  IF NEW.resolution_status = 'verified' THEN
    IF v_external.verification_status <> 'verified'
       OR v_external.verified_at IS NULL
       OR v_external.verification_method IS NULL
       OR btrim(v_external.verification_method) = '' THEN
      RAISE EXCEPTION 'verified target resolution requires an externally verified outcome';
    END IF;

    IF NEW.resolved_at < v_external.observed_at THEN
      RAISE EXCEPTION 'resolved_at cannot precede the external observation';
    END IF;
  END IF;

  -- Once verified, truth-bearing fields are immutable. A verified resolution
  -- may only be withdrawn by changing status to superseded/rejected; a new
  -- resolution row must carry any replacement truth.
  IF TG_OP = 'UPDATE' AND OLD.resolution_status = 'verified' THEN
    IF NEW.prediction_system IS DISTINCT FROM OLD.prediction_system
       OR NEW.prediction_id IS DISTINCT FROM OLD.prediction_id
       OR NEW.external_outcome_id IS DISTINCT FROM OLD.external_outcome_id
       OR NEW.target_definition IS DISTINCT FROM OLD.target_definition
       OR NEW.target_semantics IS DISTINCT FROM OLD.target_semantics
       OR NEW.target_version IS DISTINCT FROM OLD.target_version
       OR NEW.resolution_rule IS DISTINCT FROM OLD.resolution_rule
       OR NEW.resolution_rule_version IS DISTINCT FROM OLD.resolution_rule_version
       OR NEW.resolved_binary_outcome IS DISTINCT FROM OLD.resolved_binary_outcome
       OR NEW.resolver IS DISTINCT FROM OLD.resolver
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.resolution_evidence IS DISTINCT FROM OLD.resolution_evidence THEN
      RAISE EXCEPTION 'verified Model Cortex outcome resolution truth fields are immutable';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_aicis_model_outcome_resolution
  ON public.aicis_model_outcome_resolutions;
CREATE TRIGGER trg_validate_aicis_model_outcome_resolution
BEFORE INSERT OR UPDATE ON public.aicis_model_outcome_resolutions
FOR EACH ROW
EXECUTE FUNCTION public.validate_aicis_model_outcome_resolution();

REVOKE ALL ON FUNCTION public.validate_aicis_model_outcome_resolution() FROM PUBLIC;

ALTER TABLE public.aicis_model_outcome_resolutions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.aicis_model_outcome_resolutions TO authenticated;
GRANT ALL ON public.aicis_model_outcome_resolutions TO service_role;

DROP POLICY IF EXISTS "Operators inspect Model Cortex outcome resolutions"
  ON public.aicis_model_outcome_resolutions;
CREATE POLICY "Operators inspect Model Cortex outcome resolutions"
  ON public.aicis_model_outcome_resolutions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

DROP POLICY IF EXISTS "Service role manages Model Cortex outcome resolutions"
  ON public.aicis_model_outcome_resolutions;
CREATE POLICY "Service role manages Model Cortex outcome resolutions"
  ON public.aicis_model_outcome_resolutions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. Preserve candidate labels separately from evaluation truth.
-- -----------------------------------------------------------------------------
ALTER TABLE public.aicis_model_outcomes
  ADD COLUMN IF NOT EXISTS candidate_binary_outcome smallint
    CHECK (candidate_binary_outcome IN (0, 1)),
  ADD COLUMN IF NOT EXISTS resolution_id uuid
    REFERENCES public.aicis_model_outcome_resolutions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS evaluation_eligibility text,
  ADD COLUMN IF NOT EXISTS evaluation_block_reason text;

UPDATE public.aicis_model_outcomes
SET evaluation_eligibility = 'legacy_outcome_not_verified_for_evaluation',
    evaluation_block_reason = COALESCE(
      evaluation_block_reason,
      'legacy row predates external verified target-resolution gate'
    )
WHERE evaluation_eligibility IS NULL;

COMMENT ON COLUMN public.aicis_model_outcomes.candidate_binary_outcome IS
  'Optional caller/operator candidate label. It is never evaluation truth by itself.';
COMMENT ON COLUMN public.aicis_model_outcomes.binary_outcome IS
  'Evaluation label. Under verified-outcome-gate-v1 it is populated only from a verified target-resolution row, never directly from a caller label.';
COMMENT ON COLUMN public.aicis_model_outcomes.resolution_id IS
  'Target-specific resolution lineage used to establish binary_outcome. Inspect the linked external outcome and versioned resolution rule.';
COMMENT ON COLUMN public.aicis_model_outcomes.evaluation_eligibility IS
  'Explicit evaluation gate state. Only externally_verified_target_resolution_v1 is eligible for Model Cortex Brier/ECE evaluation.';

-- Database-level guard: even service-role application code cannot write a
-- truth-bearing binary outcome without a currently verified resolution.
CREATE OR REPLACE FUNCTION public.enforce_aicis_model_outcome_truth_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolution public.aicis_model_outcome_resolutions%ROWTYPE;
  v_external public.prediction_external_outcomes%ROWTYPE;
BEGIN
  IF NEW.binary_outcome IS NULL AND NEW.brier_score IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.resolution_id IS NULL THEN
    RAISE EXCEPTION 'binary_outcome/brier_score requires a verified target resolution';
  END IF;

  SELECT *
  INTO v_resolution
  FROM public.aicis_model_outcome_resolutions r
  WHERE r.id = NEW.resolution_id;

  IF NOT FOUND
     OR v_resolution.resolution_status <> 'verified'
     OR v_resolution.prediction_system <> 'model_cortex'
     OR v_resolution.prediction_id <> NEW.prediction_id::text
     OR v_resolution.resolved_binary_outcome IS DISTINCT FROM NEW.binary_outcome THEN
    RAISE EXCEPTION 'outcome is not backed by the matching verified Model Cortex target resolution';
  END IF;

  SELECT *
  INTO v_external
  FROM public.prediction_external_outcomes e
  WHERE e.id = v_resolution.external_outcome_id;

  IF NOT FOUND
     OR v_external.verification_status <> 'verified'
     OR v_external.prediction_system <> v_resolution.prediction_system
     OR v_external.prediction_id <> v_resolution.prediction_id THEN
    RAISE EXCEPTION 'resolution external evidence is not currently verified for this prediction';
  END IF;

  NEW.evaluation_eligibility := 'externally_verified_target_resolution_v1';
  NEW.evaluation_block_reason := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_aicis_model_outcome_truth_gate
  ON public.aicis_model_outcomes;
CREATE TRIGGER trg_enforce_aicis_model_outcome_truth_gate
BEFORE INSERT OR UPDATE OF binary_outcome, brier_score, resolution_id
ON public.aicis_model_outcomes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_aicis_model_outcome_truth_gate();

REVOKE ALL ON FUNCTION public.enforce_aicis_model_outcome_truth_gate() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. Canonical evaluation read model. This view dynamically re-checks both the
--    resolution and its external evidence, so a later rejection/supersession
--    cannot silently remain in Brier/ECE samples.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.aicis_verified_model_outcome_evaluations;
CREATE VIEW public.aicis_verified_model_outcome_evaluations AS
SELECT
  p.id::text AS prediction_id,
  p.model_id::text AS model_id,
  p.routing_decision_id::text AS routing_decision_id,
  rd.domain,
  rd.modality,
  p.task,
  p.probability,
  p.probability_semantics,
  o.binary_outcome,
  o.resolution_id::text AS resolution_id,
  r.target_definition,
  r.target_semantics,
  r.target_version,
  r.resolution_rule,
  r.resolution_rule_version,
  e.id::text AS external_outcome_id,
  e.observed_at AS external_observed_at,
  e.source_name AS external_source_name,
  e.source_uri AS external_source_uri,
  e.evidence_sha256 AS external_evidence_sha256,
  e.verification_method AS external_verification_method,
  e.verified_at AS external_verified_at,
  r.resolved_at
FROM public.aicis_model_predictions p
JOIN public.aicis_model_routing_decisions rd
  ON rd.id::text = p.routing_decision_id::text
JOIN public.aicis_model_outcomes o
  ON o.prediction_id::text = p.id::text
JOIN public.aicis_model_outcome_resolutions r
  ON r.id = o.resolution_id
JOIN public.prediction_external_outcomes e
  ON e.id = r.external_outcome_id
WHERE o.binary_outcome IN (0, 1)
  AND o.evaluation_eligibility = 'externally_verified_target_resolution_v1'
  AND r.resolution_status = 'verified'
  AND r.prediction_system = 'model_cortex'
  AND r.prediction_id = p.id::text
  AND r.resolved_binary_outcome = o.binary_outcome
  AND e.verification_status = 'verified'
  AND e.prediction_system = r.prediction_system
  AND e.prediction_id = r.prediction_id
  AND e.verified_at IS NOT NULL
  AND e.verification_method IS NOT NULL
  AND btrim(e.verification_method) <> ''
  AND r.resolved_at IS NOT NULL
  AND r.resolved_at >= e.observed_at;

REVOKE ALL ON public.aicis_verified_model_outcome_evaluations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.aicis_verified_model_outcome_evaluations TO service_role;

COMMENT ON VIEW public.aicis_verified_model_outcome_evaluations IS
  'Canonical Model Cortex probabilistic evaluation sample. Rows exist only while external evidence and target resolution remain verified and mutually consistent.';

-- -----------------------------------------------------------------------------
-- 4. Competency metrics carry an exact evidence policy and scope.
-- -----------------------------------------------------------------------------
ALTER TABLE public.aicis_model_competency
  ADD COLUMN IF NOT EXISTS verified_sample_size integer,
  ADD COLUMN IF NOT EXISTS evaluation_evidence_policy text,
  ADD COLUMN IF NOT EXISTS evaluation_scope text;

UPDATE public.aicis_model_competency
SET evaluation_evidence_policy = 'legacy_or_unverified_evidence_policy'
WHERE evaluation_evidence_policy IS NULL
  AND (brier_score IS NOT NULL OR ece IS NOT NULL OR sample_size > 0);

COMMENT ON COLUMN public.aicis_model_competency.verified_sample_size IS
  'Count of currently eligible externally verified target-resolved probability/outcome pairs used by the current evaluation method.';
COMMENT ON COLUMN public.aicis_model_competency.evaluation_evidence_policy IS
  'Exact evidence gate contract used to compute direct metrics. Promotion must require a recognized value, not merely a non-legacy-looking string.';
COMMENT ON COLUMN public.aicis_model_competency.evaluation_scope IS
  'Population scope of the direct evaluation metrics, e.g. model+domain+modality+task.';
