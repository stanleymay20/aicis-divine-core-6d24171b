-- AICIS Model Cortex Evidence Artifact Binding v4
--
-- Additive forensic hardening. This migration does not deploy functions, enable
-- writers, activate cron, promote models, or cut over any runtime.
--
-- Invariant:
--   evidence_sha256 is not trusted merely because it looks like a SHA-256 value.
--   Model Cortex evaluation requires a server-recomputed hash over an immutable,
--   canonical evidence artifact and a live binding from the external outcome.

-- -----------------------------------------------------------------------------
-- 1. Immutable canonical evidence artifacts.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aicis_prediction_evidence_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type text NOT NULL CHECK (btrim(artifact_type) <> ''),
  media_type text NOT NULL CHECK (btrim(media_type) <> ''),
  canonicalization_version text NOT NULL DEFAULT 'jsonb-canonical-text-v1'
    CHECK (canonicalization_version = 'jsonb-canonical-text-v1'),
  canonical_evidence jsonb NOT NULL,
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aicis_prediction_evidence_artifacts_sha256
  ON public.aicis_prediction_evidence_artifacts(artifact_sha256);

CREATE OR REPLACE FUNCTION public.aicis_prediction_evidence_artifact_sha256(
  p_artifact_type text,
  p_media_type text,
  p_canonicalization_version text,
  p_canonical_evidence jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(
    digest(
      convert_to(
        concat_ws(E'\n',
          'aicis-prediction-evidence-artifact-v1',
          p_artifact_type,
          p_media_type,
          p_canonicalization_version,
          p_canonical_evidence::text
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.aicis_prediction_evidence_artifact_sha256(text,text,text,jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_prediction_evidence_artifact_sha256(text,text,text,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.validate_aicis_prediction_evidence_artifact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'canonical prediction evidence artifacts are immutable';
  END IF;

  v_expected := public.aicis_prediction_evidence_artifact_sha256(
    NEW.artifact_type,
    NEW.media_type,
    NEW.canonicalization_version,
    NEW.canonical_evidence
  );

  IF NEW.artifact_sha256 IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'artifact_sha256 does not match server-recomputed canonical evidence hash';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_aicis_prediction_evidence_artifact
  ON public.aicis_prediction_evidence_artifacts;
CREATE TRIGGER trg_validate_aicis_prediction_evidence_artifact
BEFORE INSERT OR UPDATE ON public.aicis_prediction_evidence_artifacts
FOR EACH ROW EXECUTE FUNCTION public.validate_aicis_prediction_evidence_artifact();

REVOKE ALL ON FUNCTION public.validate_aicis_prediction_evidence_artifact() FROM PUBLIC;
ALTER TABLE public.aicis_prediction_evidence_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aicis_prediction_evidence_artifacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.aicis_prediction_evidence_artifacts TO service_role;

COMMENT ON TABLE public.aicis_prediction_evidence_artifacts IS
  'Immutable canonical evidence payloads. artifact_sha256 is recomputed by the database from the canonical payload and metadata; callers cannot establish truth by supplying an arbitrary SHA-shaped string.';

-- -----------------------------------------------------------------------------
-- 2. Bind external outcomes to canonical artifacts.
-- -----------------------------------------------------------------------------
ALTER TABLE public.prediction_external_outcomes
  ADD COLUMN IF NOT EXISTS evidence_artifact_id uuid
    REFERENCES public.aicis_prediction_evidence_artifacts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS evidence_binding_version text;

COMMENT ON COLUMN public.prediction_external_outcomes.evidence_artifact_id IS
  'Immutable canonical evidence artifact used to establish evidence_sha256 for Model Cortex evaluation.';
COMMENT ON COLUMN public.prediction_external_outcomes.evidence_binding_version IS
  'Exact evidence-artifact binding contract. Model Cortex rigorous evaluation requires canonical-artifact-v1.';

CREATE OR REPLACE FUNCTION public.enforce_prediction_external_outcome_integrity_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_artifact public.aicis_prediction_evidence_artifacts%ROWTYPE;
BEGIN
  IF NEW.verification_status = 'verified' THEN
    IF NEW.retrieved_at IS NULL THEN
      RAISE EXCEPTION 'verified external evidence requires retrieved_at knowledge time';
    END IF;
    IF NEW.retrieved_at < NEW.observed_at THEN
      RAISE EXCEPTION 'retrieved_at cannot precede observed_at';
    END IF;
    IF NEW.verified_at IS NULL OR NEW.verified_at < NEW.retrieved_at THEN
      RAISE EXCEPTION 'verified_at must be at or after retrieved_at';
    END IF;

    IF NEW.prediction_system = 'model_cortex' THEN
      IF NEW.evidence_artifact_id IS NULL
         OR NEW.evidence_binding_version IS DISTINCT FROM 'canonical-artifact-v1' THEN
        RAISE EXCEPTION 'verified Model Cortex evidence requires canonical-artifact-v1 binding';
      END IF;

      SELECT * INTO v_artifact
      FROM public.aicis_prediction_evidence_artifacts a
      WHERE a.id = NEW.evidence_artifact_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Model Cortex evidence artifact does not exist';
      END IF;

      IF NEW.evidence_sha256 IS DISTINCT FROM v_artifact.artifact_sha256 THEN
        RAISE EXCEPTION 'evidence_sha256 does not match server-recomputed canonical artifact hash';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.verification_status = 'verified' THEN
    IF NEW.prediction_system IS DISTINCT FROM OLD.prediction_system
       OR NEW.prediction_id IS DISTINCT FROM OLD.prediction_id
       OR NEW.ledger_id IS DISTINCT FROM OLD.ledger_id
       OR NEW.event_type IS DISTINCT FROM OLD.event_type
       OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
       OR NEW.retrieved_at IS DISTINCT FROM OLD.retrieved_at
       OR NEW.observation_text IS DISTINCT FROM OLD.observation_text
       OR NEW.source_name IS DISTINCT FROM OLD.source_name
       OR NEW.source_uri IS DISTINCT FROM OLD.source_uri
       OR NEW.evidence_sha256 IS DISTINCT FROM OLD.evidence_sha256
       OR NEW.evidence_artifact_id IS DISTINCT FROM OLD.evidence_artifact_id
       OR NEW.evidence_binding_version IS DISTINCT FROM OLD.evidence_binding_version
       OR NEW.verification_method IS DISTINCT FROM OLD.verification_method
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.evidence IS DISTINCT FROM OLD.evidence THEN
      RAISE EXCEPTION 'verified external evidence truth-bearing fields are immutable; supersede/reject and create a replacement row';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prediction_external_outcome_integrity_v2
  ON public.prediction_external_outcomes;
DROP TRIGGER IF EXISTS trg_prediction_external_outcome_integrity_v3
  ON public.prediction_external_outcomes;
CREATE TRIGGER trg_prediction_external_outcome_integrity_v3
BEFORE INSERT OR UPDATE ON public.prediction_external_outcomes
FOR EACH ROW EXECUTE FUNCTION public.enforce_prediction_external_outcome_integrity_v3();

REVOKE ALL ON FUNCTION public.enforce_prediction_external_outcome_integrity_v3() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. Strengthen the DB truth gate. Model Cortex binary truth cannot be written
--    from an external outcome that is merely verified; it must also be bound to
--    the immutable canonical artifact whose server-computed hash matches the row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_aicis_model_outcome_truth_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resolution public.aicis_model_outcome_resolutions%ROWTYPE;
  v_external public.prediction_external_outcomes%ROWTYPE;
  v_artifact public.aicis_prediction_evidence_artifacts%ROWTYPE;
BEGIN
  IF NEW.binary_outcome IS NULL AND NEW.brier_score IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.resolution_id IS NULL THEN
    RAISE EXCEPTION 'binary_outcome/brier_score requires a verified target resolution';
  END IF;

  SELECT * INTO v_resolution
  FROM public.aicis_model_outcome_resolutions r
  WHERE r.id = NEW.resolution_id;

  IF NOT FOUND
     OR v_resolution.resolution_status <> 'verified'
     OR v_resolution.prediction_system <> 'model_cortex'
     OR v_resolution.prediction_id <> NEW.prediction_id::text
     OR v_resolution.resolved_binary_outcome IS DISTINCT FROM NEW.binary_outcome THEN
    RAISE EXCEPTION 'outcome is not backed by the matching verified Model Cortex target resolution';
  END IF;

  SELECT * INTO v_external
  FROM public.prediction_external_outcomes e
  WHERE e.id = v_resolution.external_outcome_id;

  IF NOT FOUND
     OR v_external.verification_status <> 'verified'
     OR v_external.prediction_system <> v_resolution.prediction_system
     OR v_external.prediction_id <> v_resolution.prediction_id
     OR v_external.evidence_artifact_id IS NULL
     OR v_external.evidence_binding_version IS DISTINCT FROM 'canonical-artifact-v1' THEN
    RAISE EXCEPTION 'resolution evidence is not currently verified and canonically artifact-bound';
  END IF;

  SELECT * INTO v_artifact
  FROM public.aicis_prediction_evidence_artifacts a
  WHERE a.id = v_external.evidence_artifact_id;

  IF NOT FOUND OR v_artifact.artifact_sha256 IS DISTINCT FROM v_external.evidence_sha256 THEN
    RAISE EXCEPTION 'external evidence hash is not bound to the canonical evidence artifact';
  END IF;

  NEW.evaluation_eligibility := 'externally_verified_target_resolution_v2_canonical_artifact';
  NEW.evaluation_block_reason := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_aicis_model_outcome_truth_gate() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 4. Canonical evaluation view v3 requires canonical artifact binding.
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
  c.target_fingerprint_sha256,
  c.issued_at AS prediction_issued_at,
  c.forecast_horizon_at,
  r.target_definition,
  r.target_semantics,
  r.target_version,
  r.resolution_rule,
  r.resolution_rule_version,
  e.id::text AS external_outcome_id,
  e.observed_at AS external_observed_at,
  e.retrieved_at AS external_retrieved_at,
  e.source_name AS external_source_name,
  e.source_uri AS external_source_uri,
  e.evidence_sha256 AS external_evidence_sha256,
  e.evidence_artifact_id::text AS external_evidence_artifact_id,
  e.evidence_binding_version,
  a.artifact_type AS external_artifact_type,
  a.media_type AS external_artifact_media_type,
  a.canonicalization_version AS external_artifact_canonicalization_version,
  e.verification_method AS external_verification_method,
  e.verified_at AS external_verified_at,
  r.resolved_at
FROM public.aicis_model_predictions p
JOIN public.aicis_model_routing_decisions rd ON rd.id::text = p.routing_decision_id::text
JOIN public.aicis_model_outcomes o ON o.prediction_id::text = p.id::text
JOIN public.aicis_model_outcome_resolutions r ON r.id = o.resolution_id
JOIN public.prediction_external_outcomes e ON e.id = r.external_outcome_id
JOIN public.aicis_prediction_evidence_artifacts a ON a.id = e.evidence_artifact_id
JOIN public.aicis_model_prediction_target_contracts c
  ON c.prediction_id = p.id::text AND c.prediction_system = 'model_cortex'
WHERE o.binary_outcome IN (0, 1)
  AND o.evaluation_eligibility = 'externally_verified_target_resolution_v2_canonical_artifact'
  AND r.resolution_status = 'verified'
  AND r.prediction_system = 'model_cortex'
  AND r.prediction_id = p.id::text
  AND r.resolved_binary_outcome = o.binary_outcome
  AND r.target_definition = c.target_definition
  AND r.target_semantics = c.target_semantics
  AND r.target_version = c.target_version
  AND r.resolution_rule = c.resolution_rule
  AND r.resolution_rule_version = c.resolution_rule_version
  AND e.verification_status = 'verified'
  AND e.prediction_system = r.prediction_system
  AND e.prediction_id = r.prediction_id
  AND e.evidence_binding_version = 'canonical-artifact-v1'
  AND e.evidence_sha256 = a.artifact_sha256
  AND e.retrieved_at IS NOT NULL
  AND e.observed_at >= c.issued_at
  AND e.retrieved_at >= c.issued_at
  AND e.verified_at IS NOT NULL
  AND e.verified_at >= e.retrieved_at
  AND e.verification_method IS NOT NULL
  AND btrim(e.verification_method) <> ''
  AND r.resolved_at IS NOT NULL
  AND r.resolved_at >= e.retrieved_at;

REVOKE ALL ON public.aicis_verified_model_outcome_evaluations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.aicis_verified_model_outcome_evaluations TO service_role;

COMMENT ON VIEW public.aicis_verified_model_outcome_evaluations IS
  'Canonical Model Cortex evaluation sample v3: sealed prospective target + post-issuance knowledge time + immutable verified evidence + server-hashed canonical evidence artifact + target-specific verified resolution.';
