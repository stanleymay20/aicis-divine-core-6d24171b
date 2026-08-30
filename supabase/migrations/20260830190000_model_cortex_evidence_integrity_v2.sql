-- AICIS Model Cortex Evidence Integrity v2
--
-- Additive hardening for forensic outcome evaluation. This migration does not
-- enable writers, deployment, model promotion, target cutover, or cron jobs.
--
-- Invariants:
--   1. A forecast target must be sealed before external evidence can resolve it.
--   2. External evidence used for evaluation must be learned after issuance.
--   3. Verified evidence truth-bearing fields are immutable.
--   4. Knowledge/retrieval time is distinct from event/observation time.

-- -----------------------------------------------------------------------------
-- 1. Prospectively sealed target contracts.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aicis_model_prediction_target_contracts (
  prediction_id text PRIMARY KEY,
  prediction_system text NOT NULL DEFAULT 'model_cortex'
    CHECK (prediction_system = 'model_cortex'),
  issued_at timestamptz NOT NULL,
  target_definition text NOT NULL CHECK (btrim(target_definition) <> ''),
  target_semantics text NOT NULL CHECK (btrim(target_semantics) <> ''),
  target_version text NOT NULL CHECK (btrim(target_version) <> ''),
  resolution_rule text NOT NULL CHECK (btrim(resolution_rule) <> ''),
  resolution_rule_version text NOT NULL CHECK (btrim(resolution_rule_version) <> ''),
  forecast_horizon_at timestamptz,
  target_fingerprint_sha256 text NOT NULL
    CHECK (target_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aicis_model_prediction_target_contract_horizon CHECK (
    forecast_horizon_at IS NULL OR forecast_horizon_at >= issued_at
  )
);

CREATE OR REPLACE FUNCTION public.aicis_model_target_fingerprint(
  p_prediction_id text,
  p_issued_at timestamptz,
  p_target_definition text,
  p_target_semantics text,
  p_target_version text,
  p_resolution_rule text,
  p_resolution_rule_version text,
  p_forecast_horizon_at timestamptz
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
          'aicis-model-target-contract-v1',
          p_prediction_id,
          to_char(p_issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          p_target_definition,
          p_target_semantics,
          p_target_version,
          p_resolution_rule,
          p_resolution_rule_version,
          COALESCE(to_char(p_forecast_horizon_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.aicis_model_target_fingerprint(text,timestamptz,text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_model_target_fingerprint(text,timestamptz,text,text,text,text,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_aicis_model_prediction_target_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected text;
  v_prediction_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.aicis_model_predictions p WHERE p.id::text = NEW.prediction_id
  ) INTO v_prediction_exists;

  IF NOT v_prediction_exists THEN
    RAISE EXCEPTION 'Model Cortex prediction % does not exist', NEW.prediction_id;
  END IF;

  v_expected := public.aicis_model_target_fingerprint(
    NEW.prediction_id,
    NEW.issued_at,
    NEW.target_definition,
    NEW.target_semantics,
    NEW.target_version,
    NEW.resolution_rule,
    NEW.resolution_rule_version,
    NEW.forecast_horizon_at
  );

  IF NEW.target_fingerprint_sha256 IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'target_fingerprint_sha256 does not match canonical target contract';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'sealed Model Cortex target contracts are immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_aicis_model_prediction_target_contract
  ON public.aicis_model_prediction_target_contracts;
CREATE TRIGGER trg_validate_aicis_model_prediction_target_contract
BEFORE INSERT OR UPDATE ON public.aicis_model_prediction_target_contracts
FOR EACH ROW EXECUTE FUNCTION public.validate_aicis_model_prediction_target_contract();

REVOKE ALL ON FUNCTION public.validate_aicis_model_prediction_target_contract() FROM PUBLIC;
ALTER TABLE public.aicis_model_prediction_target_contracts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.aicis_model_prediction_target_contracts TO authenticated;
GRANT ALL ON public.aicis_model_prediction_target_contracts TO service_role;

DROP POLICY IF EXISTS "Operators inspect Model Cortex target contracts"
  ON public.aicis_model_prediction_target_contracts;
CREATE POLICY "Operators inspect Model Cortex target contracts"
  ON public.aicis_model_prediction_target_contracts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

DROP POLICY IF EXISTS "Service role creates Model Cortex target contracts"
  ON public.aicis_model_prediction_target_contracts;
CREATE POLICY "Service role creates Model Cortex target contracts"
  ON public.aicis_model_prediction_target_contracts
  FOR INSERT TO service_role WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. Preserve knowledge time separately from event time and seal verified evidence.
-- -----------------------------------------------------------------------------
ALTER TABLE public.prediction_external_outcomes
  ADD COLUMN IF NOT EXISTS retrieved_at timestamptz;

COMMENT ON COLUMN public.prediction_external_outcomes.retrieved_at IS
  'When AICIS first obtained the evidence. This is knowledge time and must not be conflated with observed_at event time.';

CREATE OR REPLACE FUNCTION public.enforce_prediction_external_outcome_integrity_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
CREATE TRIGGER trg_prediction_external_outcome_integrity_v2
BEFORE INSERT OR UPDATE ON public.prediction_external_outcomes
FOR EACH ROW EXECUTE FUNCTION public.enforce_prediction_external_outcome_integrity_v2();

REVOKE ALL ON FUNCTION public.enforce_prediction_external_outcome_integrity_v2() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. Bind verified target resolutions to the sealed issuance-time contract.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_aicis_model_outcome_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_external public.prediction_external_outcomes%ROWTYPE;
  v_contract public.aicis_model_prediction_target_contracts%ROWTYPE;
BEGIN
  SELECT * INTO v_external
  FROM public.prediction_external_outcomes e
  WHERE e.id = NEW.external_outcome_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'external outcome % does not exist', NEW.external_outcome_id;
  END IF;

  IF v_external.prediction_system IS DISTINCT FROM NEW.prediction_system
     OR v_external.prediction_id IS DISTINCT FROM NEW.prediction_id THEN
    RAISE EXCEPTION 'external outcome does not belong to this prediction';
  END IF;

  SELECT * INTO v_contract
  FROM public.aicis_model_prediction_target_contracts c
  WHERE c.prediction_id = NEW.prediction_id
    AND c.prediction_system = NEW.prediction_system;

  IF NEW.resolution_status = 'verified' THEN
    IF NOT FOUND THEN
      RAISE EXCEPTION 'verified resolution requires a prospectively sealed target contract';
    END IF;
    IF NEW.target_definition IS DISTINCT FROM v_contract.target_definition
       OR NEW.target_semantics IS DISTINCT FROM v_contract.target_semantics
       OR NEW.target_version IS DISTINCT FROM v_contract.target_version
       OR NEW.resolution_rule IS DISTINCT FROM v_contract.resolution_rule
       OR NEW.resolution_rule_version IS DISTINCT FROM v_contract.resolution_rule_version THEN
      RAISE EXCEPTION 'resolution target/rule does not match sealed issuance-time contract';
    END IF;
    IF v_external.verification_status <> 'verified'
       OR v_external.verified_at IS NULL
       OR v_external.retrieved_at IS NULL
       OR v_external.verification_method IS NULL
       OR btrim(v_external.verification_method) = '' THEN
      RAISE EXCEPTION 'verified resolution requires currently verified evidence with knowledge time';
    END IF;
    IF v_external.observed_at < v_contract.issued_at
       OR v_external.retrieved_at < v_contract.issued_at THEN
      RAISE EXCEPTION 'evaluation evidence must be observed and learned after prediction issuance';
    END IF;
    IF NEW.resolved_at IS NULL OR NEW.resolved_at < v_external.retrieved_at THEN
      RAISE EXCEPTION 'resolved_at must be at or after evidence knowledge time';
    END IF;
  END IF;

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

REVOKE ALL ON FUNCTION public.validate_aicis_model_outcome_resolution() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 4. Evaluation view now requires sealed-target and knowledge-time chronology.
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
  e.verification_method AS external_verification_method,
  e.verified_at AS external_verified_at,
  r.resolved_at
FROM public.aicis_model_predictions p
JOIN public.aicis_model_routing_decisions rd ON rd.id::text = p.routing_decision_id::text
JOIN public.aicis_model_outcomes o ON o.prediction_id::text = p.id::text
JOIN public.aicis_model_outcome_resolutions r ON r.id = o.resolution_id
JOIN public.prediction_external_outcomes e ON e.id = r.external_outcome_id
JOIN public.aicis_model_prediction_target_contracts c
  ON c.prediction_id = p.id::text AND c.prediction_system = 'model_cortex'
WHERE o.binary_outcome IN (0, 1)
  AND o.evaluation_eligibility = 'externally_verified_target_resolution_v1'
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
  'Canonical Model Cortex evaluation sample v2: sealed issuance-time target + post-issuance observed/known evidence + current verification + target-specific resolution.';
